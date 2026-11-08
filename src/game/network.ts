import Peer, { DataConnection } from 'peerjs';
import { BattleActionCommand, TeamId } from './types';

const PEER_PREFIX = 'cbs-online-v2-room-';
const QUICKMATCH_PEER_ID = 'cbs-online-v2-quickmatch-lobby';

export interface OnlineMatchPlayers {
  team1Name: string;
  team2Name: string;
  myTeam: TeamId;
  roomCode: string;
}

export interface NetworkCallbacks {
  onStatusChange: (connected: boolean, modeLabel: string) => void;
  onRoomWaiting: (code: string) => void;
  onMatchStart: (info: OnlineMatchPlayers) => void;
  onRemoteCommand: (cmd: BattleActionCommand) => void;
  onError: (msg: string) => void;
}

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 5; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
];

export class ServerlessNetworkManager {
  private callbacks: NetworkCallbacks;
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private bc: BroadcastChannel | null = null;
  private joinRetryTimer: ReturnType<typeof setTimeout> | null = null;

  private clientId = `p2p_${Math.random().toString(36).slice(2, 10)}`;
  private currentCode: string | null = null;
  private myTeam: TeamId = 1;
  private myName = 'Komutan';
  private matchStarted = false;
  private processedCmdIds = new Set<string>();

  constructor(callbacks: NetworkCallbacks) {
    this.callbacks = callbacks;
    this.initChannels();
  }

  public updateCallbacks(callbacks: NetworkCallbacks): void {
    this.callbacks = callbacks;
  }

  private initChannels(): void {
    // 1. Same-browser multi-tab BroadcastChannel (instant zero-config testing across tabs)
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      this.bc = new BroadcastChannel('cbs_online_p2p_bus');
      this.bc.onmessage = (ev) => {
        this.handleBusPacket(ev.data);
      };
    }

