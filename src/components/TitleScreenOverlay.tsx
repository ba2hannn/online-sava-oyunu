import React, { useState } from 'react';
import { AIDifficulty, GameMode } from '../game/types';
import { TitleEmblemSvg } from './GameIcons';

interface OpenRoomInfo {
  code: string;
  hostName: string;
  playerCount: number;
  status: string;
}

interface TitleScreenOverlayProps {
  mode: GameMode;
  difficulty: AIDifficulty;
  playerName: string;
  onPlayerNameChange: (name: string) => void;
  onSelectMode: (mode: GameMode) => void;
  onSelectDifficulty: (diff: AIDifficulty) => void;
  onStartGame: () => void;
  // Online Lobby props
  wsConnected: boolean;
  networkLabel?: string;
  roomCode: string | null;
  roomStatus: 'idle' | 'waiting' | 'playing';
  openRooms: OpenRoomInfo[];
  onlineError: string | null;
  onCreateOnlineRoom: () => void;
  onJoinOnlineRoom: (code: string) => void;
  onQuickMatchOnline: () => void;
  onRefreshRooms: () => void;
}

export const TitleScreenOverlay: React.FC<TitleScreenOverlayProps> = ({
  mode,
  difficulty,
  playerName,
  onPlayerNameChange,
  onSelectMode,
  onSelectDifficulty,
  onStartGame,
  wsConnected,
  networkLabel,
  roomCode,
  roomStatus,
  openRooms,
  onlineError,
  onCreateOnlineRoom,
  onJoinOnlineRoom,
  onQuickMatchOnline,
  onRefreshRooms,
}) => {
  const [joinInputCode, setJoinInputCode] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);

  const shareUrl =
    typeof window !== 'undefined' && roomCode
      ? `${window.location.origin}${window.location.pathname}?room=${roomCode}`
      : '';

  return (
    <div className="fixed inset-0 z-20 flex flex-col justify-between p-6 md:p-10 pointer-events-none">
      {/* Upper Calm Negative Space: Custom SVG Title Lockup */}
      <div className="w-full flex flex-col items-center pt-2">
        <TitleEmblemSvg />
      </div>

      {/* Center-Bottom Command Panel */}
      <div className="w-full max-w-[680px] mx-auto pointer-events-auto bg-[#0c1018]/95 border-2 border-[#b45309] rounded-xl p-6 shadow-[0_20px_50px_rgba(0,0,0,0.92)]">
        {/* Game Mode Segmented Control */}
        <div className="mb-5">
          <div className="text-xs font-semibold text-amber-300/90 mb-2 tracking-wider">
            SAVAŞ MODU SEÇİMİ
          </div>
          <div className="grid grid-cols-3 gap-2 p-1 bg-[#141b29] rounded-lg border border-slate-800">
            <button
              type="button"
              onClick={() => onSelectMode('ai')}
              className={`py-2.5 px-3 rounded-md text-xs md:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 ${
                mode === 'ai'
                  ? 'bg-amber-600 text-slate-950 shadow-sm'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              Sefer & Hızlı Savaş (YZ)
            </button>
            <button
              type="button"
              onClick={() => {
                onSelectMode('online');
                onRefreshRooms();
              }}
              className={`py-2.5 px-3 rounded-md text-xs md:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 ${
                mode === 'online'
                  ? 'bg-sky-500 text-slate-950 shadow-sm'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              Online Çok Oyunculu
            </button>
            <button
              type="button"
              onClick={() => onSelectMode('local2p')}
              className={`py-2.5 px-3 rounded-md text-xs md:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 ${
                mode === 'local2p'
                  ? 'bg-emerald-500 text-slate-950 shadow-sm'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              2 Kişilik Düello (Aynı PC)
            </button>
          </div>
        </div>

        {/* Mode-Specific Configuration */}
        {mode === 'ai' && (
          <div className="mb-6">
            <div className="text-xs font-semibold text-slate-300 mb-2 tracking-wider">
              KOMUTAN ZORLUK SEVİYESİ
            </div>
            <div className="grid grid-cols-3 gap-2 p-1 bg-[#141b29] rounded-lg border border-slate-800">
              {(
                [
                  { id: 'normal', label: 'Normal · Dengeli' },
                  { id: 'hard', label: 'Zorlu · Taktiksel' },
                  { id: 'legendary', label: 'Efsanevi · Acımasız' },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectDifficulty(item.id)}
                  className={`py-2 px-3 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    difficulty === item.id
                      ? 'bg-slate-200 text-slate-950'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {mode === 'local2p' && (
          <div className="mb-6 p-3.5 rounded-lg bg-[#141b29] border border-slate-800 text-xs text-slate-300 leading-relaxed">
            <span className="font-semibold text-emerald-400">Aynı Ekranda 2 Komutan:</span> Sol Kale
            (1. Oyuncu) <span className="font-mono-num text-amber-300">1-4, Q, Space</span>{' '}
            tuşlarını veya alt sol paneli; Sağ Kale (2. Oyuncu){' '}
            <span className="font-mono-num text-sky-300">7-0, U, Enter</span> tuşlarını veya alt
            sağ paneli kullanır.
          </div>
        )}

        {mode === 'online' && (
          <div className="mb-6 p-4 rounded-lg bg-[#131b2b] border border-sky-900/80 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <span>Komutan Adı:</span>
                <input
                  type="text"
                  value={playerName}
                  onChange={(e) => onPlayerNameChange(e.target.value)}
                  placeholder="Komutan Adınız"
                  aria-label="Komutan Adı"
                  className="bg-[#090d16] border border-slate-700 rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-sky-400 w-40"
                />
              </label>
              <span className="text-xs font-mono-num text-sky-300">
                {networkLabel || (wsConnected ? 'WebRTC P2P Aktif' : 'Ağ Hazırlanıyor...')}
              </span>
            </div>

            {roomStatus === 'waiting' && roomCode ? (
              <div className="p-3.5 rounded bg-[#090d16] border border-amber-500/70 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs text-slate-400">
                      Oda Kuruldu · Arkadaşınız Linke Girince Savaş Otomatik Başlar
                    </div>
                    <div className="text-lg font-mono-num font-bold text-amber-400 tracking-widest">
                      ODA KODU: {roomCode}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (shareUrl) {
                          navigator.clipboard?.writeText(shareUrl).catch(() => {});
                          setCopiedLink(true);
                          setTimeout(() => setCopiedLink(false), 2200);
                        }
                      }}
                      className="px-3 py-2 rounded bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {copiedLink ? 'Link Kopyalandı ✓' : 'Davet Linkini Kopyala'}
                    </button>
                    <button
                      type="button"
                      onClick={onStartGame}
                      className="px-3 py-2 rounded bg-amber-600 hover:bg-amber-500 text-slate-950 font-semibold text-xs whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Bot İle Başla
                    </button>
                  </div>
                </div>

                {shareUrl && (
                  <div className="flex items-center gap-2 bg-[#111827] border border-slate-800 rounded px-2.5 py-1.5">
                    <span className="text-[11px] text-slate-400 shrink-0">Davet Linki:</span>
                    <input
                      type="text"
                      readOnly
                      value={shareUrl}
                      aria-label="Paylaşılabilir Oda Davet Linki"
                      onClick={(e) => e.currentTarget.select()}
                      className="w-full bg-transparent text-xs font-mono-num text-sky-300 focus:outline-none select-all"
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={onQuickMatchOnline}
                    className="flex-1 py-2 px-3 rounded bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs whitespace-nowrap shrink-0"
                  >
                    Hızlı Online Eşleş
                  </button>
                  <button
                    type="button"
                    onClick={onCreateOnlineRoom}
                    className="py-2 px-3 rounded bg-slate-800 hover:bg-slate-700 text-sky-300 border border-sky-700/60 font-semibold text-xs whitespace-nowrap shrink-0"
                  >
                    Özel Oda Kur
                  </button>
                </div>

                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={joinInputCode}
                    onChange={(e) => setJoinInputCode(e.target.value.toUpperCase())}
                    placeholder="ODA KODU (Örn: K9X2M)"
                    aria-label="Oda Kodu"
                    maxLength={6}
                    className="flex-1 bg-[#090d16] border border-slate-700 rounded px-2.5 py-1.5 text-xs font-mono-num text-white uppercase focus:outline-none focus:border-sky-400"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (joinInputCode.trim()) onJoinOnlineRoom(joinInputCode.trim());
                    }}
                    className="px-3 py-1.5 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs whitespace-nowrap shrink-0"
                  >
                    Katıl
                  </button>
                </div>
              </div>
            )}

            {onlineError && <div className="text-xs text-rose-400 font-medium">{onlineError}</div>}

            {openRooms.length > 0 && roomStatus !== 'waiting' && (
              <div className="pt-1">
                <div className="text-[11px] text-slate-400 mb-1">Açık Online Odalar:</div>
                <div className="flex flex-wrap gap-1.5">
                  {openRooms.map((r) => (
                    <button
                      key={r.code}
                      type="button"
                      onClick={() => onJoinOnlineRoom(r.code)}
                      className="px-2.5 py-1 rounded bg-[#090d16] hover:bg-slate-800 border border-slate-700 text-xs text-sky-300 font-mono-num whitespace-nowrap shrink-0"
                    >
                      #{r.code} · {r.hostName} (Katıl)
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Primary Action CTA */}
        <button
          type="button"
          data-start="true"
          onClick={onStartGame}
          className="w-full py-3.5 px-6 rounded-lg bg-amber-500 hover:bg-amber-400 active:translate-y-0.5 text-slate-950 font-display font-extrabold text-lg tracking-wider shadow-[0_6px_20px_rgba(245,158,11,0.35)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          SAVAŞI BAŞLAT (ENTER / SPACE)
        </button>
      </div>

      {/* Bottom Safe Margin: Single Flat Control-Hint Line */}
      <div className="w-full text-center text-xs md:text-sm text-slate-300/90 font-medium tracking-wide drop-shadow-[0_2px_4px_rgba(0,0,0,0.95)]">
        A / D veya Ok Tuşları Kamera · 1-4 Birim Üret · T Kule Yönetimi · G Doktrinler · Q Çağ Atla
        · Space Özel Güç · Esc Duraklat
      </div>
    </div>
  );
};
