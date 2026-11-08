import { BattleActionCommand, TeamId, WorldSyncSnapshot } from './types';

export interface OpenRoomInfo {
  code: string;
  hostName: string;
  title: string;
  playerCount: number;
  status: string;
  createdAt: number;
}

export interface OnlineMatchPlayers {
  team1Name: string;
  team2Name: string;
  myTeam: TeamId;
  roomCode: string;
  resumeSnapshot?: WorldSyncSnapshot;
}

export interface RoomSyncInfo {
  roomCode: string;
  myTeam: TeamId;
  status: 'waiting' | 'playing' | 'finished';
  team1Name: string;
  team2Name: string;
  snapshot?: WorldSyncSnapshot;
}

export interface NetworkCallbacks {
  onStatusChange: (connected: boolean, modeLabel: string, pingMs?: number) => void;
  onRoomWaiting: (code: string, title?: string, hostName?: string) => void;
  onMatchStart: (info: OnlineMatchPlayers) => void;
  /** Re-joined a room after a dropped connection or page reload. */
  onRoomSync?: (info: RoomSyncInfo) => void;
  /** A resume attempt failed (room gone / slot not ours): forget the room silently. */
  onRoomLost?: () => void;
  onRemoteCommand: (cmd: BattleActionCommand) => void;
  onStateSnapshot: (snapshot: WorldSyncSnapshot) => void;
  onRoomList?: (openRooms: OpenRoomInfo[]) => void;
  onMatchOver?: (winnerTeam: TeamId, winnerName: string, reason?: string) => void;
  onChatMessage?: (sender: string, text: string, isSystem: boolean) => void;
  onError: (msg: string) => void;
}

/** Stale snapshots are worthless; skip sending while the socket is this backed up. */
const SNAPSHOT_BACKPRESSURE_BYTES = 256 * 1024;
const MAX_OUTBOX = 64;
const MAX_PROCESSED_IDS = 2000;
const SESSION_KEY = 'cbs_session_id';
const ROOM_KEY = 'cbs_room_code';

function safeSessionGet(key: string): string | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function safeSessionSet(key: string, value: string | null): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // storage unavailable (private mode etc.) — reconnect still works within the page
  }
}

/**
 * Rounds non-integer numbers to 2 decimals: snapshots shrink ~2-3x with no visible effect.
 * A non-zero value never rounds to 0 (e.g. a fortress at 0.004 hp must not look destroyed).
 */
export function compactNumberReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'number' && !Number.isInteger(value) && Number.isFinite(value)) {
    const rounded = Math.round(value * 100) / 100;
    if (rounded === 0) return value > 0 ? 0.01 : -0.01;
    return rounded;
  }
  return value;
}

export class OnlineGameNetworkManager {
  private callbacks: NetworkCallbacks;
  private ws: WebSocket | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  private clientId: string | null = null;
  /**
   * Stable per-tab identity used by the server to recognise a reconnecting player. Previously
   * reconnects were matched by player *name*, and both players default to "Komutan", so a
   * guest joining could take over the host's slot (both ended up as team 1 and never saw
   * each other's units).
   */
  private sessionId: string;
  private currentRoomCode: string | null = null;
  private myTeam: TeamId = 1;
  private myName = 'Komutan';
  private isManualLeave = false;
  private pingMs = 0;
  private processedCmdIds = new Set<string>();
  /** Battle commands produced while the socket was down; flushed after re-joining. */
  private outbox: unknown[] = [];

  constructor(callbacks: NetworkCallbacks) {
    this.callbacks = callbacks;
    const stored = safeSessionGet(SESSION_KEY);
    this.sessionId =
      stored || `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    safeSessionSet(SESSION_KEY, this.sessionId);
    this.currentRoomCode = safeSessionGet(ROOM_KEY);
    this.connect();
  }

  public updateCallbacks(callbacks: NetworkCallbacks): void {
    this.callbacks = callbacks;
  }

  public getMyTeam(): TeamId {
    return this.myTeam;
  }

  public getRoomCode(): string | null {
    return this.currentRoomCode;
  }

  public getPing(): number {
    return this.pingMs;
  }

  private setRoom(code: string | null): void {
    this.currentRoomCode = code;
    safeSessionSet(ROOM_KEY, code);
  }

  private getWsUrl(): string {
    if (typeof window === 'undefined') return 'ws://127.0.0.1:3000/ws';
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws`;
  }

  public connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.isManualLeave = false;
    this.callbacks.onStatusChange(false, 'Sunucuya Bağlanılıyor...');

