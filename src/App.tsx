import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BattleHudOverlay } from './components/BattleHudOverlay';
import { OutcomeAndPauseModals } from './components/OutcomeAndPauseModals';
import { TitleScreenOverlay } from './components/TitleScreenOverlay';
import { soundEngine } from './game/audio';
import { getEraUnits } from './game/catalog';
import { BattleSimulationEngine, HUDStateSnapshot } from './game/engine';
import { NetworkCallbacks, OnlineGameNetworkManager, OpenRoomInfo } from './game/network';
import { createInitialTeamState } from './game/rules';
import {
  AIDifficulty,
  BattleActionCommand,
  GameLifecycleState,
  GameMode,
  RunSummarySnapshot,
  TeamId,
} from './game/types';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<BattleSimulationEngine | null>(null);
  const netRef = useRef<OnlineGameNetworkManager | null>(null);

  const [lifecycle, setLifecycle] = useState<GameLifecycleState>('title');
  const [mode, setMode] = useState<GameMode>('ai');
  const [difficulty, setDifficulty] = useState<AIDifficulty>('normal');
  const [playerName, setPlayerName] = useState<string>('Komutan');
  const [muted, setMuted] = useState<boolean>(false);
  const [summary, setSummary] = useState<RunSummarySnapshot | null>(null);

  // Online Room state (Authoritative Server + WebSocket)
  const [wsConnected, setWsConnected] = useState<boolean>(true);
  const [networkLabel, setNetworkLabel] = useState<string>('Sunucuya Bağlanılıyor...');
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [roomStatus, setRoomStatus] = useState<'idle' | 'waiting' | 'playing'>('idle');
  const [openRooms, setOpenRooms] = useState<OpenRoomInfo[]>([]);
  const [onlineError, setOnlineError] = useState<string | null>(null);

  const [hud, setHud] = useState<HUDStateSnapshot>(() => ({
    team1: createInitialTeamState(1),
    team2: createInitialTeamState(2),
    playerTeam: 1,
    elapsedTime: 0,
    cameraX: 0,
    frontlineBonusPct: 50,
    unitRadar: [],
    activeBanner: null,
  }));

  // Held keys & edge-triggered input state stored in refs so 60Hz loop never triggers React re-renders
  const keysHeldRef = useRef<Set<string>>(new Set());
  const uiPanDirRef = useRef<number>(0);
  const lifecycleRef = useRef<GameLifecycleState>('title');
  const modeRef = useRef<GameMode>('ai');
  const difficultyRef = useRef<AIDifficulty>('normal');

  const syncBodyDataset = useCallback((nextState: GameLifecycleState) => {
    lifecycleRef.current = nextState;
    document.body.dataset.state = nextState;
    setLifecycle(nextState);
  }, []);

  const dispatchCommand = useCallback((cmd: BattleActionCommand, fromRemote = false) => {
    const eng = engineRef.current;
    if (!eng) return;

    if (fromRemote) {
      eng.applyRemoteCommand(cmd);
      return;
    }
    const sent = eng.issueLocalCommand(cmd);
    if (sent && eng.mode === 'online') {
      netRef.current?.sendBattleCommand(sent);
    }
  }, []);

  const startNewGame = useCallback(
    (
      overrideMode?: GameMode,
      overrideTeam: TeamId = 1,
      team1Name?: string,
      team2Name?: string
    ) => {
      const eng = engineRef.current;
      if (!eng) return;
      const activeMode = overrideMode ?? modeRef.current;

      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      keysHeldRef.current.clear();
      uiPanDirRef.current = 0;
      setSummary(null);

      eng.resetMatch(
        activeMode,
        difficultyRef.current,
        overrideTeam,
        team1Name || playerName || 'Kuzey Sancağı',
        team2Name
      );
      eng.lifecycle = 'playing';
      syncBodyDataset('playing');
      soundEngine.playUiClick();
    },
    [playerName, syncBodyDataset]
  );

  // An online match cannot be restarted unilaterally (it would reset only one side and,
  // previously, silently switched the guest to team 1). Leave the room and go back instead.
  const leaveOnlineMatchToTitle = useCallback(() => {
    netRef.current?.leaveRoom();
    setRoomCode(null);
    setRoomStatus('idle');
    setSummary(null);
    if (engineRef.current) {
      engineRef.current.setupTitleDemo();
      syncBodyDataset('title');
    }
  }, [syncBodyDataset]);

  const handleRestart = useCallback(() => {
    if (engineRef.current?.mode === 'online') {
      leaveOnlineMatchToTitle();
    } else {
      startNewGame();
    }
  }, [leaveOnlineMatchToTitle, startNewGame]);

  const buildNetCallbacks = useCallback(
    (): NetworkCallbacks => ({
      onStatusChange: (connected, label) => {
        setWsConnected(connected);
        setNetworkLabel(label);
      },
      onRoomWaiting: (code) => {
        setRoomCode(code);
        setRoomStatus('waiting');
        setOnlineError(null);
      },
      onRoomList: (rooms) => {
        setOpenRooms(rooms);
      },
      onMatchStart: ({ team1Name, team2Name, myTeam, roomCode: startedCode, resumeSnapshot }) => {
        setRoomCode(startedCode);
        setRoomStatus('playing');
        setOnlineError(null);
        modeRef.current = 'online';
        setMode('online');
        startNewGame('online', myTeam, team1Name, team2Name);
        if (resumeSnapshot) {
          engineRef.current?.applyWorldSnapshot(resumeSnapshot);
        }
      },
      onRoomSync: ({ roomCode: syncedCode, myTeam, status, team1Name, team2Name, snapshot }) => {
        const eng = engineRef.current;
        if (!eng) return;
        setRoomCode(syncedCode);
        setOnlineError(null);
        if (status === 'waiting') {
          setRoomStatus('waiting');
          return;
        }
        if (status !== 'playing') return;
        setRoomStatus('playing');
        const alreadyInMatch =
          eng.mode === 'online' &&
          eng.playerTeam === myTeam &&
          (eng.lifecycle === 'playing' || eng.lifecycle === 'paused');
        if (!alreadyInMatch) {
          // Page was reloaded mid-match: rebuild the battle from the last authoritative state.
          modeRef.current = 'online';
          setMode('online');
          startNewGame('online', myTeam, team1Name, team2Name);
          if (snapshot) eng.applyWorldSnapshot(snapshot);
        } else if (eng.isNetReplica() && snapshot) {
          // Stale snapshots are rejected by sequence number inside the engine.
          eng.applyWorldSnapshot(snapshot);
        }
        // A live host keeps its own (newer) simulation and simply resumes broadcasting.
      },
      onRoomLost: () => {
        setRoomCode(null);
        setRoomStatus('idle');
      },
      onRemoteCommand: (cmd) => {
        dispatchCommand(cmd, true);
      },
      onStateSnapshot: (snap) => {
        const eng = engineRef.current;
        if (eng && eng.isNetReplica()) {
          eng.applyWorldSnapshot(snap);
        }
      },
      onMatchOver: (winnerTeam) => {
        const eng = engineRef.current;
        if (!eng || eng.mode !== 'online') return;
        // Ends through the regular outcome path so both players get the summary screen.
        eng.concludeFromAuthority(winnerTeam);
      },
      onError: (msg) => {
        setOnlineError(msg);
      },
    }),
    [dispatchCommand, startNewGame]
  );

  // Initialize WebSocket Network Manager ONCE so typing name or starting game never drops connection
  useEffect(() => {
    const net = new OnlineGameNetworkManager(buildNetCallbacks());
    netRef.current = net;

    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      const cleanCode = roomParam.trim().toUpperCase();
      modeRef.current = 'online';
      setMode('online');
      setRoomCode(cleanCode);
      setTimeout(() => {
        net.joinRoom(cleanCode, 'Komutan 2');
      }, 350);
    }

    return () => {
      net.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    netRef.current?.updateCallbacks(buildNetCallbacks());
  }, [buildNetCallbacks]);

  // Mount Canvas & 60 FPS Simulation Loop once
  useEffect(() => {
    const engine = new BattleSimulationEngine(
      (snapshot) => setHud(snapshot),
      (runSummary) => {
        setSummary(runSummary);
        syncBodyDataset('gameover');
        if (modeRef.current === 'online') {
          netRef.current?.sendMatchFinish({
            winnerTeam: runSummary.winner,
            durationSeconds: runSummary.durationSec,
            t1Era: engineRef.current?.team1.era ?? 0,
            t2Era: engineRef.current?.team2.era ?? 0,
            totalUnits: runSummary.unitsSpawned + runSummary.unitsDefeated,
          });
        }
      },
      (worldSnap) => {
        netRef.current?.sendStateSnapshot(worldSnap);
      }
    );
    engineRef.current = engine;
    if (import.meta.env.DEV) (window as unknown as { __engine?: unknown }).__engine = engine;

    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      engine.resetMatch('ai', 'normal', 1);
      engine.lifecycle = 'playing';
      syncBodyDataset('playing');
    } else {
      syncBodyDataset('title');
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const updateCanvasBounds = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    updateCanvasBounds();
    const resizeObserver = new ResizeObserver(updateCanvasBounds);
    resizeObserver.observe(canvas);

    let rafId = 0;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let isStopped = false;
    let lastTime = performance.now();

    const loop = (now: number) => {
      if (isStopped) return;
      const rawDt = (now - lastTime) / 1000;
      lastTime = now;

      let camDir = uiPanDirRef.current;
      if (keysHeldRef.current.has('KeyA') || keysHeldRef.current.has('ArrowLeft')) {
        camDir -= 1;
      }
      if (keysHeldRef.current.has('KeyD') || keysHeldRef.current.has('ArrowRight')) {
        camDir += 1;
      }

      engine.step(rawDt, camDir);
      engine.render(ctx, window.innerWidth, window.innerHeight);

      timerId = setTimeout(() => {
        if (!isStopped) {
          rafId = requestAnimationFrame(loop);
        }
      }, 16);
    };

    rafId = requestAnimationFrame(loop);

    // Background-tab fallback timer so Online P2P simulation never freezes when a browser tab is hidden/minimized
    const bgInterval = setInterval(() => {
      if (
        !isStopped &&
        document.hidden &&
        lifecycleRef.current === 'playing' &&
        modeRef.current === 'online'
      ) {
        const now = performance.now();
        const dt = Math.min(0.12, (now - lastTime) / 1000);
        lastTime = now;
        engine.step(dt, 0);
      }
    }, 100);

    return () => {
      isStopped = true;
      cancelAnimationFrame(rafId);
      if (timerId) clearTimeout(timerId);
      clearInterval(bgInterval);
      resizeObserver.disconnect();
    };
  }, [syncBodyDataset]);

  // Unified Keyboard Input Listener & Focus-Loss Hygiene
  useEffect(() => {
    const clearHeldInputs = () => {
      keysHeldRef.current.clear();
      uiPanDirRef.current = 0;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore shortcuts while typing in text inputs
      if (
        document.activeElement &&
        (document.activeElement.tagName === 'INPUT' ||
          document.activeElement.tagName === 'TEXTAREA')
      ) {
        return;
      }

      const code = e.code;
      const isEdge = !keysHeldRef.current.has(code);
      keysHeldRef.current.add(code);

      if (!isEdge) return;

      const currentState = lifecycleRef.current;
      const eng = engineRef.current;
      if (!eng) return;

      // Title Screen Start Handshake on Enter or Space
      if (currentState === 'title') {
        if (code === 'Enter' || code === 'Space') {
          e.preventDefault();
          startNewGame();
        }
        return;
      }

      // Pause / Resume toggle on Escape or P
      if (code === 'Escape' || code === 'KeyP') {
        e.preventDefault();
        // Online battles cannot be paused: freezing one side's simulation desyncs it from
        // the other (the host would stop sending snapshots, the guest would drift).
        if (modeRef.current === 'online') return;
        if (currentState === 'playing') {
          eng.lifecycle = 'paused';
          syncBodyDataset('paused');
        } else if (currentState === 'paused') {
          eng.lifecycle = 'playing';
          syncBodyDataset('playing');
        }
        return;
      }

      if (code === 'KeyM') {
        const nextMute = soundEngine.toggleMute();
        setMuted(nextMute);
        return;
      }

      if (code === 'KeyR' && (currentState === 'playing' || currentState === 'paused')) {
        // Restart is local-only; in an online match it would hijack team 1 and desync.
        if (modeRef.current !== 'online') startNewGame();
        return;
      }

      if (currentState !== 'playing') return;

      const myTeamState = eng.playerTeam === 1 ? eng.team1 : eng.team2;
      const myEraUnits = getEraUnits(myTeamState.era);

      // Player 1 Unit Spawns [1-4]
      if (code === 'Digit1' && myEraUnits[0]) {
        dispatchCommand({ type: 'SPAWN_UNIT', team: eng.playerTeam, defId: myEraUnits[0].id });
      } else if (code === 'Digit2' && myEraUnits[1]) {
        dispatchCommand({ type: 'SPAWN_UNIT', team: eng.playerTeam, defId: myEraUnits[1].id });
      } else if (code === 'Digit3' && myEraUnits[2]) {
        dispatchCommand({ type: 'SPAWN_UNIT', team: eng.playerTeam, defId: myEraUnits[2].id });
      } else if (code === 'Digit4' && myEraUnits[3]) {
        dispatchCommand({ type: 'SPAWN_UNIT', team: eng.playerTeam, defId: myEraUnits[3].id });
      } else if (code === 'KeyQ') {
        dispatchCommand({ type: 'EVOLVE_ERA', team: eng.playerTeam });
      } else if (code === 'Space') {
        e.preventDefault();
        dispatchCommand({ type: 'CAST_SPECIAL', team: eng.playerTeam });
      }

      // Local 2-Player Secondary Controls [7, 8, 9, 0, U, Enter]
      if (modeRef.current === 'local2p') {
        const p2Units = getEraUnits(eng.team2.era);
        if (code === 'Digit7' && p2Units[0]) {
          dispatchCommand({ type: 'SPAWN_UNIT', team: 2, defId: p2Units[0].id });
        } else if (code === 'Digit8' && p2Units[1]) {
          dispatchCommand({ type: 'SPAWN_UNIT', team: 2, defId: p2Units[1].id });
        } else if (code === 'Digit9' && p2Units[2]) {
          dispatchCommand({ type: 'SPAWN_UNIT', team: 2, defId: p2Units[2].id });
        } else if (code === 'Digit0' && p2Units[3]) {
          dispatchCommand({ type: 'SPAWN_UNIT', team: 2, defId: p2Units[3].id });
        } else if (code === 'KeyU') {
          dispatchCommand({ type: 'EVOLVE_ERA', team: 2 });
        } else if (code === 'Enter') {
          dispatchCommand({ type: 'CAST_SPECIAL', team: 2 });
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysHeldRef.current.delete(e.code);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', clearHeldInputs);
    document.addEventListener('visibilitychange', clearHeldInputs);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', clearHeldInputs);
      document.removeEventListener('visibilitychange', clearHeldInputs);
    };
  }, [dispatchCommand, startNewGame, syncBodyDataset]);

  return (
    <main
      onWheel={(e) => {
        if (lifecycleRef.current === 'playing' && engineRef.current) {
          const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
          const eng = engineRef.current;
          eng.targetCameraX = Math.max(
            -60,
            Math.min(eng.getMaxCameraX(), eng.targetCameraX + delta * 1.4)
          );
        }
      }}
      className="relative w-screen h-screen overflow-hidden bg-[#090c12] select-none"
    >
      {/* Isolated Full-Viewport 60 FPS Battle Canvas */}
      <canvas
        ref={canvasRef}
        data-testid="battle-canvas"
        className="block w-full h-full"
      />

      {/* Title Screen Stage */}
      {lifecycle === 'title' && (
        <TitleScreenOverlay
          mode={mode}
          difficulty={difficulty}
          playerName={playerName}
          onPlayerNameChange={setPlayerName}
          onSelectMode={(nextMode) => {
            modeRef.current = nextMode;
            setMode(nextMode);
          }}
          onSelectDifficulty={(nextDiff) => {
            difficultyRef.current = nextDiff;
            setDifficulty(nextDiff);
          }}
          onStartGame={() => {
            // If player clicks Start while waiting in Online room, allow immediate play vs adaptive bot
            if (mode === 'online' && roomStatus !== 'playing') {
              modeRef.current = 'ai';
              startNewGame('ai', 1, playerName, 'Online Komutan (Bot)');
            } else {
              startNewGame();
            }
          }}
          wsConnected={wsConnected}
          networkLabel={networkLabel}
          roomCode={roomCode}
          roomStatus={roomStatus}
          openRooms={openRooms}
          onlineError={onlineError}
          onCreateOnlineRoom={(title, isPrivate, customCode) => {
            netRef.current?.createRoom(playerName, title, isPrivate, customCode);
          }}
          onJoinOnlineRoom={(code) => {
            netRef.current?.joinRoom(code, playerName);
          }}
          onQuickMatchOnline={() => {
            netRef.current?.quickMatch(playerName);
          }}
          onRefreshRooms={() => {
            netRef.current?.refreshRooms();
          }}
        />
      )}

      {/* World-Matched Low-Occlusion Playing HUD */}
      {lifecycle !== 'title' && (
        <BattleHudOverlay
          hud={hud}
          mode={mode}
          roomCode={roomCode}
          networkLabel={networkLabel}
          muted={muted}
          onCommand={(cmd) => dispatchCommand(cmd, false)}
          onToggleMute={() => {
            const next = soundEngine.toggleMute();
            setMuted(next);
          }}
          onPause={() => {
            if (engineRef.current && engineRef.current.mode !== 'online') {
              engineRef.current.lifecycle = 'paused';
              syncBodyDataset('paused');
            }
          }}
          onRestart={handleRestart}
          onPanCamera={(dir) => {
            uiPanDirRef.current = dir;
          }}
          onJumpCamera={(ratio) => {
            engineRef.current?.setCameraNormalized(ratio);
          }}
          onManualSync={() => {
            netRef.current?.requestManualSyncOrReconnect();
          }}
        />
      )}

      {/* Focused Status Modal for Pause / Victory / Defeat */}
      <OutcomeAndPauseModals
        lifecycle={lifecycle}
        summary={summary}
        onResume={() => {
          if (engineRef.current) {
            engineRef.current.lifecycle = 'playing';
            syncBodyDataset('playing');
          }
        }}
        onRestart={handleRestart}
        onReturnTitle={() => {
          if (engineRef.current?.mode === 'online') {
            leaveOnlineMatchToTitle();
            return;
          }
          if (engineRef.current) {
            engineRef.current.setupTitleDemo();
            syncBodyDataset('title');
          }
        }}
      />
    </main>
  );
}
