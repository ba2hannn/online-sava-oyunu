import React, { useState } from 'react';
import {
  ERAS,
  WORLD_WIDTH,
  getDoctrineCost,
  getEraTurrets,
  getEraUnits,
  getSupplyCap,
  getTurretById,
  getUnitById,
  getUnitSupply,
} from '../game/catalog';
import { HUDStateSnapshot } from '../game/engine';
import { BattleActionCommand, GameMode, TeamId } from '../game/types';
import { ArchetypeSvgIcon, GoldCoinIcon, XpStarIcon } from './GameIcons';

const POWER_ICONS = [
  'power_meteor',
  'power_arrows',
  'power_cannon',
  'power_bombs',
  'power_orbital',
];

interface BattleHudOverlayProps {
  hud: HUDStateSnapshot;
  mode: GameMode;
  roomCode: string | null;
  networkLabel?: string;
  muted: boolean;
  onCommand: (cmd: BattleActionCommand) => void;
  onToggleMute: () => void;
  onPause: () => void;
  onRestart: () => void;
  onPanCamera: (dir: number) => void;
  onJumpCamera?: (ratio: number) => void;
  onManualSync?: () => void;
}

export const BattleHudOverlay: React.FC<BattleHudOverlayProps> = ({
  hud,
  mode,
  roomCode,
  networkLabel,
  muted,
  onCommand,
  onToggleMute,
  onPause,
  onRestart,
  onPanCamera,
  onJumpCamera,
  onManualSync,
}) => {
  const [activeDrawer, setActiveDrawer] = useState<'none' | 'turrets' | 'doctrines' | 'emotes'>(
    'none'
  );
  const [selectedTurretSlot, setSelectedTurretSlot] = useState<number>(0);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        document.activeElement &&
        (document.activeElement.tagName === 'INPUT' ||
          document.activeElement.tagName === 'TEXTAREA')
      ) {
        return;
      }
      if (e.code === 'KeyT') {
        setActiveDrawer((prev) => (prev === 'turrets' ? 'none' : 'turrets'));
      } else if (e.code === 'KeyG') {
        setActiveDrawer((prev) => (prev === 'doctrines' ? 'none' : 'doctrines'));
      } else if (e.code === 'Escape') {
        setActiveDrawer('none');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const myTeam = hud.playerTeam === 1 ? hud.team1 : hud.team2;
  const enemyTeam = hud.playerTeam === 1 ? hud.team2 : hud.team1;
  const myEra = ERAS[myTeam.era];
  const enemyEra = ERAS[enemyTeam.era];
  const myUnits = getEraUnits(myTeam.era);
  const myTurrets = getEraTurrets(myTeam.era);
  const p2Units = getEraUnits(hud.team2.era);

  const canEvolve = myTeam.era < ERAS.length - 1 && myTeam.xp >= myEra.evolveXpCost;
  const nextSlotUnlockCost =
    myTeam.unlockedTurretSlots < 4 ? myEra.turretSlotCosts[myTeam.unlockedTurretSlots] : 0;

  const queuedSupply = myTeam.queue.reduce((sum, q) => {
    const d = getUnitById(q.unitDefId);
    return sum + (d ? getUnitSupply(d.archetype) : 0);
  }, 0);
  const supplyUsed = (myTeam.fieldSupply ?? 0) + queuedSupply;
  const supplyCap = getSupplyCap(myTeam.era);

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 z-10 pointer-events-none flex flex-col justify-between select-none">
      {/* =========================================================================
          TOP UNIFIED ARCADE COMMAND DOCK (AUTHENTIC ÇAĞLAR BOYU SAVAŞ / AGE OF WAR)
          ========================================================================= */}
      <div className="w-full pointer-events-auto bg-gradient-to-b from-[#090d16]/98 via-[#0e1522]/96 to-[#070b12]/92 border-b-2 border-amber-600/70 shadow-[0_8px_30px_rgba(0,0,0,0.85)] px-3 py-1.5 flex flex-wrap lg:flex-nowrap items-center justify-between gap-2.5 backdrop-blur-md">
        {/* LEFT: Player Fortress HP & Economy Badges */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex flex-col gap-1 min-w-[140px] sm:min-w-[170px]">
            <div className="flex items-center justify-between text-[11px] leading-tight">
              <span className="font-bold text-amber-300 truncate max-w-[110px]">
                {myEra.name}
              </span>
              <span className="font-mono-num font-bold text-emerald-400 text-xs">
                {Math.round(myTeam.hp)} / {myTeam.maxHp}
              </span>
            </div>
            {/* Green Fortress Health Bar with Delayed Trailing Bar */}
            <div className="w-full h-3 bg-[#06080d] rounded-sm overflow-hidden relative border border-slate-700/80 shadow-inner">
              <div
                className="absolute inset-y-0 left-0 bg-amber-500/80 transition-all duration-300"
                style={{
                  width: `${Math.max(0, Math.min(100, (myTeam.trailingHp / myTeam.maxHp) * 100))}%`,
                }}
              />
              <div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-100"
                style={{
                  width: `${Math.max(0, Math.min(100, (myTeam.hp / myTeam.maxHp) * 100))}%`,
                }}
              />
            </div>
          </div>

          {/* Economy Strip: Gold, XP, Supply */}
          <div className="flex items-center gap-2.5 pl-2.5 border-l border-slate-700/80">
            {/* Gold */}
            <div className="flex items-center gap-1.5" title="Mevcut Altın">
              <GoldCoinIcon className="w-5 h-5 shrink-0" />
              <div
                data-testid="player-gold"
                className="font-mono-num font-extrabold text-amber-300 text-base sm:text-lg leading-none"
              >
                {Math.round(myTeam.gold)}
              </div>
            </div>

            {/* XP */}
            <div className="flex items-center gap-1.5" title="Deneyim (XP) - Çağ atlamak için gerekir">
              <XpStarIcon className="w-4 h-4 shrink-0" />
              <div
                data-testid="player-xp"
                className="font-mono-num font-bold text-purple-300 text-xs sm:text-sm leading-none"
              >
                {Math.round(myTeam.xp)}
                {myTeam.era < ERAS.length - 1 && (
                  <span className="text-[10px] text-slate-400 font-normal">
                    /{myEra.evolveXpCost}
                  </span>
                )}
              </div>
            </div>

            {/* Supply (Nüfus) */}
            <div
              className={`px-1.5 py-0.5 rounded text-[11px] font-mono-num font-bold border ${
                supplyUsed >= supplyCap
                  ? 'bg-rose-950/80 border-rose-500 text-rose-300 animate-pulse'
                  : 'bg-black/40 border-slate-800 text-slate-300'
              }`}
              title="Nüfus: Sahadaki ve kuyruktaki toplam asker hacmi"
            >
              Nüf {supplyUsed}/{supplyCap}
            </div>
          </div>
        </div>

        {/* CENTER: 4 Unit Production Cards + Action Cluster (Towers, Doctrine, Evolve, Special) */}
        <div className="flex items-center gap-1.5 sm:gap-2 flex-1 justify-center max-w-[700px]">
          {/* 4 Unit Cards */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            {myUnits.map((u, idx) => {
              const uSupply = getUnitSupply(u.archetype);
              const hasSupply = supplyUsed + uSupply <= supplyCap;
              const canAfford = myTeam.gold >= u.cost && myTeam.queue.length < 5 && hasSupply;

              const archetypeColors: Record<string, { border: string; glow: string; text: string }> = {
                swarmer: { border: 'border-amber-500/70', glow: 'hover:border-amber-400 hover:shadow-[0_0_12px_rgba(245,158,11,0.35)]', text: 'text-amber-300' },
                ranger: { border: 'border-emerald-500/70', glow: 'hover:border-emerald-400 hover:shadow-[0_0_12px_rgba(16,185,129,0.35)]', text: 'text-emerald-300' },
                charger: { border: 'border-sky-500/70', glow: 'hover:border-sky-400 hover:shadow-[0_0_12px_rgba(56,189,248,0.35)]', text: 'text-sky-300' },
                colossus: { border: 'border-purple-500/70', glow: 'hover:border-purple-400 hover:shadow-[0_0_12px_rgba(168,85,247,0.35)]', text: 'text-purple-300' },
              };
              const archStyle = archetypeColors[u.archetype] || archetypeColors.swarmer;

              return (
                <button
                  key={u.id}
                  type="button"
                  tabIndex={-1}
                  title={`${u.name} [${idx + 1}]\nBedel: ${u.cost} Altın\nHasar: ${u.damage} · Can: ${u.hp} · Nüfus: ${uSupply}\n${u.roleClue}`}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onCommand({
                      type: 'SPAWN_UNIT',
                      team: hud.playerTeam,
                      defId: u.id,
                    });
                  }}
                  className={`w-[56px] sm:w-[62px] h-[66px] rounded-lg border-2 text-center transition-all flex flex-col items-center justify-between p-1 relative overflow-hidden group cursor-pointer ${
                    canAfford
                      ? `bg-gradient-to-b from-[#161d2b] to-[#0c111a] ${archStyle.border} ${archStyle.glow} active:scale-95`
                      : 'bg-[#0b0e14] border-slate-800 opacity-45 grayscale cursor-not-allowed'
                  }`}
                >
                  {/* Portrait & Keycap Tag */}
                  <div className="w-8 h-8 rounded bg-[#05070b] border border-slate-700/80 flex items-center justify-center relative overflow-hidden shrink-0 mt-0.5">
                    <img
                      src={`/assets/ui/portraits/${u.id}.png`}
                      alt={u.name}
                      className="w-full h-full object-contain group-hover:scale-110 transition-transform"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                    <div className="absolute inset-0 flex items-center justify-center -z-10">
                      <ArchetypeSvgIcon archetype={u.archetype} accent={u.accentColor} />
                    </div>
                  </div>

                  {/* Keycap Badge */}
                  <span className="absolute top-1 right-1 text-[9px] font-mono-num font-extrabold px-1 rounded bg-black/80 text-amber-300 border border-slate-800 leading-tight">
                    {idx + 1}
                  </span>

                  {/* Cost Tag */}
                  <div className="font-mono-num font-bold text-[11px] text-amber-300 leading-none">
                    {u.cost}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="w-px h-11 bg-slate-700/80 mx-1 shrink-0 hidden sm:block" />

          {/* Action Buttons: Towers [T], Doctrine [G], Evolve [Q], Special [Space] */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Towers Button [T] */}
            <button
              type="button"
              tabIndex={-1}
              title="Kale Savunma Kuleleri [T]"
              onClick={(e) => {
                e.currentTarget.blur();
                setActiveDrawer(activeDrawer === 'turrets' ? 'none' : 'turrets');
              }}
              className={`h-[66px] px-2 sm:px-2.5 rounded-lg border-2 flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                activeDrawer === 'turrets'
                  ? 'bg-amber-600/35 border-amber-400 text-amber-200 shadow-[0_0_12px_rgba(245,158,11,0.4)]'
                  : 'bg-[#121824] border-slate-700 hover:border-amber-500/80 text-slate-300 active:scale-95'
              }`}
            >
              <div className="w-6 h-6 shrink-0 flex items-center justify-center">
                <img
                  src="/assets/ui/actions/btn_towers.png"
                  alt="Kuleler"
                  className="w-full h-full object-contain"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              </div>
              <div className="flex flex-col items-center leading-none">
                <span className="text-[10px] font-bold">Kule [T]</span>
                <span className="text-[9px] font-mono-num text-amber-400 mt-0.5">
                  {myTeam.turrets.filter(Boolean).length}/{myTeam.unlockedTurretSlots}
                </span>
              </div>
            </button>

            {/* Doctrine Button [G] */}
            <button
              type="button"
              tabIndex={-1}
              title="Komutan Doktrinleri & Kalıcı Teknoloji [G]"
              onClick={(e) => {
                e.currentTarget.blur();
                setActiveDrawer(activeDrawer === 'doctrines' ? 'none' : 'doctrines');
              }}
              className={`h-[66px] px-2 sm:px-2.5 rounded-lg border-2 flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                activeDrawer === 'doctrines'
                  ? 'bg-emerald-600/35 border-emerald-400 text-emerald-200 shadow-[0_0_12px_rgba(16,185,129,0.4)]'
                  : 'bg-[#121824] border-slate-700 hover:border-emerald-500/80 text-slate-300 active:scale-95'
              }`}
            >
              <div className="w-6 h-6 shrink-0 flex items-center justify-center">
                <img
                  src="/assets/ui/actions/btn_doctrine.png"
                  alt="Doktrin"
                  className="w-full h-full object-contain"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              </div>
              <div className="flex flex-col items-center leading-none">
                <span className="text-[10px] font-bold">Doktrin [G]</span>
                <span className="text-[9px] font-mono-num text-emerald-400 mt-0.5">
                  (
                  {myTeam.doctrines.economyLevel +
                    myTeam.doctrines.warfareLevel +
                    myTeam.doctrines.fortressLevel}
                  )
                </span>
              </div>
            </button>

            {/* Evolve Era Button [Q] */}
            <button
              type="button"
              tabIndex={-1}
              disabled={!canEvolve}
              title={
                myTeam.era >= ERAS.length - 1
                  ? 'Son Çağdasınız'
                  : canEvolve
                  ? `Sonraki Çağa Atla! [Q]`
                  : `Gereken: ${Math.round(myTeam.xp)} / ${myEra.evolveXpCost} XP`
              }
              onClick={(e) => {
                e.currentTarget.blur();
                onCommand({ type: 'EVOLVE_ERA', team: hud.playerTeam });
              }}
              className={`h-[66px] px-2 sm:px-2.5 rounded-lg border-2 flex flex-col items-center justify-center gap-1 transition-all ${
                canEvolve
                  ? 'bg-gradient-to-b from-purple-800 to-purple-950 border-purple-400 text-purple-100 shadow-[0_0_16px_rgba(168,85,247,0.6)] animate-pulse cursor-pointer active:scale-95'
                  : 'bg-[#0f131c] border-slate-800/80 text-slate-500 opacity-60 cursor-not-allowed'
              }`}
            >
              <div className="w-6 h-6 shrink-0 flex items-center justify-center">
                <img
                  src="/assets/ui/actions/btn_evolve.png"
                  alt="Çağ Atla"
                  className="w-full h-full object-contain"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              </div>
              <div className="flex flex-col items-center leading-none">
                <span className="text-[10px] font-bold">Çağ [Q]</span>
                <span className="text-[9px] font-mono-num text-purple-300 mt-0.5">
                  {myTeam.era >= ERAS.length - 1 ? 'MAX' : `${Math.round(myTeam.xp)}XP`}
                </span>
              </div>
            </button>

            {/* Special Power Button [Space] */}
            <button
              type="button"
              tabIndex={-1}
              disabled={myTeam.specialCooldown > 0}
              title={`${myEra.specialName} [Space]\n${
                myTeam.specialCooldown > 0
                  ? `Dolum: ${myTeam.specialCooldown.toFixed(1)}s`
                  : 'HAZIR - Düşman hattına devasa yıkım yağdır!'
              }`}
              onClick={(e) => {
                e.currentTarget.blur();
                onCommand({ type: 'CAST_SPECIAL', team: hud.playerTeam });
              }}
              className={`h-[66px] px-2.5 sm:px-3 rounded-lg border-2 flex items-center gap-2 transition-all ${
                myTeam.specialCooldown <= 0
                  ? 'bg-gradient-to-r from-[#321018] via-[#4d1424] to-[#321018] border-amber-400 text-amber-100 shadow-[0_0_18px_rgba(244,63,94,0.45)] hover:border-amber-300 active:scale-95 cursor-pointer'
                  : 'bg-[#0f131c] border-slate-800/80 text-slate-500 opacity-55 cursor-not-allowed'
              }`}
            >
              <div
                className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 overflow-hidden border ${
                  myTeam.specialCooldown <= 0
                    ? 'border-amber-400 bg-amber-500/20 shadow-[0_0_8px_rgba(245,158,11,0.6)]'
                    : 'border-slate-800 bg-black/40'
                }`}
              >
                <img
                  src={`/assets/ui/powers/${POWER_ICONS[myTeam.era] || 'power_meteor'}.png`}
                  alt="Özel Güç"
                  className="w-full h-full object-contain"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              </div>
              <div className="flex flex-col text-left leading-tight">
                <span className="text-[10px] font-extrabold text-amber-200">
                  GÜÇ [Space]
                </span>
                <span className="text-[10px] font-mono-num font-bold mt-0.5">
                  {myTeam.specialCooldown > 0 ? (
                    <span className="text-slate-400">{myTeam.specialCooldown.toFixed(1)}s</span>
                  ) : (
                    <span className="text-rose-400 animate-pulse font-extrabold">HAZIR!</span>
                  )}
                </span>
              </div>
            </button>
          </div>
        </div>

        {/* RIGHT: Enemy Fortress HP & Utilities */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex flex-col gap-1 min-w-[130px] sm:min-w-[160px] text-right">
            <div className="flex items-center justify-between text-[11px] leading-tight">
              <span className="font-mono-num font-bold text-rose-400 text-xs">
                {Math.round(enemyTeam.hp)} / {enemyTeam.maxHp}
              </span>
              <span className="font-bold text-rose-300 truncate max-w-[100px]">
                {enemyTeam.name}
              </span>
            </div>
            {/* Red Enemy Fortress Health Bar */}
            <div className="w-full h-3 bg-[#06080d] rounded-sm overflow-hidden relative border border-slate-700/80 shadow-inner">
              <div
                className="absolute inset-y-0 right-0 bg-amber-500/80 transition-all duration-300"
                style={{
                  width: `${Math.max(0, Math.min(100, (enemyTeam.trailingHp / enemyTeam.maxHp) * 100))}%`,
                }}
              />
              <div
                className="absolute inset-y-0 right-0 bg-gradient-to-l from-rose-600 to-rose-400 transition-all duration-100"
                style={{
                  width: `${Math.max(0, Math.min(100, (enemyTeam.hp / enemyTeam.maxHp) * 100))}%`,
                }}
              />
            </div>
          </div>

          {/* Time & System Icon Buttons */}
          <div className="flex items-center gap-1 pl-2 border-l border-slate-700/80">
            <span className="text-xs font-mono-num font-bold text-slate-300 pr-1 hidden sm:inline" title="Savaş Süresi">
              {formatTime(hud.elapsedTime)}
            </span>

            {/* Mute [M] */}
            <button
              type="button"
              tabIndex={-1}
              aria-label={muted ? 'Sesi Aç [M]' : 'Sesi Kapat [M]'}
              title={muted ? 'Sesi Aç [M]' : 'Sesi Kapat [M]'}
              onClick={(e) => {
                e.currentTarget.blur();
                onToggleMute();
              }}
              className="w-8 h-8 rounded bg-[#121824] border border-slate-700 hover:border-amber-400 flex items-center justify-center text-slate-200 cursor-pointer"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
                {muted ? (
                  <path d="M22 9l-6 6M16 9l6 6" stroke="#f87171" strokeWidth="2.5" />
                ) : (
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" />
                )}
              </svg>
            </button>

            {/* Pause [P] */}
            <button
              type="button"
              tabIndex={-1}
              aria-label="Oyunu Duraklat [P]"
              title="Oyunu Duraklat [P]"
              onClick={(e) => {
                e.currentTarget.blur();
                onPause();
              }}
              className="w-8 h-8 rounded bg-[#121824] border border-slate-700 hover:border-amber-400 flex items-center justify-center text-slate-200 cursor-pointer"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="10" y1="5" x2="10" y2="19" />
                <line x1="14" y1="5" x2="14" y2="19" />
              </svg>
            </button>

            {/* Restart [R] */}
            <button
              type="button"
              tabIndex={-1}
              aria-label="Yeniden Başlat [R]"
              title="Yeniden Başlat [R]"
              onClick={(e) => {
                e.currentTarget.blur();
                onRestart();
              }}
              className="w-8 h-8 rounded bg-[#121824] border border-slate-700 hover:border-amber-400 flex items-center justify-center text-slate-200 cursor-pointer"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
            </button>

            {/* Sinyal / Emotes */}
            <button
              type="button"
              tabIndex={-1}
              aria-label="Sinyal Gönder"
              title="Savaş Sinyali Gönder"
              onClick={(e) => {
                e.currentTarget.blur();
                setActiveDrawer(activeDrawer === 'emotes' ? 'none' : 'emotes');
              }}
              className="px-1.5 py-1 rounded bg-[#121824] border border-sky-800 hover:border-sky-400 text-sky-300 text-[10px] font-bold cursor-pointer"
            >
              Sinyal
            </button>
          </div>
        </div>
      </div>

      {/* =========================================================================
          PRODUCTION QUEUE BAR (SLIDES DOWN DIRECTLY BENEATH UNIT BUTTONS)
          ========================================================================= */}
      {myTeam.queue.length > 0 && (
        <div className="pointer-events-auto mx-auto mt-1 flex items-center gap-2 bg-[#090d16]/95 border border-amber-600/60 rounded-full px-3 py-1 shadow-lg backdrop-blur-sm animate-fade-in">
          <span className="text-[10px] font-bold text-amber-300">
            Eğitim Kuyruğu ({myTeam.queue.length}/5):
          </span>
          <div className="flex items-center gap-1.5">
            {myTeam.queue.map((q, idx) => {
              const uDef = getUnitById(q.unitDefId);
              const pct =
                idx === 0
                  ? Math.round(((q.totalTime - q.remainingTime) / q.totalTime) * 100)
                  : 0;
              return (
                <button
                  key={idx}
                  type="button"
                  title="İptal etmek ve altın iadesi almak için tıklayın"
                  onClick={() =>
                    onCommand({ type: 'CANCEL_QUEUE', team: hud.playerTeam, slotIndex: idx })
                  }
                  className="px-2 py-0.5 rounded-full bg-slate-800 hover:bg-rose-950 border border-slate-600 text-[10px] text-amber-200 font-mono-num cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1"
                >
                  <span>{uDef?.name.split(' ')[0]}</span>
                  {idx === 0 && <span className="text-emerald-400 font-bold">{pct}%</span>}
                  <span className="text-slate-400 hover:text-rose-400">✕</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* =========================================================================
          EVENT BANNER (NON-INTERACTIVE ANNOUNCEMENT)
          ========================================================================= */}
      {hud.activeBanner && (
        <div className="mx-auto mt-2 px-5 py-1.5 rounded-lg bg-[#0c1018]/95 border-2 border-amber-500/80 text-center shadow-lg">
          <span
            className="font-display font-bold text-sm sm:text-base tracking-wider"
            style={{ color: hud.activeBanner.color }}
          >
            {hud.activeBanner.text}
          </span>
        </div>
      )}

      {/* =========================================================================
          DROPDOWN DRAWERS (TURRETS, DOCTRINES, EMOTES)
          ========================================================================= */}
      {activeDrawer === 'turrets' && (
        <div className="fixed top-[82px] left-1/2 -translate-x-1/2 w-full max-w-[860px] pointer-events-auto bg-[#090d16]/98 border-2 border-amber-600/90 rounded-xl p-3.5 shadow-2xl z-30 backdrop-blur-md">
          <div className="flex items-center justify-between gap-4 mb-2.5 pb-2 border-b border-slate-800">
            <div className="text-xs sm:text-sm font-bold text-amber-300">
              KALE SAVUNMA KULELERİ (Yuva Seçin & Kule Kurun / Yükseltin)
            </div>
            <button
              type="button"
              onClick={() => setActiveDrawer('none')}
              className="text-xs text-slate-400 hover:text-white px-2 py-0.5 rounded bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              Kapat [ESC]
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* 4 Base Turret Slots */}
            <div className="grid grid-cols-4 gap-2">
              {[0, 1, 2, 3].map((slotIdx) => {
                const unlocked = slotIdx < myTeam.unlockedTurretSlots;
                const inst = myTeam.turrets[slotIdx];
                const def = inst ? getTurretById(inst.turretDefId) : null;
                const isSelected = selectedTurretSlot === slotIdx;

                if (!unlocked) {
                  const isNextUnlock = slotIdx === myTeam.unlockedTurretSlots;
                  return (
                    <button
                      key={slotIdx}
                      type="button"
                      disabled={!isNextUnlock || myTeam.gold < nextSlotUnlockCost}
                      onClick={() => {
                        onCommand({ type: 'UNLOCK_SLOT', team: hud.playerTeam });
                        setSelectedTurretSlot(slotIdx);
                      }}
                      className={`p-2 rounded-lg border text-left flex flex-col justify-between ${
                        isNextUnlock && myTeam.gold >= nextSlotUnlockCost
                          ? 'bg-amber-950/40 border-amber-500/80 hover:bg-amber-900/50 cursor-pointer'
                          : 'bg-slate-900/60 border-slate-800 opacity-60 cursor-not-allowed'
                      }`}
                    >
                      <span className="text-[11px] font-bold text-slate-300">
                        Yuva {slotIdx + 1}
                      </span>
                      {isNextUnlock ? (
                        <span className="text-xs font-mono-num font-bold text-amber-400">
                          Aç: {nextSlotUnlockCost}A
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-500">Kilitli</span>
                      )}
                    </button>
                  );
                }

                return (
                  <button
                    key={slotIdx}
                    type="button"
                    onClick={() => setSelectedTurretSlot(slotIdx)}
                    className={`p-2 rounded-lg border text-left flex flex-col justify-between cursor-pointer ${
                      isSelected
                        ? 'bg-sky-950/60 border-sky-400'
                        : 'bg-[#131a27] border-slate-700 hover:border-slate-500'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-sky-300">
                        Yuva {slotIdx + 1}
                      </span>
                      {inst && (
                        <span className="text-[10px] font-mono-num text-amber-300">
                          Sv.{inst.level}
                        </span>
                      )}
                    </div>
                    <div className="text-xs font-semibold text-white truncate">
                      {def ? def.name : 'Boş Yuva'}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Actions for Selected Turret Slot */}
            <div className="flex flex-wrap items-center gap-2">
              {myTurrets.map((tDef) => (
                <button
                  key={tDef.id}
                  type="button"
                  disabled={myTeam.gold < tDef.cost}
                  onClick={() =>
                    onCommand({
                      type: 'BUILD_TURRET',
                      team: hud.playerTeam,
                      slotIndex: selectedTurretSlot,
                      defId: tDef.id,
                    })
                  }
                  className={`flex-1 min-w-[140px] p-2 rounded-lg border text-left transition-colors flex items-center gap-2 ${
                    myTeam.gold >= tDef.cost
                      ? 'bg-[#151e2e] border-amber-500/70 hover:bg-slate-800 cursor-pointer'
                      : 'bg-slate-900/50 border-slate-800 opacity-50 cursor-not-allowed'
                  }`}
                >
                  <div className="w-9 h-9 rounded bg-[#090d16] border border-slate-700/80 shrink-0 flex items-center justify-center overflow-hidden">
                    <img
                      src={`/assets/ui/towers/${tDef.id}.png`}
                      alt={tDef.name}
                      className="w-full h-full object-contain"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-white truncate">{tDef.name}</div>
                    <div className="text-[10px] font-mono-num font-bold text-amber-400">
                      {tDef.cost} Altın · Hsr {tDef.damage}
                    </div>
                  </div>
                </button>
              ))}

              {myTeam.turrets[selectedTurretSlot] && (
                <div className="flex gap-1.5 w-full mt-1">
                  <button
                    type="button"
                    onClick={() =>
                      onCommand({
                        type: 'UPGRADE_TURRET',
                        team: hud.playerTeam,
                        slotIndex: selectedTurretSlot,
                      })
                    }
                    className="flex-1 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs cursor-pointer text-center"
                  >
                    Kuleyi Yükselt
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onCommand({
                        type: 'SELL_TURRET',
                        team: hud.playerTeam,
                        slotIndex: selectedTurretSlot,
                      })
                    }
                    className="py-1.5 px-3 rounded-lg bg-rose-700 hover:bg-rose-600 text-white font-bold text-xs cursor-pointer whitespace-nowrap"
                  >
                    Sat (+%70)
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeDrawer === 'doctrines' && (
        <div className="fixed top-[82px] left-1/2 -translate-x-1/2 w-full max-w-[800px] pointer-events-auto bg-[#090d16]/98 border-2 border-emerald-600/90 rounded-xl p-3.5 shadow-2xl z-30 backdrop-blur-md">
          <div className="flex items-center justify-between gap-4 mb-2.5 pb-2 border-b border-slate-800">
            <div className="text-xs sm:text-sm font-bold text-emerald-300">
              KOMUTAN DOKTRİNLERİ & KALICI TEKNOLOJİ AĞACI
            </div>
            <button
              type="button"
              onClick={() => setActiveDrawer('none')}
              className="text-xs text-slate-400 hover:text-white px-2 py-0.5 rounded bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              Kapat [ESC]
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {(
              [
                {
                  key: 'economy',
                  title: 'Savaş Ganimeti & Lojistik',
                  desc: 'Öldürülen düşmandan kazanılan Altın/XP ödülünü ve ikmali artırır.',
                  level: myTeam.doctrines.economyLevel,
                },
                {
                  key: 'warfare',
                  title: 'Çelik & Taktik Doktrini',
                  desc: 'Tüm birim/kule hasarını artırır ve Özel Güç dolumunu hızlandırır.',
                  level: myTeam.doctrines.warfareLevel,
                },
                {
                  key: 'fortress',
                  title: 'Sur Tahkimatı & Savunma',
                  desc: 'Birim canını artırır, kale hasarını azaltır ve savunmayı güçlendirir.',
                  level: myTeam.doctrines.fortressLevel,
                },
              ] as const
            ).map((doc) => {
              const cost = getDoctrineCost(doc.key, doc.level, myTeam.era);
              const maxed = doc.level >= 5;
              const canAfford = !maxed && myTeam.gold >= cost;

              return (
                <div
                  key={doc.key}
                  className="bg-[#121927] border border-slate-700/80 rounded-lg p-2.5 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="font-bold text-white text-xs">{doc.title}</span>
                      <span className="font-mono-num text-xs font-bold text-emerald-400">
                        {doc.level}/5
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-400 leading-relaxed mb-2">
                      {doc.desc}
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={!canAfford}
                    onClick={() =>
                      onCommand({
                        type: 'UPGRADE_DOCTRINE',
                        team: hud.playerTeam,
                        doctrineKey: doc.key,
                      })
                    }
                    className={`w-full py-1.5 rounded font-mono-num font-bold text-xs transition-colors ${
                      maxed
                        ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                        : canAfford
                        ? 'bg-emerald-600 hover:bg-emerald-500 text-slate-950 cursor-pointer'
                        : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                    }`}
                  >
                    {maxed ? 'MAKSİMUM SEVİYE' : `Yükselt: ${cost} Altın`}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeDrawer === 'emotes' && (
        <div className="fixed top-[82px] left-1/2 -translate-x-1/2 pointer-events-auto bg-[#090d16]/98 border border-sky-500/80 rounded-full px-4 py-2 flex items-center gap-2 shadow-2xl z-30 backdrop-blur-md">
          <span className="text-xs font-semibold text-sky-300">Savaş Sinyali:</span>
          {['Taarruza Geç!', 'Kaleyi Savun!', 'Çağ Atlıyorum!', 'İyi Savaştı!'].map((msg) => (
            <button
              key={msg}
              type="button"
              onClick={() => {
                onCommand({ type: 'EMOTE', team: hud.playerTeam, emoteText: msg });
                setActiveDrawer('none');
              }}
              className="px-2.5 py-1 rounded-full bg-slate-800 hover:bg-sky-500 hover:text-slate-950 text-xs text-slate-200 font-medium cursor-pointer whitespace-nowrap shrink-0"
            >
              {msg}
            </button>
          ))}
        </div>
      )}

      {/* =========================================================================
          BOTTOM AREA: UNOBSTRUCTED BATTLEFIELD + SLEEK MINIMAL RADAR PILL
          ========================================================================= */}
      <div className="w-full flex flex-col items-center gap-1.5 pb-2">
        {/* Sleek Translucent Mini Radar & Camera Panning */}
        <div className="pointer-events-auto bg-[#080d16]/80 hover:bg-[#080d16]/95 border border-slate-700/60 hover:border-amber-500/60 rounded-full px-3 py-1 flex items-center gap-3 backdrop-blur-sm shadow-lg transition-all">
          <button
            type="button"
            tabIndex={-1}
            title="Sol Kaleye Git [A]"
            onClick={() => onJumpCamera?.(0)}
            className="text-[10px] font-bold text-slate-400 hover:text-amber-300 cursor-pointer px-1 leading-none"
          >
            ◀ Sol [A]
          </button>

          {/* Radar Slider Strip */}
          <div
            role="slider"
            aria-label="Savaş Hattı Radar"
            aria-valuemin={0}
            aria-valuemax={WORLD_WIDTH}
            aria-valuenow={Math.round(hud.cameraX)}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = (e.clientX - rect.left) / Math.max(1, rect.width);
              onJumpCamera?.(ratio);
            }}
            className="w-48 sm:w-64 h-3.5 bg-black/60 border border-slate-800 rounded-full relative overflow-hidden cursor-pointer"
          >
            {/* Viewport Box */}
            <div
              className="absolute inset-y-0 border border-amber-400/80 bg-amber-400/20 rounded-full"
              style={{
                left: `${Math.max(0, Math.min(72, (hud.cameraX / WORLD_WIDTH) * 100))}%`,
                width: '28%',
              }}
            />
            {/* Castle Pins */}
            <div className="absolute left-1 top-0.5 bottom-0.5 w-1 bg-sky-400 rounded-full" />
            <div className="absolute right-1 top-0.5 bottom-0.5 w-1 bg-rose-500 rounded-full" />

            {/* Troop Dots */}
            {hud.unitRadar.map((u, idx) => (
              <div
                key={idx}
                className={`absolute top-1 w-1.5 h-1.5 rounded-full ${
                  u.team === 1 ? 'bg-sky-400' : 'bg-rose-500'
                }`}
                style={{ left: `${Math.max(2, Math.min(96, (u.x / WORLD_WIDTH) * 100))}%` }}
              />
            ))}
          </div>

          <button
            type="button"
            tabIndex={-1}
            title="Sağ Kaleye Git [D]"
            onClick={() => onJumpCamera?.(1)}
            className="text-[10px] font-bold text-slate-400 hover:text-amber-300 cursor-pointer px-1 leading-none"
          >
            Sağ [D] ▶
          </button>
        </div>

        {/* If in 2-Player Local Mode, compact secondary command strip for Player 2 */}
        {mode === 'local2p' && (
          <div className="w-full max-w-[1080px] pointer-events-auto bg-[#140c16]/95 border border-rose-700/80 rounded-lg px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 text-xs backdrop-blur-sm">
            <span className="font-bold text-rose-300">
              2. Komutan ({Math.round(hud.team2.gold)}A · {Math.round(hud.team2.xp)}XP):
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {p2Units.map((u, idx) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => onCommand({ type: 'SPAWN_UNIT', team: 2, defId: u.id })}
                  className="px-2 py-0.5 rounded bg-rose-950/80 hover:bg-rose-800 border border-rose-600/60 text-rose-100 font-mono-num cursor-pointer whitespace-nowrap shrink-0 text-xs"
                >
                  [{(idx + 7) % 10}] {u.name.split(' ')[0]} ({u.cost}A)
                </button>
              ))}
              <button
                type="button"
                onClick={() => onCommand({ type: 'EVOLVE_ERA', team: 2 })}
                className="px-2 py-0.5 rounded bg-purple-900 hover:bg-purple-700 text-white font-bold cursor-pointer whitespace-nowrap shrink-0 text-xs"
              >
                [U] Çağ Atla
              </button>
              <button
                type="button"
                onClick={() => onCommand({ type: 'CAST_SPECIAL', team: 2 })}
                className="px-2 py-0.5 rounded bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold cursor-pointer whitespace-nowrap shrink-0 text-xs"
              >
                [Enter] Güç
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