    try {
      const url = this.getWsUrl();
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = () => {
        this.callbacks.onStatusChange(true, '🟢 Çevrimiçi (Sunucu Senkronize)', this.pingMs);
        this.startPingLoop();
        this.refreshRooms();

        // If we were in a room before the disconnect (or page reload), resume our slot.
        if (this.currentRoomCode) {
          this.send({
            type: 'JOIN_ROOM',
            code: this.currentRoomCode,
            playerName: this.myName,
            sessionId: this.sessionId,
            resume: true,
          });
        }
      };

      ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      ws.onerror = () => {
        this.callbacks.onStatusChange(false, '🔴 Bağlantı Hatası');
      };

      ws.onclose = () => {
        if (this.ws !== ws) return; // superseded socket
        this.stopPingLoop();
        this.callbacks.onStatusChange(false, '⚪ Bağlantı Kesildi (Yeniden deneniyor...)');

        if (!this.isManualLeave) {
          if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
          this.reconnectTimeout = setTimeout(() => {
            this.connect();
          }, 2500);
        }
      };
    } catch (err) {
      this.callbacks.onError('WebSocket sunucusuna bağlanılamadı.');
    }
  }

  private startPingLoop(): void {
    this.stopPingLoop();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send({ type: 'PING', clientTs: Date.now() });
      }
    }, 2000);
  }

  private stopPingLoop(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private isOpen(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  private send(payload: unknown): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }

  private flushOutbox(): void {
    if (!this.isOpen()) return;
    const pending = this.outbox;
    this.outbox = [];
    for (const payload of pending) this.send(payload);
  }

  private rememberCmdId(cmdId: string): void {
    this.processedCmdIds.add(cmdId);
    if (this.processedCmdIds.size > MAX_PROCESSED_IDS) {
      let toDrop = this.processedCmdIds.size - MAX_PROCESSED_IDS / 2;
      for (const id of this.processedCmdIds) {
        if (toDrop-- <= 0) break;
        this.processedCmdIds.delete(id);
      }
    }
  }

  private handleMessage(raw: string): void {
    let data: any;
    try {
      data = JSON.parse(raw);
    } catch {
      return; // Ignore invalid packet
    }

    switch (data.type) {
      case 'WELCOME': {
        this.clientId = data.clientId;
        if (Array.isArray(data.openRooms) && this.callbacks.onRoomList) {
          this.callbacks.onRoomList(data.openRooms);
        }
        break;
      }

      case 'PONG': {
        if (data.clientTs) {
          this.pingMs = Math.max(1, Date.now() - data.clientTs);
          this.callbacks.onStatusChange(true, `🟢 Çevrimiçi · ${this.pingMs} ms`, this.pingMs);
        }
        break;
      }

      case 'ROOM_LIST': {
        if (Array.isArray(data.openRooms) && this.callbacks.onRoomList) {
          this.callbacks.onRoomList(data.openRooms);
        }
        break;
      }

      case 'ROOM_JOINED': {
        this.setRoom(data.code);
        this.myTeam = data.team as TeamId;
        if (data.status === 'waiting') {
          this.callbacks.onRoomWaiting(data.code, data.title, data.hostName);
        }
        break;
      }

      case 'MATCH_START': {
        this.setRoom(data.code);
        const players: Array<{ id: string; name: string; team: number }> = Array.isArray(data.players)
          ? data.players
          : [];
        // Trust the server's roster for our own team assignment.
        const me = players.find((p) => p.id === this.clientId);
        if (me && (me.team === 1 || me.team === 2)) this.myTeam = me.team;
        const p1 = players.find((p) => p.team === 1);
        const p2 = players.find((p) => p.team === 2);

        this.callbacks.onMatchStart({
          team1Name: p1?.name || 'Kuzey Ordusu',
          team2Name: p2?.name || 'Güney Lejyonu',
          myTeam: this.myTeam,
          roomCode: data.code,
        });
        break;
      }

      case 'ROOM_SYNC': {
        if (data.status === 'finished') {
          this.setRoom(null);
          this.outbox = [];
          this.callbacks.onRoomLost?.();
          break;
        }
        this.setRoom(data.code);
        this.myTeam = data.team as TeamId;
        const players: Array<{ name: string; team: number }> = Array.isArray(data.players)
          ? data.players
          : [];
        this.callbacks.onRoomSync?.({
          roomCode: data.code,
          myTeam: this.myTeam,
          status: data.status,
          team1Name: players.find((p) => p.team === 1)?.name || 'Kuzey Ordusu',
          team2Name: players.find((p) => p.team === 2)?.name || 'Güney Lejyonu',
          snapshot: data.lastSnapshot || undefined,
        });
        this.flushOutbox();
        break;
      }

      case 'RESUME_FAILED': {
        this.setRoom(null);
        this.outbox = [];
        this.callbacks.onRoomLost?.();
        break;
      }

      case 'REMOTE_BATTLE_COMMAND': {
        const cmdId = String(data.cmdId);
        if (this.processedCmdIds.has(cmdId)) return;
        this.rememberCmdId(cmdId);

        if (data.command) {
          this.callbacks.onRemoteCommand(data.command as BattleActionCommand);
        }
        break;
      }

      case 'STATE_SNAPSHOT': {
        // Team 2 applies the authoritative snapshot from Team 1
        if (this.myTeam === 2 && data.snapshot) {
          this.callbacks.onStateSnapshot(data.snapshot);
        }
        break;
      }

      case 'MATCH_OVER': {
        this.outbox = [];
        if (this.callbacks.onMatchOver) {
          this.callbacks.onMatchOver(data.winnerTeam as TeamId, data.winnerName, data.reason);
        }
        break;
      }

      case 'CHAT_MESSAGE': {
        if (this.callbacks.onChatMessage) {
          this.callbacks.onChatMessage(data.sender, data.text, Boolean(data.isSystem));
        }
        break;
      }

      case 'PLAYER_DISCONNECTED': {
        this.callbacks.onChatMessage?.(
          'Sistem',
          `${data.playerName || 'Rakip'} bağlantısı koptu, yeniden bağlanması bekleniyor...`,
          true
        );
        break;
      }

      case 'PLAYER_LEFT': {
        if (this.callbacks.onChatMessage) {
          this.callbacks.onChatMessage(
            'Sistem',
            `${data.leftPlayerName || 'Bir oyuncu'} savaştan ayrıldı.`,
            true
          );
        }
        break;
      }

      case 'ERROR': {
        this.callbacks.onError(data.message || 'Bilinmeyen sunucu hatası.');
        break;
      }
    }
  }

  public createRoom(
    playerName: string,
    title?: string,
    isPrivate = false,
    customCode?: string
  ): void {
    this.myName = playerName;
    this.send({
      type: 'CREATE_ROOM',
      playerName,
      title,
      isPrivate,
      code: customCode,
      sessionId: this.sessionId,
    });
  }

  public joinRoom(code: string, playerName: string): void {
    this.myName = playerName;
    this.send({
      type: 'JOIN_ROOM',
      code: code.trim().toUpperCase(),
      playerName,
      sessionId: this.sessionId,
    });
  }

  public quickMatch(playerName: string): void {
    this.myName = playerName;
    this.send({
      type: 'QUICK_MATCH',
      playerName,
      sessionId: this.sessionId,
    });
  }

  public refreshRooms(): void {
    this.send({ type: 'LIST_ROOMS' });
  }

  public sendBattleCommand(cmd: BattleActionCommand): void {
    const cmdId = `${this.sessionId}_${cmd.seq ?? 'x'}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.rememberCmdId(cmdId);

    const payload = {
      type: 'BATTLE_COMMAND',
      cmdId,
      team: this.myTeam,
      command: cmd,
    };
    if (!this.send(payload) && this.currentRoomCode) {
      // Keep it for after the reconnect instead of silently losing the order.
      this.outbox.push(payload);
      if (this.outbox.length > MAX_OUTBOX) this.outbox.shift();
    }
  }

  public sendStateSnapshot(snapshot: WorldSyncSnapshot): void {
    // Only the authoritative host (team 1) ever publishes world state.
    if (this.myTeam !== 1 || !this.currentRoomCode || !this.ws) return;
    if (this.ws.readyState !== WebSocket.OPEN) return;
    if (this.ws.bufferedAmount > SNAPSHOT_BACKPRESSURE_BYTES) return;
    this.ws.send(JSON.stringify({ type: 'STATE_SNAPSHOT', snapshot }, compactNumberReplacer));
  }

  public sendMatchFinish(data: {
    winnerTeam: TeamId;
    durationSeconds: number;
    t1Era: number;
    t2Era: number;
    totalUnits: number;
  }): void {
    this.send({
      type: 'MATCH_FINISH',
      ...data,
    });
  }

  public sendChatMessage(text: string): void {
    this.send({
      type: 'CHAT_MESSAGE',
      text,
    });
  }

  public leaveRoom(): void {
    this.send({ type: 'LEAVE_ROOM' });
    this.setRoom(null);
    this.outbox = [];
    this.refreshRooms();
  }

  public requestManualSyncOrReconnect(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.connect();
    } else {
      this.send({ type: 'PING', clientTs: Date.now() });
      this.refreshRooms();
    }
  }

  public disconnect(): void {
    this.isManualLeave = true;
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    this.stopPingLoop();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// Backward-compatible alias for existing imports
export { OnlineGameNetworkManager as ServerlessNetworkManager };