    // Immediately mark Serverless WebRTC P2P ready (never blocks on a backend /ws)
    this.callbacks.onStatusChange(true, 'Sunucusuz WebRTC P2P Aktif');
  }

  private clearJoinRetry(): void {
    if (this.joinRetryTimer) {
      clearTimeout(this.joinRetryTimer);
      this.joinRetryTimer = null;
    }
  }

  private destroyPeer(): void {
    this.clearJoinRetry();
    if (this.conn) {
      try {
        this.conn.close();
      } catch {
        // ignore
      }
      this.conn = null;
    }
    if (this.peer) {
      try {
        this.peer.destroy();
      } catch {
        // ignore
      }
      this.peer = null;
    }
  }

  public createRoom(playerName: string, customCode?: string): string {
    this.myName = (playerName || 'Komutan 1').trim() || 'Komutan 1';
    this.myTeam = 1;
    this.matchStarted = false;
    const code = customCode || generateCode();
    this.currentCode = code;
    this.callbacks.onRoomWaiting(code);
    this.callbacks.onStatusChange(true, `Oda #${code} Hazıruluyor...`);

    this.destroyPeer();
    try {
      const peerId = `${PEER_PREFIX}${code}`;
      const peer = new Peer(peerId, {
        secure: true,
        config: { iceServers: ICE_SERVERS },
      });
      this.peer = peer;

      peer.on('open', () => {
        this.callbacks.onStatusChange(true, `Oda #${code} Aktif · Linki Paylaşın`);
      });

      peer.on('connection', (conn) => {
        this.conn = conn;
        this.setupDataConnection(conn, code, true);
      });

      peer.on('error', (err) => {
        if (err.type === 'unavailable-id' && !customCode) {
          this.createRoom(this.myName);
        } else {
          this.callbacks.onStatusChange(true, `Oda #${code} Aktif`);
        }
      });
    } catch {
      this.callbacks.onStatusChange(true, `Oda #${code} Aktif`);
    }

    return code;
  }

  public joinRoom(codeRaw: string, playerName: string, attempt = 1): void {
    const code = codeRaw.trim().toUpperCase();
    if (!code) return;
    this.myName = (playerName || 'Komutan 2').trim() || 'Komutan 2';
    this.myTeam = 2;
    this.matchStarted = false;
    this.currentCode = code;
    this.callbacks.onStatusChange(true, `Oda #${code} Bağlanıyor...`);

    // 1. BroadcastChannel announcement for instant same-browser multi-tab join
    this.bc?.postMessage({
      type: 'BC_JOIN_REQUEST',
      code,
      guestName: this.myName,
      guestId: this.clientId,
    });

    // 2. Serverless WebRTC P2P connection over the internet
    this.destroyPeer();
    try {
      const peer = new Peer({
        secure: true,
        config: { iceServers: ICE_SERVERS },
      });
      this.peer = peer;

      peer.on('open', () => {
        const hostPeerId =
          code === 'HIZLI' ? QUICKMATCH_PEER_ID : `${PEER_PREFIX}${code}`;
        const conn = peer.connect(hostPeerId, {
          reliable: true,
          serialization: 'json',
        });
        this.conn = conn;
        this.setupDataConnection(conn, code, false);

        // Retry if WebRTC handshake hasn't completed within 3.5s
        this.clearJoinRetry();
        this.joinRetryTimer = setTimeout(() => {
          if (!this.matchStarted && attempt < 4) {
            this.joinRoom(code, this.myName, attempt + 1);
          } else if (!this.matchStarted) {
            this.callbacks.onError(
              `#${code} odasına ulaşılamadı. Oda sahibinin sayfayı açık tuttuğundan emin olun.`
            );
          }
        }, 3500);
      });

      peer.on('error', () => {
        if (!this.matchStarted && attempt < 3) {
          this.clearJoinRetry();
          this.joinRetryTimer = setTimeout(() => {
            this.joinRoom(code, this.myName, attempt + 1);
          }, 1500);
        } else if (!this.matchStarted) {
          this.callbacks.onError(
            `#${code} odası bulunamadı veya kapandı. Lütfen yeni bir oda kodu deneyin.`
          );
        }
      });
    } catch {
      // Fallback handled by BroadcastChannel
    }
  }

  public quickMatch(playerName: string): void {
    this.myName = (playerName || 'Savaşçı').trim() || 'Savaşçı';
    this.matchStarted = false;
    this.callbacks.onStatusChange(true, 'Hızlı Eşleşme Aranıyor...');

    this.destroyPeer();
    try {
      const hostPeer = new Peer(QUICKMATCH_PEER_ID, {
        secure: true,
        config: { iceServers: ICE_SERVERS },
      });
      this.peer = hostPeer;

      hostPeer.on('open', () => {
        this.myTeam = 1;
        this.currentCode = 'HIZLI';
        this.callbacks.onRoomWaiting('HIZLI');
        this.callbacks.onStatusChange(true, 'Hızlı Eşleşme Kuyruğu Aktif');
      });

      hostPeer.on('connection', (conn) => {
        this.conn = conn;
        this.setupDataConnection(conn, 'HIZLI', true);
      });

      hostPeer.on('error', (err) => {
        if (err.type === 'unavailable-id') {
          // Someone is already waiting in the QuickMatch lobby — join them as Player 2!
          this.joinRoom('HIZLI', this.myName);
        } else {
          this.createRoom(this.myName);
        }
      });
    } catch {
      this.createRoom(this.myName);
    }
  }

  private setupDataConnection(conn: DataConnection, code: string, isHost: boolean): void {
    conn.on('open', () => {
      this.clearJoinRetry();
      this.callbacks.onStatusChange(true, `WebRTC P2P Bağlandı (#${code})`);
      if (!isHost) {
        conn.send({
          type: 'P2P_HELLO',
          guestName: this.myName,
          code,
        });
      }
    });

    conn.on('data', (raw: unknown) => {
      const msg = raw as Record<string, unknown>;
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'P2P_HELLO' && isHost) {
        this.clearJoinRetry();
        this.matchStarted = true;
        const guestName = String(msg.guestName || 'Komutan 2');
        const startPacket = {
          type: 'P2P_MATCH_START',
          code,
          team1Name: this.myName,
          team2Name: guestName,
        };
        conn.send(startPacket);
        this.myTeam = 1;
        this.callbacks.onMatchStart({
          team1Name: this.myName,
          team2Name: guestName,
          myTeam: 1,
          roomCode: code,
        });
      } else if (msg.type === 'P2P_MATCH_START' && !isHost) {
        this.clearJoinRetry();
        this.matchStarted = true;
        this.myTeam = 2;
        this.callbacks.onMatchStart({
          team1Name: String(msg.team1Name || 'Komutan 1'),
          team2Name: this.myName,
          myTeam: 2,
          roomCode: code,
        });
      } else if (msg.type === 'P2P_COMMAND') {
        const cmdId = String(msg.cmdId || '');
        if (cmdId && this.processedCmdIds.has(cmdId)) return;
        if (cmdId) this.processedCmdIds.add(cmdId);
        const command = msg.command as BattleActionCommand;
        if (command && command.team !== this.myTeam) {
          this.callbacks.onRemoteCommand(command);
        }
      }
    });
  }

  private handleBusPacket(msg: Record<string, unknown>): void {
    if (!msg || typeof msg !== 'object') return;
    if (
      msg.type === 'BC_JOIN_REQUEST' &&
      this.myTeam === 1 &&
      this.currentCode &&
      msg.code === this.currentCode
    ) {
      this.clearJoinRetry();
      this.matchStarted = true;
      const guestName = String(msg.guestName || 'Komutan 2');
      this.bc?.postMessage({
        type: 'BC_MATCH_START',
        code: this.currentCode,
        team1Name: this.myName,
        team2Name: guestName,
      });
      this.callbacks.onMatchStart({
        team1Name: this.myName,
        team2Name: guestName,
        myTeam: 1,
        roomCode: this.currentCode,
      });
    } else if (
      msg.type === 'BC_MATCH_START' &&
      this.myTeam === 2 &&
      this.currentCode &&
      msg.code === this.currentCode
    ) {
      this.clearJoinRetry();
      this.matchStarted = true;
      this.callbacks.onMatchStart({
        team1Name: String(msg.team1Name || 'Komutan 1'),
        team2Name: this.myName,
        myTeam: 2,
        roomCode: this.currentCode,
      });
    } else if (msg.type === 'BC_COMMAND' && msg.code === this.currentCode) {
      const cmdId = String(msg.cmdId || '');
      if (cmdId && this.processedCmdIds.has(cmdId)) return;
      if (cmdId) this.processedCmdIds.add(cmdId);
      const command = msg.command as BattleActionCommand;
      if (command && command.team !== this.myTeam) {
        this.callbacks.onRemoteCommand(command);
      }
    }
  }

  public sendBattleCommand(cmd: BattleActionCommand): void {
    const cmdId = `${this.clientId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.processedCmdIds.add(cmdId);

    if (this.conn && this.conn.open) {
      this.conn.send({
        type: 'P2P_COMMAND',
        cmdId,
        command: cmd,
      });
    }

    if (this.bc && this.currentCode) {
      this.bc.postMessage({
        type: 'BC_COMMAND',
        code: this.currentCode,
        cmdId,
        command: cmd,
      });
    }
  }

  public dispose(): void {
    this.destroyPeer();
    this.bc?.close();
  }
}
