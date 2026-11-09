import React, { useState, useEffect } from 'react';
import { AIDifficulty, GameMode } from '../game/types';
import { TitleEmblemSvg } from './GameIcons';

export interface OpenRoomInfo {
  code: string;
  hostName: string;
  title: string;
  playerCount: number;
  status: string;
  createdAt: number;
}

export interface LeaderboardEntry {
  name: string;
  wins: number;
  losses: number;
  totalMatches: number;
  winRate: number;
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
  onCreateOnlineRoom: (title?: string, isPrivate?: boolean, customCode?: string) => void;
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
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [customRoomTitle, setCustomRoomTitle] = useState('');
  const [customRoomCode, setCustomRoomCode] = useState('');
  const [isPrivateRoom, setIsPrivateRoom] = useState(false);
  const [leaderboardData, setLeaderboardData] = useState<LeaderboardEntry[]>([]);
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(false);

  const shareUrl =
    typeof window !== 'undefined' && roomCode
      ? `${window.location.origin}${window.location.pathname}?room=${roomCode}`
      : '';

  const fetchLeaderboard = async () => {
    setLoadingLeaderboard(true);
    try {
      const res = await fetch('/api/leaderboard');
      if (res.ok) {
        const data = await res.json();
        setLeaderboardData(data.leaderboard || []);
      }
    } catch {
      // Fallback
    } finally {
      setLoadingLeaderboard(false);
    }
  };

  useEffect(() => {
    if (showLeaderboard) {
      fetchLeaderboard();
    }
  }, [showLeaderboard]);

