import React, { useState } from 'react';
import {
  ERAS,
  WORLD_WIDTH,
  getDoctrineCost,
  getEraTurrets,
  getEraUnits,
  getTurretById,
  getUnitById,
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

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 z-10 pointer-events-none flex flex-col justify-between p-3 md:p-4">
      {/* TOP PERIMETER BAR: Fortress Readouts + Minimap Radar + Utility Controls */}
      <div className="w-full flex items-start justify-between gap-3">
        {/* Top-Left: Player Fortress Status & Resources */}
        <div className="pointer-events-auto bg-[#0c1018]/94 border border-amber-700/70 rounded-lg px-3.5 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.85)] min-w-[270px] sm:min-w-[320px]">
          <div className="flex items-center justify-between gap-3 mb-1.5">
            <div className="flex items-center gap-2">
              <span
                className="w-2.5 h-2.5 rounded-sm shrink-0"
                style={{ backgroundColor: myEra.accentColor }}
              />
              <span className="font-display font-bold text-xs sm:text-sm text-amber-100 truncate max-w-[150px]">
                {myTeam.name}
              </span>
            </div>
            <span className="text-xs font-semibold text-amber-400 whitespace-nowrap shrink-0">
              Çağ {myTeam.era + 1}: {myEra.name}
            </span>
          </div>

          {/* Fortress Health Bar with Delayed Trailing Ghost Bar */}
          <div className="mb-2">
            <div className="flex items-center justify-between text-[11px] text-slate-300 mb-0.5">
              <span className="uppercase tracking-wider font-semibold text-slate-400">
                KALE CANI
              </span>
              <span className="font-mono-num font-bold text-emerald-400">
                {Math.round(myTeam.hp)} / {myTeam.maxHp}
              </span>
            </div>
            <div className="w-full h-2.5 bg-[#06080d] rounded overflow-hidden relative border border-slate-800">
              <div
                className="absolute inset-y-0 left-0 bg-amber-500"
                style={{
                  width: `${Math.max(0, Math.min(100, (myTeam.trailingHp / myTeam.maxHp) * 100))}%`,
                }}
              />
              <div
                className="absolute inset-y-0 left-0 bg-emerald-500"
                style={{
                  width: `${Math.max(0, Math.min(100, (myTeam.hp / myTeam.maxHp) * 100))}%`,
                }}
              />
            </div>
          </div>

          {/* Primary Gold & XP Readouts */}
          <div className="flex items-center justify-between gap-4 pt-1 border-t border-slate-800/90">
            <div className="flex items-center gap-1.5">
              <GoldCoinIcon className="w-5 h-5 shrink-0" />
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400 leading-none">
                  ALTIN
                </div>
                <div
                  data-testid="player-gold"
                  className="text-base sm:text-lg font-mono-num font-bold text-amber-300 leading-tight"
                >
                  {Math.round(myTeam.gold)}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <XpStarIcon className="w-5 h-5 shrink-0" />
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400 leading-none">
                  DENEYİM (XP)
                </div>
                <div
                  data-testid="player-xp"
                  className="text-base sm:text-lg font-mono-num font-bold text-purple-300 leading-tight"
                >
                  {Math.round(myTeam.xp)}
                  {myTeam.era < ERAS.length - 1 && (
                    <span className="text-xs text-slate-400 font-normal">
                      {' '}
                      / {myEra.evolveXpCost}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Top-Center: Live Lane Radar & Battle Clock */}
        <div className="hidden lg:flex flex-col items-center gap-1.5 pointer-events-auto bg-[#0c1018]/94 border border-slate-700/80 rounded-lg px-4 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.85)] min-w-[360px]">
          <div className="w-full flex items-center justify-between gap-3 text-xs text-slate-300 font-mono-num">
            <span>SÜRE: {formatTime(hud.elapsedTime)}</span>
            <span
              title="Rakip kaleye ne kadar yakın düşman öldürürseniz o kadar yüksek yüzdeli altın kazanırsınız (%45 - %225)"
              className={`font-bold ${
                hud.frontlineBonusPct >= 135
                  ? 'text-emerald-400'
                  : hud.frontlineBonusPct <= 70
                  ? 'text-amber-300'
                  : 'text-sky-300'
              }`}
            >
              Taarruz Ganimeti: %{hud.frontlineBonusPct}
            </span>
            {mode === 'online' ? (
              <div className="flex items-center gap-1.5">
                <span className="text-emerald-300">
                  {roomCode ? `ODA #${roomCode}` : 'ONLINE'}
                </span>
                {onManualSync && (
                  <button
                    type="button"
                    tabIndex={-1}
                    title={networkLabel || 'Bağlantıyı ve oyun durumunu anında senkronize et'}
                    onClick={(e) => {
                      e.currentTarget.blur();
                      onManualSync();
                    }}
                    className="px-1.5 py-0.5 rounded bg-sky-900/80 hover:bg-sky-600 text-[10px] font-bold text-sky-100 border border-sky-500/60 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Senkronize Et
                  </button>
                )}
              </div>
            ) : (
              <span>{mode === 'local2p' ? '2 KİŞİLİK DÜELLO' : 'KOMUTAN SEFERİ'}</span>
            )}
          </div>

          {/* Interactive Battlefield Minimap Strip */}
          <div
            role="slider"
            aria-label="Savaş Hattı Kamera Konumu"
            aria-valuemin={0}
            aria-valuemax={WORLD_WIDTH}
            aria-valuenow={Math.round(hud.cameraX)}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = (e.clientX - rect.left) / Math.max(1, rect.width);
              onJumpCamera?.(ratio);
            }}
            className="w-full h-5 bg-[#070a10] border border-slate-800 rounded relative overflow-hidden cursor-pointer"
          >
            {/* Viewport Camera Box */}
            <div
              className="absolute inset-y-0 border border-amber-400/70 bg-amber-400/15"
              style={{
                left: `${Math.max(0, Math.min(72, (hud.cameraX / WORLD_WIDTH) * 100))}%`,
                width: '28%',
              }}
            />
            {/* Base Pins */}
            <div className="absolute left-1.5 top-1 bottom-1 w-1.5 bg-sky-400 rounded-xs" />
            <div className="absolute right-1.5 top-1 bottom-1 w-1.5 bg-rose-500 rounded-xs" />

            {/* Live Unit Radar Dots */}
            {hud.unitRadar.map((u, idx) => (
              <div
                key={idx}
                className={`absolute top-1.5 w-2 h-2 rounded-full ${
                  u.team === 1 ? 'bg-sky-400' : 'bg-rose-500'
                }`}
                style={{ left: `${Math.max(3, Math.min(96, (u.x / WORLD_WIDTH) * 100))}%` }}
              />
            ))}
          </div>

          {/* Camera Pan Quick Buttons */}
          <div className="w-full flex items-center justify-between text-[11px] text-slate-400">
            <button
              type="button"
              tabIndex={-1}
              onMouseDown={() => onPanCamera(-1)}
              onMouseUp={() => onPanCamera(0)}
              onMouseLeave={() => onPanCamera(0)}
              onClick={() => onJumpCamera?.(0)}
              className="hover:text-amber-300 cursor-pointer whitespace-nowrap shrink-0"
            >
              ◀ Sol Kale [A]
            </button>
            <span>Haritaya Tıkla / Kaydır</span>
            <button
              type="button"
              tabIndex={-1}
              onMouseDown={() => onPanCamera(1)}
              onMouseUp={() => onPanCamera(0)}
              onMouseLeave={() => onPanCamera(0)}
              onClick={() => onJumpCamera?.(1)}
              className="hover:text-amber-300 cursor-pointer whitespace-nowrap shrink-0"
            >
              Sağ Kale [D] ▶
            </button>
          </div>
        </div>

        {/* Top-Right: Enemy Fortress Status & Utility Square Buttons */}
        <div className="flex items-start gap-2 pointer-events-auto">
          <div className="bg-[#0c1018]/94 border border-rose-800/70 rounded-lg px-3.5 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.85)] min-w-[220px] sm:min-w-[260px]">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="font-display font-bold text-xs sm:text-sm text-rose-200 truncate max-w-[135px]">
                {enemyTeam.name}
              </span>
              <span className="text-xs font-semibold text-rose-400 whitespace-nowrap shrink-0">
                Çağ {enemyTeam.era + 1}: {enemyEra.name}
              </span>
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-300 mb-0.5">
              <span className="uppercase tracking-wider font-semibold text-slate-400">
                RAKİP KALE
              </span>
              <span className="font-mono-num font-bold text-rose-400">
                {Math.round(enemyTeam.hp)} / {enemyTeam.maxHp}
              </span>
            </div>
            <div className="w-full h-2.5 bg-[#06080d] rounded overflow-hidden relative border border-slate-800">
              <div
                className="absolute inset-y-0 right-0 bg-amber-500"
                style={{
                  width: `${Math.max(
                    0,
                    Math.min(100, (enemyTeam.trailingHp / enemyTeam.maxHp) * 100)
                  )}%`,
                }}
              />
              <div
                className="absolute inset-y-0 right-0 bg-rose-500"
                style={{
                  width: `${Math.max(0, Math.min(100, (enemyTeam.hp / enemyTeam.maxHp) * 100))}%`,
                }}
              />
            </div>

            <div className="mt-2 pt-1 border-t border-slate-800/90 flex items-center justify-between text-xs text-slate-400 font-mono-num">
              <span>Üretilen: {enemyTeam.unitsSpawned}</span>
              <span>Kule: {enemyTeam.turrets.filter(Boolean).length}/4</span>
            </div>
          </div>

          {/* Compact Utility Square Icon Buttons (Mute [M], Pause [P], Restart [R]) */}
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              tabIndex={-1}
              aria-label={muted ? 'Sesi Aç [M]' : 'Sesi Kapat [M]'}
              title={muted ? 'Sesi Aç [M]' : 'Sesi Kapat [M]'}
              onClick={(e) => {
                e.currentTarget.blur();
                onToggleMute();
              }}
              className="w-10 h-10 rounded-lg bg-[#0c1018]/94 border border-slate-700 hover:border-amber-400 flex items-center justify-center text-slate-200 cursor-pointer"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
                {muted ? (
                  <path d="M22 9l-6 6M16 9l6 6" stroke="#f87171" strokeWidth="2.5" />
                ) : (
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" />
                )}
              </svg>
            </button>

            <button
              type="button"
              tabIndex={-1}
              aria-label="Oyunu Duraklat [P]"
              title="Oyunu Duraklat [P]"
              onClick={(e) => {
                e.currentTarget.blur();
                onPause();
              }}
              className="w-10 h-10 rounded-lg bg-[#0c1018]/94 border border-slate-700 hover:border-amber-400 flex items-center justify-center text-slate-200 cursor-pointer"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            </button>

            <button
              type="button"
              tabIndex={-1}
              aria-label="Savaşı Yeniden Başlat [R]"
              title="Savaşı Yeniden Başlat [R]"
              onClick={(e) => {
                e.currentTarget.blur();
                onRestart();
              }}
              className="w-10 h-10 rounded-lg bg-[#0c1018]/94 border border-slate-700 hover:border-amber-400 flex items-center justify-center text-slate-200 cursor-pointer"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* CENTER-TOP EVENT BANNER (Non-interactive announcement) */}
      {hud.activeBanner && (
        <div className="mx-auto px-5 py-1.5 rounded-lg bg-[#0c1018]/95 border-2 border-amber-500/80 text-center shadow-lg">
          <span
            className="font-display font-bold text-sm sm:text-base tracking-wider"
            style={{ color: hud.activeBanner.color }}
          >
            {hud.activeBanner.text}
          </span>
        </div>
      )}

      {/* BOTTOM UNIFIED COMMAND DOCK */}
      <div className="w-full flex flex-col gap-2 items-center">
        {/* Optional Drawer for Turret Management, Doctrines, or Online Emotes */}
        {activeDrawer === 'turrets' && (
          <div className="w-full max-w-[920px] pointer-events-auto bg-[#0c1018]/96 border-2 border-amber-600/80 rounded-xl p-3.5 shadow-2xl">
            <div className="flex items-center justify-between gap-4 mb-2.5 pb-2 border-b border-slate-800">
              <div className="text-xs sm:text-sm font-bold text-amber-300">
                KALE SAVUNMA KULELERİ (Yuva Seçin & Kule Kurun / Yükseltin)
              </div>
              <button
                type="button"
                onClick={() => setActiveDrawer('none')}
                className="text-xs text-slate-400 hover:text-white px-2 py-0.5 rounded bg-slate-800 whitespace-nowrap shrink-0"
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
                          Yuva {slotIdx + 1} (Kilitli)
                        </span>
                        {isNextUnlock ? (
                          <span className="text-xs font-mono-num font-bold text-amber-400">
                            Aç: {nextSlotUnlockCost} Altın
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-500">Önceki yuvayı açın</span>
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
                    className={`flex-1 min-w-[150px] p-2 rounded-lg border text-left transition-colors flex items-center gap-2.5 ${
                      myTeam.gold >= tDef.cost
                        ? 'bg-[#151e2e] border-amber-500/70 hover:bg-slate-800 cursor-pointer'
                        : 'bg-slate-900/50 border-slate-800 opacity-50 cursor-not-allowed'
                    }`}
                  >
                    <div className="w-10 h-10 rounded bg-[#090d16] border border-slate-700/80 shrink-0 flex items-center justify-center overflow-hidden">
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
                      <div className="text-[10px] text-slate-400 truncate">{tDef.roleClue}</div>
                      <div className="text-xs font-mono-num font-bold text-amber-400 mt-0.5">
                        {tDef.cost} Altın · Hsr {tDef.damage}
                      </div>
                    </div>
                  </button>
                ))}

                {myTeam.turrets[selectedTurretSlot] && (
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        onCommand({
                          type: 'UPGRADE_TURRET',
                          team: hud.playerTeam,
                          slotIndex: selectedTurretSlot,
                        })
                      }
                      className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs cursor-pointer whitespace-nowrap shrink-0"
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
                      className="px-3 py-2 rounded-lg bg-rose-700 hover:bg-rose-600 text-white font-bold text-xs cursor-pointer whitespace-nowrap shrink-0"
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
          <div className="w-full max-w-[820px] pointer-events-auto bg-[#0c1018]/96 border-2 border-emerald-600/80 rounded-xl p-3.5 shadow-2xl">
            <div className="flex items-center justify-between gap-4 mb-2.5 pb-2 border-b border-slate-800">
              <div className="text-xs sm:text-sm font-bold text-emerald-300">
                KOMUTAN DOKTRİNLERİ & KALICI TEKNOLOJİ AĞACI
              </div>
              <button
                type="button"
                onClick={() => setActiveDrawer('none')}
                className="text-xs text-slate-400 hover:text-white px-2 py-0.5 rounded bg-slate-800 whitespace-nowrap shrink-0"
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
                    desc: 'Öldürülen düşmandan kazanılan Altın/XP ödülünü ve direniş ikmalini +%22 artırır.',
                    level: myTeam.doctrines.economyLevel,
                  },
                  {
                    key: 'warfare',
                    title: 'Çelik & Taktik Doktrini',
                    desc: 'Tüm birim/kule hasarını +%12 artırır ve Özel Güç süresini -%6 kısaltır.',
                    level: myTeam.doctrines.warfareLevel,
                  },
                  {
                    key: 'fortress',
                    title: 'Sur Tahkimatı & Savunma',
                    desc: 'Birim canını +%10, kule menzil/hızını artırır, kale hasarını azaltır ve onarır.',
                    level: myTeam.doctrines.fortressLevel,
                  },
                ] as const
              ).map((doc) => {
                const cost = getDoctrineCost(doc.key, doc.level);
                const maxed = doc.level >= 5;
                const canAfford = !maxed && myTeam.gold >= cost;

                return (
                  <button
                    key={doc.key}
                    type="button"
                    disabled={!canAfford}
                    onClick={() =>
                      onCommand({
                        type: 'UPGRADE_DOCTRINE',
                        team: hud.playerTeam,
                        doctrineKey: doc.key,
                      })
                    }
                    className={`p-3 rounded-lg border text-left transition-colors ${
                      canAfford
                        ? 'bg-[#131d2b] border-emerald-500/70 hover:bg-slate-800 cursor-pointer'
                        : 'bg-slate-900/60 border-slate-800 opacity-60 cursor-not-allowed'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-white">{doc.title}</span>
                      <span className="text-xs font-mono-num text-emerald-400">
                        Sv.{doc.level}/5
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 mb-2">{doc.desc}</div>
                    <div className="text-xs font-mono-num font-bold text-amber-300">
                      {maxed ? 'MAKSİMUM SEVİYE' : `${cost} Altın`}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {activeDrawer === 'emotes' && (
          <div className="pointer-events-auto bg-[#0c1018]/96 border border-sky-500/80 rounded-xl px-4 py-2.5 flex items-center gap-2 shadow-xl">
            <span className="text-xs font-semibold text-sky-300">Hızlı Savaş Sinyali:</span>
            {['Taarruza Geçiyorum!', 'Kaleyi Savun!', 'Çağ Atlıyorum!', 'İyi Savaştı!'].map(
              (msg) => (
                <button
                  key={msg}
                  type="button"
                  onClick={() => {
                    onCommand({ type: 'EMOTE', team: hud.playerTeam, emoteText: msg });
                    setActiveDrawer('none');
                  }}
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-sky-500 hover:text-slate-950 text-xs text-slate-200 font-medium cursor-pointer whitespace-nowrap shrink-0"
                >
                  {msg}
                </button>
              )
            )}
          </div>
        )}

        {/* Production Queue Strip (if units are training) */}
        {myTeam.queue.length > 0 && (
          <div className="pointer-events-auto flex items-center gap-2 bg-[#0c1018]/94 border border-slate-700 rounded-lg px-3 py-1.5 shadow-md">
            <span className="text-[11px] font-semibold text-slate-300">
              Üretim Kuyruğu ({myTeam.queue.length}/5):
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
                    className="px-2 py-0.5 rounded bg-slate-800 hover:bg-rose-950 border border-slate-600 text-[11px] text-amber-200 font-mono-num cursor-pointer whitespace-nowrap shrink-0"
                  >
                    {uDef?.name.split(' ')[0]} {idx === 0 ? `${pct}%` : ''} ✕
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Primary Unified Bottom Dock */}
        <div className="w-full max-w-[1180px] pointer-events-auto bg-[#0c1018]/95 border-2 border-slate-700/90 rounded-xl p-2.5 shadow-[0_12px_36px_rgba(0,0,0,0.95)] flex flex-wrap lg:flex-nowrap items-stretch justify-between gap-2">
          {/* 4 Unit Spawn Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 flex-1">
            {myUnits.map((u, idx) => {
              const canAfford = myTeam.gold >= u.cost && myTeam.queue.length < 5;
              return (
                <button
                  key={u.id}
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onCommand({
                      type: 'SPAWN_UNIT',
                      team: hud.playerTeam,
                      defId: u.id,
                    });
                  }}
                  className={`p-1.5 rounded-lg border text-left transition-all flex flex-col justify-between cursor-pointer group ${
                    canAfford
                      ? 'bg-[#141c2b] border-slate-600 hover:border-amber-400 active:scale-[0.98]'
                      : 'bg-[#0e131d] border-slate-800/80 opacity-55'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-10 h-10 rounded bg-[#090d16] border border-slate-700/80 flex items-center justify-center shrink-0 overflow-hidden relative">
                      <img
                        src={`/assets/ui/portraits/${u.id}.png`}
                        alt={u.name}
                        className="w-full h-full object-contain"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                      <div className="absolute inset-0 flex items-center justify-center -z-10">
                        <ArchetypeSvgIcon archetype={u.archetype} accent={u.accentColor} />
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-bold text-white truncate">{u.name}</span>
                        <span className="text-[10px] font-mono-num font-bold text-slate-400 shrink-0">
                          [{idx + 1}]
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400 truncate">{u.roleClue}</div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs font-mono-num pt-1 border-t border-slate-800/80 mt-1">
                    <span className="font-bold text-amber-300">{u.cost} Altın</span>
                    <span className="text-[10px] text-slate-400">
                      Hsr {u.damage} · Can {u.hp}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Right Action Cluster: Turrets [T], Doctrines [G], Evolve Era [Q], Special Power [Space] */}
          <div className="flex items-stretch gap-2 shrink-0">
            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                setActiveDrawer(activeDrawer === 'turrets' ? 'none' : 'turrets');
              }}
              className={`px-3 py-2 rounded-lg border text-left flex flex-col justify-between cursor-pointer whitespace-nowrap shrink-0 ${
                activeDrawer === 'turrets'
                  ? 'bg-amber-600 text-slate-950 border-amber-300 font-bold'
                  : 'bg-[#141c2b] text-amber-200 border-amber-700/70 hover:border-amber-400'
              }`}
            >
              <div className="flex items-center justify-between gap-2 text-xs font-bold">
                <span>Kuleler</span>
                <span className="font-mono-num text-[11px] opacity-80">[T]</span>
              </div>
              <div className="text-[11px] opacity-85 font-mono-num">
                Kurulu: {myTeam.turrets.filter(Boolean).length}/{myTeam.unlockedTurretSlots}
              </div>
            </button>

            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                setActiveDrawer(activeDrawer === 'doctrines' ? 'none' : 'doctrines');
              }}
              className={`px-3 py-2 rounded-lg border text-left flex flex-col justify-between cursor-pointer whitespace-nowrap shrink-0 ${
                activeDrawer === 'doctrines'
                  ? 'bg-emerald-500 text-slate-950 border-emerald-200 font-bold'
                  : 'bg-[#141c2b] text-emerald-300 border-emerald-700/70 hover:border-emerald-400'
              }`}
            >
              <div className="flex items-center justify-between gap-2 text-xs font-bold">
                <span>Doktrin</span>
                <span className="font-mono-num text-[11px] opacity-80">[G]</span>
              </div>
              <div className="text-[11px] opacity-85 font-mono-num">
                Teknoloji ({myTeam.doctrines.economyLevel + myTeam.doctrines.warfareLevel + myTeam.doctrines.fortressLevel})
              </div>
            </button>

            <button
              type="button"
              tabIndex={-1}
              disabled={!canEvolve}
              onClick={(e) => {
                e.currentTarget.blur();
                onCommand({ type: 'EVOLVE_ERA', team: hud.playerTeam });
              }}
              className={`px-3.5 py-2 rounded-lg border text-left flex flex-col justify-between transition-colors whitespace-nowrap shrink-0 ${
                canEvolve
                  ? 'bg-purple-600 hover:bg-purple-500 text-white border-purple-300 shadow-[0_0_16px_rgba(168,85,247,0.5)] cursor-pointer'
                  : 'bg-[#101520] text-slate-400 border-slate-800 opacity-65 cursor-not-allowed'
              }`}
            >
              <div className="flex items-center justify-between gap-2 text-xs font-bold">
                <span>Çağ Atla</span>
                <span className="font-mono-num text-[11px]">[Q]</span>
              </div>
              <div className="text-[11px] font-mono-num font-semibold">
                {myTeam.era >= ERAS.length - 1
                  ? 'SON ÇAĞ'
                  : `${Math.round(myTeam.xp)} / ${myEra.evolveXpCost} XP`}
              </div>
            </button>

            <button
              type="button"
              tabIndex={-1}
              disabled={myTeam.specialCooldown > 0}
              onClick={(e) => {
                e.currentTarget.blur();
                onCommand({ type: 'CAST_SPECIAL', team: hud.playerTeam });
              }}
              className={`px-3 py-1.5 rounded-lg border text-left flex items-center gap-2.5 transition-colors whitespace-nowrap shrink-0 ${
                myTeam.specialCooldown <= 0
                  ? 'bg-rose-600 hover:bg-rose-500 text-white border-amber-300 shadow-[0_0_18px_rgba(225,29,72,0.5)] cursor-pointer'
                  : 'bg-[#101520] text-slate-400 border-slate-800 opacity-75 cursor-not-allowed'
              }`}
            >
              <div className="w-8 h-8 rounded bg-black/40 border border-white/20 flex items-center justify-center shrink-0 overflow-hidden">
                <img
                  src={`/assets/ui/powers/${POWER_ICONS[myTeam.era] || 'power_meteor'}.png`}
                  alt="Özel Güç"
                  className="w-full h-full object-contain"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              </div>
              <div className="flex flex-col justify-between">
                <div className="flex items-center justify-between gap-2 text-xs font-bold">
                  <span>{myEra.specialName}</span>
                  <span className="font-mono-num text-[10px] opacity-80">[Space]</span>
                </div>
                <div className="text-[11px] font-mono-num font-semibold">
                  {myTeam.specialCooldown > 0
                    ? `Dolum: ${myTeam.specialCooldown.toFixed(1)}s`
                    : 'HAZIR · ATEŞLE'}
                </div>
              </div>
            </button>

            <button
              type="button"
              tabIndex={-1}
              aria-label="Savaş Sinyali Gönder"
              onClick={(e) => {
                e.currentTarget.blur();
                setActiveDrawer(activeDrawer === 'emotes' ? 'none' : 'emotes');
              }}
              className="px-2.5 py-2 rounded-lg bg-[#141c2b] border border-sky-800 hover:border-sky-400 text-sky-300 text-xs font-bold cursor-pointer whitespace-nowrap shrink-0"
            >
              Sinyal
            </button>
          </div>
        </div>

        {/* If in 2-Player Local Mode, compact secondary command strip for Player 2 */}
        {mode === 'local2p' && (
          <div className="w-full max-w-[1180px] pointer-events-auto bg-[#160f18]/95 border border-rose-700/80 rounded-lg px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-bold text-rose-300">
              2. Komutan ({Math.round(hud.team2.gold)} Altın · {Math.round(hud.team2.xp)} XP):
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {p2Units.map((u, idx) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => onCommand({ type: 'SPAWN_UNIT', team: 2, defId: u.id })}
                  className="px-2.5 py-1 rounded bg-rose-950/80 hover:bg-rose-800 border border-rose-600/60 text-rose-100 font-mono-num cursor-pointer whitespace-nowrap shrink-0"
                >
                  [{(idx + 7) % 10}] {u.name.split(' ')[0]} ({u.cost}A)
                </button>
              ))}
              <button
                type="button"
                onClick={() => onCommand({ type: 'EVOLVE_ERA', team: 2 })}
                className="px-2.5 py-1 rounded bg-purple-900 hover:bg-purple-700 text-white font-bold cursor-pointer whitespace-nowrap shrink-0"
              >
                [U] Çağ Atla
              </button>
              <button
                type="button"
                onClick={() => onCommand({ type: 'CAST_SPECIAL', team: 2 })}
                className="px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold cursor-pointer whitespace-nowrap shrink-0"
              >
                [Enter] Özel Güç
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
