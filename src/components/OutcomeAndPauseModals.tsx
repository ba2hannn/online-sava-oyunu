import React from 'react';
import { ERAS } from '../game/catalog';
import { GameLifecycleState, RunSummarySnapshot } from '../game/types';

interface OutcomeAndPauseModalsProps {
  lifecycle: GameLifecycleState;
  summary: RunSummarySnapshot | null;
  onResume: () => void;
  onRestart: () => void;
  onReturnTitle: () => void;
}

export const OutcomeAndPauseModals: React.FC<OutcomeAndPauseModalsProps> = ({
  lifecycle,
  summary,
  onResume,
  onRestart,
  onReturnTitle,
}) => {
  if (lifecycle !== 'paused' && lifecycle !== 'gameover') {
    return null;
  }

  if (lifecycle === 'paused') {
    return (
      <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/75 p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="pause-modal-title"
          className="w-full max-w-[440px] bg-[#0c1018] border-2 border-amber-600 rounded-xl p-6 shadow-[0_24px_60px_rgba(0,0,0,0.95)] text-center"
        >
          <h2
            id="pause-modal-title"
            className="font-display font-extrabold text-2xl text-amber-400 tracking-wider mb-2"
          >
            SAVAŞ DURAKLATILDI
          </h2>
          <p className="text-xs text-slate-400 mb-6">
            Cephe hattı komutlarınızı bekliyor. Devam etmek için ESC veya P tuşuna basabilirsiniz.
          </p>

          <div className="flex flex-col gap-2.5">
            <button
              type="button"
              onClick={onResume}
              className="w-full py-3 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm tracking-wide cursor-pointer whitespace-nowrap shrink-0"
            >
              Savaşa Devam Et (ESC / P)
            </button>
            <button
              type="button"
              onClick={onRestart}
              className="w-full py-2.5 px-4 rounded-lg bg-[#161f30] hover:bg-slate-800 border border-slate-700 text-slate-200 font-semibold text-sm cursor-pointer whitespace-nowrap shrink-0"
            >
              Yeniden Başlat (R)
            </button>
            <button
              type="button"
              onClick={onReturnTitle}
              className="w-full py-2.5 px-4 rounded-lg bg-[#111622] hover:bg-rose-950/60 border border-slate-800 text-slate-400 hover:text-rose-200 font-semibold text-sm cursor-pointer whitespace-nowrap shrink-0"
            >
              Ana Ekrana Dön
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isVictory = summary ? summary.winner === summary.playerTeam : true;
  const reachedEra = ERAS[summary?.playerEra ?? 0];

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/80 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="outcome-modal-title"
        className={`w-full max-w-[520px] bg-[#0c1018] border-2 ${
          isVictory ? 'border-amber-500' : 'border-rose-600'
        } rounded-xl p-6 shadow-[0_24px_60px_rgba(0,0,0,0.95)] text-center`}
      >
        <h2
          id="outcome-modal-title"
          className={`font-display font-extrabold text-3xl tracking-wider mb-1 ${
            isVictory ? 'text-amber-400' : 'text-rose-400'
          }`}
        >
          {isVictory ? 'MUTLAK ZAFER!' : 'KALE DÜŞTÜ'}
        </h2>
        <p className="text-xs sm:text-sm text-slate-300 mb-5">
          {isVictory
            ? 'Düşman kalesi yerle bir edildi ve sancağınız çağlar boyunca dalgalandı!'
            : 'Düşman ordusu surlarınızı aştı. Yeni bir stratejiyle tekrar hücuma geçin!'}
        </p>

        {/* 3 Tabular-Nums Stat Tiles */}
        {summary && (
          <div className="grid grid-cols-3 gap-2.5 mb-6 text-left">
            <div className="p-3 rounded-lg bg-[#131a28] border border-slate-800">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">
                {isVictory ? 'SAVAŞ SÜRESİ' : 'ULAŞILAN ÇAĞ'}
              </div>
              <div className="text-lg font-mono-num font-bold text-white mt-0.5">
                {isVictory ? `${summary.durationSec} sn` : reachedEra.name}
              </div>
            </div>

            <div className="p-3 rounded-lg bg-[#131a28] border border-slate-800">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">
                {isVictory ? 'YOK EDİLEN BİRİM' : 'KALAN RAKİP KALE'}
              </div>
              <div className="text-lg font-mono-num font-bold text-amber-300 mt-0.5">
                {isVictory
                  ? summary.unitsDefeated
                  : `${summary.enemyHpRemaining} / ${summary.enemyMaxHp}`}
              </div>
            </div>

            <div className="p-3 rounded-lg bg-[#131a28] border border-slate-800">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">
                SKOR / EN İYİ
              </div>
              <div className="text-lg font-mono-num font-bold text-sky-300 mt-0.5">
                {summary.score} / {summary.bestScore}
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            data-start="true"
            onClick={onRestart}
            className="flex-1 py-3 px-5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-display font-extrabold text-base tracking-wider cursor-pointer whitespace-nowrap shrink-0"
          >
            {isVictory ? 'YENİ SAVAŞ BAŞLAT' : 'TEKRAR DENE'}
          </button>
          <button
            type="button"
            onClick={onReturnTitle}
            className="py-3 px-4 rounded-lg bg-[#151d2c] hover:bg-slate-800 border border-slate-700 text-slate-200 font-semibold text-sm cursor-pointer whitespace-nowrap shrink-0"
          >
            Ana Menü
          </button>
        </div>
      </div>
    </div>
  );
};