  return (
    <div className="fixed inset-0 z-20 flex flex-col justify-between p-4 md:p-8 pointer-events-none overflow-y-auto">
      {/* Upper Calm Negative Space: Custom SVG Title Lockup */}
      <div className="w-full flex flex-col items-center pt-1 shrink-0">
        <img
          src="/assets/ui/modals/title_logo.png"
          alt="Çağlar Boyu Savaş"
          className="max-h-24 md:max-h-32 object-contain drop-shadow-[0_10px_25px_rgba(0,0,0,0.9)] mb-1 pointer-events-auto"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
        <TitleEmblemSvg />
      </div>

      {/* Center-Bottom Command Panel */}
      <div className="w-full max-w-[720px] mx-auto pointer-events-auto bg-[#0c1018]/95 border-2 border-[#b45309] rounded-xl p-5 md:p-6 shadow-[0_20px_50px_rgba(0,0,0,0.92)] my-auto">
        {/* Game Mode Segmented Control */}
        <div className="mb-4">
          <div className="text-xs font-semibold text-amber-300/90 mb-2 tracking-wider flex items-center justify-between">
            <span>SAVAŞ MODU SEÇİMİ</span>
            {mode === 'online' && (
              <button
                type="button"
                onClick={() => setShowLeaderboard(true)}
                className="text-xs text-amber-400 hover:text-amber-300 underline font-normal cursor-pointer"
              >
                🏆 Liderlik Tablosu
              </button>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 p-1 bg-[#141b29] rounded-lg border border-slate-800">
            <button
              type="button"
              onClick={() => onSelectMode('ai')}
              className={`py-2 px-3 rounded-md text-xs md:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
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
              className={`py-2 px-3 rounded-md text-xs md:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
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
              className={`py-2 px-3 rounded-md text-xs md:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
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
          <div className="mb-5">
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
                  className={`py-2 px-3 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    difficulty === item.id
                      ? 'bg-amber-600 text-slate-950 shadow-sm'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {mode === 'local2p' && (
          <div className="mb-5 p-3 rounded-lg bg-[#141b29] border border-slate-800 text-xs text-slate-300 leading-relaxed">
            <span className="font-semibold text-emerald-400">Aynı Ekranda 2 Komutan:</span> Sol Kale
            (1. Oyuncu) <span className="font-mono-num text-amber-300">1-4, Q, Space</span>{' '}
            tuşlarını veya alt sol paneli; Sağ Kale (2. Oyuncu){' '}
            <span className="font-mono-num text-sky-300">7-0, U, Enter</span> tuşlarını veya alt
            sağ paneli kullanır.
          </div>
        )}

        {mode === 'online' && (
          <div className="mb-5 p-4 rounded-lg bg-[#131b2b] border border-sky-900/80 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-900/50 pb-2.5">
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <span className="font-semibold text-amber-400">Komutan Adı:</span>
                <input
                  type="text"
                  value={playerName}
                  onChange={(e) => onPlayerNameChange(e.target.value)}
                  placeholder="Komutan Adınız"
                  aria-label="Komutan Adı"
                  maxLength={20}
                  className="bg-[#090d16] border border-slate-700 rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-sky-400 w-36 md:w-44"
                />
              </label>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono-num text-sky-300">
                  {networkLabel || (wsConnected ? '🟢 Çevrimiçi' : 'Ağ Hazırlanıyor...')}
                </span>
                <button
                  type="button"
                  onClick={onRefreshRooms}
                  title="Odaları Yenile"
                  className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 text-xs cursor-pointer"
                >
                  ↻ Yenile
                </button>
              </div>
            </div>

            {roomStatus === 'waiting' && roomCode ? (
              <div className="p-3.5 rounded bg-[#090d16] border border-amber-500/70 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs text-slate-400">
                      Oda Kuruldu · Rakip katıldığında savaş otomatik senkron başlar
                    </div>
                    <div className="text-xl font-mono-num font-bold text-amber-400 tracking-widest mt-0.5">
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
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={onQuickMatchOnline}
                      className="flex-1 py-2 px-3 rounded bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                    >
                      ⚔️ Hızlı Eşleş
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowCreateModal(true)}
                      className="py-2 px-3 rounded bg-slate-800 hover:bg-slate-700 text-sky-300 border border-sky-700/60 font-semibold text-xs whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      + Oda Kur
                    </button>
                  </div>

                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={joinInputCode}
                      onChange={(e) => setJoinInputCode(e.target.value.toUpperCase())}
                      placeholder="ODA KODU (Örn: K9X2M)"
                      aria-label="Oda Kodu"
                      maxLength={8}
                      className="flex-1 bg-[#090d16] border border-slate-700 rounded px-2.5 py-1.5 text-xs font-mono-num text-white uppercase focus:outline-none focus:border-sky-400"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (joinInputCode.trim()) onJoinOnlineRoom(joinInputCode.trim());
                      }}
                      className="px-3.5 py-1.5 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Katıl
                    </button>
                  </div>
                </div>

                {/* Open Room Browser / Lobby List */}
                <div className="bg-[#090d16] border border-slate-800 rounded-lg p-2.5 max-h-48 overflow-y-auto">
                  <div className="flex items-center justify-between text-[11px] text-slate-400 font-semibold mb-1.5 px-1">
                    <span>AÇIK ODALAR ({openRooms.length})</span>
                    <span>DURUM</span>
                  </div>

                  {openRooms.length === 0 ? (
                    <div className="text-center py-4 text-xs text-slate-500">
                      Şu an açık oda bulunmuyor. Yeni bir oda kurabilir veya Hızlı Eşleşebilirsiniz!
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {openRooms.map((r) => (
                        <div
                          key={r.code}
                          className="flex items-center justify-between p-2 rounded bg-[#111827]/80 hover:bg-[#1a2333] border border-slate-800 transition-colors"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-xs font-mono-num font-bold text-amber-400">
                              #{r.code}
                            </span>
                            <span className="text-xs text-slate-200 truncate">
                              {r.title || `${r.hostName}'in Odası`}
                            </span>
                            <span className="text-[10px] text-slate-400 shrink-0">
                              ({r.hostName})
                            </span>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                r.status === 'waiting'
                                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                                  : 'bg-amber-950 text-amber-400 border border-amber-800'
                              }`}
                            >
                              {r.status === 'waiting' ? 'Bekliyor (1/2)' : 'Savaşta (2/2)'}
                            </span>
                            {r.status === 'waiting' && (
                              <button
                                type="button"
                                onClick={() => onJoinOnlineRoom(r.code)}
                                className="px-2.5 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs cursor-pointer"
                              >
                                Katıl
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {onlineError && <div className="text-xs text-rose-400 font-medium">{onlineError}</div>}
          </div>
        )}

        {/* Primary Action CTA */}
        <button
          type="button"
          data-start="true"
          onClick={onStartGame}
          className="w-full py-3.5 px-6 rounded-lg bg-amber-500 hover:bg-amber-400 active:translate-y-0.5 text-slate-950 font-display font-extrabold text-lg tracking-wider shadow-[0_6px_20px_rgba(245,158,11,0.35)] transition-all flex items-center justify-center gap-3 cursor-pointer group"
        >
          <img
            src="/assets/ui/modals/cta_start.png"
            alt="Başlat"
            className="h-7 max-w-[140px] object-contain group-hover:scale-105 transition-transform"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
          <span>SAVAŞI BAŞLAT (ENTER / SPACE)</span>
        </button>
      </div>

      {/* Custom Room Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 pointer-events-auto">
          <div className="bg-[#0f172a] border border-amber-500/80 rounded-xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-700 pb-2">
              <h3 className="text-base font-bold text-amber-400">Yeni Savaş Odası Oluştur</h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-white text-lg font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-300 block mb-1">Oda Başlığı:</label>
                <input
                  type="text"
                  value={customRoomTitle}
                  onChange={(e) => setCustomRoomTitle(e.target.value)}
                  placeholder={`${playerName}'in Arenası`}
                  maxLength={30}
                  className="w-full bg-[#090d16] border border-slate-700 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-400"
                />
              </div>

              <div>
                <label className="text-xs text-slate-300 block mb-1">
                  Özel Oda Kodu (Opsiyonel):
                </label>
                <input
                  type="text"
                  value={customRoomCode}
                  onChange={(e) => setCustomRoomCode(e.target.value.toUpperCase())}
                  placeholder="Boş bırakılırsa otomatik üretilir"
                  maxLength={8}
                  className="w-full bg-[#090d16] border border-slate-700 rounded px-3 py-2 text-xs font-mono-num text-white uppercase focus:outline-none focus:border-amber-400"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="privateCheck"
                  checked={isPrivateRoom}
                  onChange={(e) => setIsPrivateRoom(e.target.checked)}
                  className="rounded bg-slate-800 border-slate-700 text-amber-500 focus:ring-0"
                />
                <label htmlFor="privateCheck" className="text-xs text-slate-300 cursor-pointer">
                  Gizli Oda (Açık lobi listesinde gözükmesin, sadece kod ile girilsin)
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
              >
                İptal
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCreateModal(false);
                  onCreateOnlineRoom(
                    customRoomTitle.trim() || undefined,
                    isPrivateRoom,
                    customRoomCode.trim() || undefined
                  );
                }}
                className="px-5 py-2 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs cursor-pointer"
              >
                Odayı Aç
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Leaderboard Modal */}
      {showLeaderboard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 pointer-events-auto">
          <div className="bg-[#0f172a] border border-sky-500/80 rounded-xl p-6 max-w-lg w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-700 pb-2">
              <h3 className="text-base font-bold text-sky-400">🏆 Komutan Liderlik Tablosu</h3>
              <button
                type="button"
                onClick={() => setShowLeaderboard(false)}
                className="text-slate-400 hover:text-white text-lg font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            {loadingLeaderboard ? (
              <div className="text-center py-8 text-xs text-slate-400">Yükleniyor...</div>
            ) : leaderboardData.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-400">
                Henüz kayıtlı online zafer bulunmuyor. İlk zaferi sen kazan!
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto space-y-1.5">
                <div className="grid grid-cols-12 text-[11px] font-semibold text-slate-400 px-2 pb-1">
                  <span className="col-span-1">#</span>
                  <span className="col-span-5">Komutan</span>
                  <span className="col-span-2 text-right">Galibiyet</span>
                  <span className="col-span-2 text-right">Maç</span>
                  <span className="col-span-2 text-right">Kazanma %</span>
                </div>
                {leaderboardData.map((item, idx) => (
                  <div
                    key={item.name}
                    className={`grid grid-cols-12 items-center p-2 rounded text-xs ${
                      idx === 0
                        ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300 font-bold'
                        : idx === 1
                        ? 'bg-slate-700/30 border border-slate-600/40 text-slate-200'
                        : idx === 2
                        ? 'bg-amber-900/20 border border-amber-800/40 text-amber-200'
                        : 'bg-slate-900/60 border border-slate-800 text-slate-300'
                    }`}
                  >
                    <span className="col-span-1 font-mono-num">{idx + 1}</span>
                    <span className="col-span-5 truncate">{item.name}</span>
                    <span className="col-span-2 text-right font-mono-num text-emerald-400 font-semibold">
                      {item.wins}
                    </span>
                    <span className="col-span-2 text-right font-mono-num text-slate-400">
                      {item.totalMatches}
                    </span>
                    <span className="col-span-2 text-right font-mono-num text-sky-300 font-semibold">
                      %{item.winRate}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowLeaderboard(false)}
                className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Safe Margin: Single Flat Control-Hint Line */}
      <div className="w-full text-center text-xs md:text-sm text-slate-300/90 font-medium tracking-wide drop-shadow-[0_2px_4px_rgba(0,0,0,0.95)] shrink-0 pt-2">
        A / D veya Ok Tuşları Kamera · 1-4 Birim Üret · T Kule Yönetimi · G Doktrinler · Q Çağ Atla
        · Space Özel Güç · Esc Duraklat
      </div>
    </div>
  );
};
