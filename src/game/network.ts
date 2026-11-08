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

export interface NetworkCallbacks {
  onStatusChange: (connected: boolean, modeLabel: string, pingMs?: number) => void;
  onRoomWaiting: (code: string, title?: string, hostName?: string) => void;
  onMatchStart: (info: OnlineMatchPlayers) => void;
  onRemoteCommand: (cmd: BattleActionCommand) => void;
  onStateSnapshot: (snapshot: WorldSyncSnapshot) => void;
  onRoomList?: (openRooms: OpenRoomInfo[]) => void;
  onMatchOver?: (winnerTeam: TeamId, winnerName: string, reason?: string) => void;
  onChatMessage?: (sender: string, text: string, isSystem: boolean) => void;
  getWorldSnapshot?: () => WorldSyncSnapshot | null;
  onError: (msg: string) => void;
}

export class OnlineGameNetworkManager {
  private callbacks: NetworkCallbacks;
  private ws: WebSocket | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private snapshotInterval: ReturnType<typeof setInterval> | null = null;

  private clientId: string | null = null;
  private currentRoomCode: string | null = null;
  private myTeam: TeamId = 1;
  private myName = 'Komutan';
  private opponentName = 'Rakip Komutan';
  private isConnecting = false;
  private isManualLeave = false;
  private pingMs = 0;
  private processedCmdIds = new Set<string>();

  constructor(callbacks: NetworkCallbacks) {
    this.callbacks = callbacks;
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

  private getWsUrl(): string {
    if (typeof window === 'undefined') return 'ws://127.0.0.1:3000/ws';
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws`;
  }

  public connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.isConnecting = true;
    this.callbacks.onStatusChange(false, 'Sunucuya Bağlanılıyor...');

    try {
      const url = this.getWsUrl();
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.isConnecting = false;
        this.isManualLeave = false;
        this.callbacks.onStatusChange(true, '🟢 Çevrimiçi (Sunucu Senkronize)', this.pingMs);
        this.startPingLoop();
        this.refreshRooms();

        // If we were in a room before disconnect, attempt re-join
        if (this.currentRoomCode) {
          this.joinRoom(this.currentRoomCode, this.myName);
        }
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      this.ws.onerror = () => {
        this.callbacks.onStatusChange(false, '🔴 Bağlantı Hatası');
      };

      this.ws.onclose = () => {
        this.stopPingLoop();
        this.stopSnapshotLoop();
        this.callbacks.onStatusChange(false, '⚪ Bağlantı Kesildi (Yeniden deneniyor...)');

        if (!this.isManualLeave) {
          if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
          this.reconnectTimeout = setTimeout(() => {
            this.connect();
          }, 2500);
        }
      };
    } catch (err) {
      this.isConnecting = false;
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

  private startSnapshotLoop(): void {
    this.stopSnapshotLoop();
    // Only Team 1 (Authoritative Host) broadcasts state snapshots
    if (this.myTeam !== 1) return;

    this.snapshotInterval = setInterval(() => {
      if (!this.currentRoomCode) return;
      if (this.callbacks.getWorldSnapshot) {
        const snap = this.callbacks.getWorldSnapshot();
        if (snap) {
          this.sendStateSnapshot(snap);
        }
      }
    }, 120); // 8.3 Hz snapshot frequency for silky smooth sync
  }

  private stopSnapshotLoop(): void {
    if (this.snapshotInterval) {
      clearInterval(this.snapshotInterval);
      this.snapshotInterval = null;
    }
  }

  private send(payload: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private handleMessage(raw: string): void {
    try {
      const data = JSON.parse(raw);

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
          this.currentRoomCode = data.code;
          this.myTeam = data.team as TeamId;
          if (data.status === 'waiting') {
            this.callbacks.onRoomWaiting(data.code, data.title, data.hostName);
          }
          break;
        }

        case 'MATCH_START': {
          this.currentRoomCode = data.code;
          const p1 = data.players.find((p: { team: number }) => p.team === 1);
          const p2 = data.players.find((p: { team: number }) => p.team === 2);

          const team1Name = p1?.name || 'Kuzey Ordusu';
          const team2Name = p2?.name || 'Güney Lejyonu';

          this.opponentName = this.myTeam === 1 ? team2Name : team1Name;

          this.callbacks.onMatchStart({
            team1Name,
            team2Name,
            myTeam: this.myTeam,
            roomCode: data.code,
          });

          // If Host, start authoritative snapshot broadcast loop
          if (this.myTeam === 1) {
            this.startSnapshotLoop();
          }
          break;
        }

        case 'ROOM_SYNC': {
          this.currentRoomCode = data.code;
          this.myTeam = data.team as TeamId;
          if (data.lastSnapshot) {
            this.callbacks.onStateSnapshot(data.lastSnapshot);
          }
          break;
        }

        case 'REMOTE_BATTLE_COMMAND': {
          const cmdId = String(data.cmdId);
          if (this.processedCmdIds.has(cmdId)) return;
          this.processedCmdIds.add(cmdId);

          if (data.command) {
            this.callbacks.onRemoteCommand(data.command as BattleActionCommand);
          }
          break;
        }

        case 'STATE_SNAPSHOT': {
          // Team 2 applies authoritative snapshot from Team 1
          if (this.myTeam === 2 && data.snapshot) {
            this.callbacks.onStateSnapshot(data.snapshot);
          }
          break;
        }

        case 'MATCH_OVER': {
          this.stopSnapshotLoop();
          if (this.callbacks.onMatchOver) {
            this.callbacks.onMatchOver(
              data.winnerTeam as TeamId,
              data.winnerName,
              data.reason
            );
          }
          break;
        }

        case 'CHAT_MESSAGE': {
          if (this.callbacks.onChatMessage) {
            this.callbacks.onChatMessage(data.sender, data.text, Boolean(data.isSystem));
          }
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
    } catch {
      // Ignore invalid packet
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
    });
  }

  public joinRoom(code: string, playerName: string): void {
    this.myName = playerName;
    this.send({
      type: 'JOIN_ROOM',
      code: code.trim().toUpperCase(),
      playerName,
    });
  }

  public quickMatch(playerName: string): void {
    this.myName = playerName;
    this.send({
      type: 'QUICK_MATCH',
      playerName,
    });
  }

  public refreshRooms(): void {
    this.send({ type: 'LIST_ROOMS' });
  }

  public sendBattleCommand(cmd: BattleActionCommand): void {
    const cmdId = `${this.clientId || 'c'}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.processedCmdIds.add(cmdId);

    this.send({
      type: 'BATTLE_COMMAND',
      cmdId,
      team: this.myTeam,
      command: cmd,
    });
  }

  public sendStateSnapshot(snapshot: WorldSyncSnapshot): void {
    this.send({
      type: 'STATE_SNAPSHOT',
      snapshot,
    });
  }

  public sendMatchFinish(data: {
    winnerTeam: TeamId;
    durationSeconds: number;
    t1Era: number;
    t2Era: number;
    totalUnits: number;
  }): void {
    this.stopSnapshotLoop();
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
    this.isManualLeave = true;
    this.stopSnapshotLoop();
    this.send({ type: 'LEAVE_ROOM' });
    this.currentRoomCode = null;
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
    this.stopPingLoop();
    this.stopSnapshotLoop();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// Backward-compatible alias for existing imports
export { OnlineGameNetworkManager as ServerlessNetworkManager };
