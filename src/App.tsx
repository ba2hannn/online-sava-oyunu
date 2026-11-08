import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BattleHudOverlay } from './components/BattleHudOverlay';
import { OutcomeAndPauseModals } from './components/OutcomeAndPauseModals';
import { TitleScreenOverlay } from './components/TitleScreenOverlay';
import { soundEngine } from './game/audio';
import { getEraUnits } from './game/catalog';
import { BattleSimulationEngine, HUDStateSnapshot } from './game/engine';
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
  const wsRef = useRef<WebSocket | null>(null);

  const [lifecycle, setLifecycle] = useState<GameLifecycleState>('title');
  const [mode, setMode] = useState<GameMode>('ai');
  const [difficulty, setDifficulty] = useState<AIDifficulty>('normal');
  const [playerName, setPlayerName] = useState<string>('Komutan');
  const [muted, setMuted] = useState<boolean>(false);
  const [summary, setSummary] = useState<RunSummarySnapshot | null>(null);

  // Online Room state
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [roomStatus, setRoomStatus] = useState<'idle' | 'waiting' | 'playing'>('idle');
  const [openRooms, setOpenRooms] = useState<
    Array<{ code: string; hostName: string; playerCount: number; status: string }>
  >([]);
  const [onlineError, setOnlineError] = useState<string | null>(null);

  const [hud, setHud] = useState<HUDStateSnapshot>(() => ({
    team1: createInitialTeamState(1),
    team2: createInitialTeamState(2),
    playerTeam: 1,
    elapsedTime: 0,
    cameraX: 0,
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

    const applied = eng.executeCommand(cmd);
    if (
      applied &&
      !fromRemote &&
      modeRef.current === 'online' &&
      wsRef.current &&
      wsRef.current.readyState === WebSocket.OPEN
    ) {
      wsRef.current.send(
        JSON.stringify({
          type: 'BATTLE_COMMAND',
          cmdId: `${cmd.team}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          team: cmd.team,
          command: cmd,
        })
      );
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

  // Initialize WebSocket connection for Online Multiplayer rooms
  const clientIdRef = useRef<string>('');

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let isUnmounted = false;

    const connectWs = () => {
      if (isUnmounted) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!isUnmounted) {
          setWsConnected(true);
          const params = new URLSearchParams(window.location.search);
          const roomParam = params.get('room');
          if (roomParam) {
            modeRef.current = 'online';
            setMode('online');
            ws.send(
              JSON.stringify({
                type: 'JOIN_ROOM',
                code: roomParam.trim().toUpperCase(),
                playerName,
              })
            );
          }
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'WELCOME') {
            if (msg.clientId) clientIdRef.current = msg.clientId;
            if (Array.isArray(msg.openRooms)) {
              setOpenRooms(msg.openRooms);
            }
          } else if (msg.type === 'ROOM_LIST') {
            if (Array.isArray(msg.openRooms)) {
              setOpenRooms(msg.openRooms);
            }
          } else if (msg.type === 'ROOM_JOINED') {
            setRoomCode(msg.code);
            setRoomStatus(msg.status === 'playing' ? 'playing' : 'waiting');
            setOnlineError(null);
          } else if (msg.type === 'MATCH_START') {
            setRoomCode(msg.code);
            setRoomStatus('playing');
            setOnlineError(null);
            const p1 =
              msg.players?.find((p: { team: number }) => p.team === 1)?.name || 'Komutan 1';
            const p2 =
              msg.players?.find((p: { team: number }) => p.team === 2)?.name || 'Komutan 2';
            const me = msg.players?.find(
              (p: { id: string; team: TeamId }) => p.id === clientIdRef.current
            );
            const myAssignedTeam: TeamId = me?.team === 2 ? 2 : 1;
            modeRef.current = 'online';
            setMode('online');
            startNewGame('online', myAssignedTeam, p1, p2);
          } else if (msg.type === 'REMOTE_BATTLE_COMMAND') {
            const eng = engineRef.current;
            if (eng && msg.command && msg.command.team !== eng.playerTeam) {
              dispatchCommand(msg.command, true);
            }
          } else if (msg.type === 'ERROR') {
            setOnlineError(msg.message || 'Oda bağlantısında hata oluştu.');
          }
        } catch {
          // Ignore malformed WS message
        }
      };

      ws.onclose = () => {
        if (!isUnmounted) {
          setWsConnected(false);
          reconnectTimer = setTimeout(connectWs, 2500);
        }
      };
    };

    connectWs();
    return () => {
      isUnmounted = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [dispatchCommand, playerName, startNewGame]);

  // Mount Canvas & 60 FPS Simulation Loop once
  useEffect(() => {
    const engine = new BattleSimulationEngine(
      (snapshot) => setHud(snapshot),
      (runSummary) => {
        setSummary(runSummary);
        syncBodyDataset('gameover');
      }
    );
    engineRef.current = engine;

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

    return () => {
      isStopped = true;
      cancelAnimationFrame(rafId);
      if (timerId) clearTimeout(timerId);
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
        startNewGame();
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
          roomCode={roomCode}
          roomStatus={roomStatus}
          openRooms={openRooms}
          onlineError={onlineError}
          onCreateOnlineRoom={() => {
            wsRef.current?.send(
              JSON.stringify({ type: 'CREATE_ROOM', playerName })
            );
          }}
          onJoinOnlineRoom={(code) => {
            wsRef.current?.send(
              JSON.stringify({ type: 'JOIN_ROOM', code, playerName })
            );
          }}
          onQuickMatchOnline={() => {
            wsRef.current?.send(
              JSON.stringify({ type: 'QUICK_MATCH', playerName })
            );
          }}
          onRefreshRooms={() => {
            wsRef.current?.send(JSON.stringify({ type: 'LIST_ROOMS' }));
          }}
        />
      )}

      {/* World-Matched Low-Occlusion Playing HUD */}
      {lifecycle !== 'title' && (
        <BattleHudOverlay
          hud={hud}
          mode={mode}
          roomCode={roomCode}
          muted={muted}
          onCommand={(cmd) => dispatchCommand(cmd, false)}
          onToggleMute={() => {
            const next = soundEngine.toggleMute();
            setMuted(next);
          }}
          onPause={() => {
            if (engineRef.current) {
              engineRef.current.lifecycle = 'paused';
              syncBodyDataset('paused');
            }
          }}
          onRestart={() => startNewGame()}
          onPanCamera={(dir) => {
            uiPanDirRef.current = dir;
          }}
          onJumpCamera={(ratio) => {
            engineRef.current?.setCameraNormalized(ratio);
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
        onRestart={() => startNewGame()}
        onReturnTitle={() => {
          if (engineRef.current) {
            engineRef.current.setupTitleDemo();
            syncBodyDataset('title');
          }
        }}
      />
    </main>
  );
}
