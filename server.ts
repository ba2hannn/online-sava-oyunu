import express from 'express';
import { createServer as createHttpServer } from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import { gameDb } from './server/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface RoomPlayer {
  id: string;
  name: string;
  team: 1 | 2;
  ws: WebSocket;
  ready: boolean;
  connectedAt: number;
}

interface GameRoom {
  code: string;
  title: string;
  hostName: string;
  guestName?: string;
  status: 'waiting' | 'playing' | 'finished';
  isPrivate: boolean;
  players: RoomPlayer[];
  createdAt: number;
  startedAt?: number;
  lastSnapshot?: unknown;
  lastSnapshotTime?: number;
  disconnectTimer?: NodeJS.Timeout | null;
  commandHistory: Array<{ id: string; team: 1 | 2; command: unknown; ts: number }>;
  processedCommandIds: Set<string>;
}

const rooms = new Map<string, GameRoom>();
const lobbySockets = new Set<WebSocket>();

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return rooms.has(code) ? generateRoomCode() : code;
}

function broadcastToLobby(payload: unknown) {
  const msg = JSON.stringify(payload);
  for (const ws of lobbySockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

function broadcastToRoom(room: GameRoom, payload: unknown, excludeWs?: WebSocket) {
  const msg = JSON.stringify(payload);
  for (const p of room.players) {
    if (p.ws !== excludeWs && p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(msg);
    }
  }
}

function getPublicRoomList() {
  const list: Array<{
    code: string;
    hostName: string;
    title: string;
    playerCount: number;
    status: string;
    createdAt: number;
  }> = [];

  for (const room of rooms.values()) {
    if (!room.isPrivate && room.status !== 'finished') {
      list.push({
        code: room.code,
        hostName: room.hostName,
        title: room.title || `${room.hostName}'in Odası`,
        playerCount: room.players.length,
        status: room.status,
        createdAt: room.createdAt,
      });
    }
  }

  // Also merge any DB rooms if needed, prioritizing active memory rooms
  return list.sort((a, b) => b.createdAt - a.createdAt).slice(0, 30);
}

async function startServer() {
  const app = express();
  const httpServer = createHttpServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  app.use(express.json());

  // CORS headers for flexible web access
  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
  });

  // REST API Endpoints
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'caglar-boyu-savas-online',
      version: '2.0.0',
      uptime: process.uptime(),
      timestamp: Date.now(),
      activeRooms: rooms.size,
      connectedLobby: lobbySockets.size,
    });
  });

  app.get('/api/lobby-stats', (_req, res) => {
    const dbStats = gameDb.getSystemStats();
    res.json({
      activeRooms: rooms.size,
      openRooms: getPublicRoomList(),
      totalMatches: dbStats.totalMatches,
      totalCommanders: dbStats.totalCommanders,
    });
  });

  app.get('/api/rooms', (_req, res) => {
    res.json({
      rooms: getPublicRoomList(),
    });
  });

  app.get('/api/leaderboard', (_req, res) => {
    res.json({
      leaderboard: gameDb.getLeaderboard(25),
    });
  });

  app.get('/api/recent-matches', (_req, res) => {
    res.json({
      matches: gameDb.getRecentMatches(15),
    });
  });

  // WebSocket Connection Handling
  wss.on('connection', (ws) => {
    const clientId = `cmd_${Math.random().toString(36).slice(2, 10)}`;
    let currentRoomCode: string | null = null;
    lobbySockets.add(ws);

    // Welcome payload with initial synchronized state
    ws.send(
      JSON.stringify({
        type: 'WELCOME',
        clientId,
        serverTime: Date.now(),
        openRooms: getPublicRoomList(),
        leaderboard: gameDb.getLeaderboard(10),
      })
    );

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString());

        // Heartbeat Latency Tracking
        if (data.type === 'PING') {
          ws.send(
            JSON.stringify({
              type: 'PONG',
              clientTs: data.clientTs,
              serverTs: Date.now(),
            })
          );
          return;
        }

        // Room Browsing
        if (data.type === 'LIST_ROOMS') {
          ws.send(
            JSON.stringify({
              type: 'ROOM_LIST',
              openRooms: getPublicRoomList(),
            })
          );
          return;
        }

        // Leaderboard Request
        if (data.type === 'GET_LEADERBOARD') {
          ws.send(
            JSON.stringify({
              type: 'LEADERBOARD',
              leaderboard: gameDb.getLeaderboard(25),
            })
          );
          return;
        }

        // Create Room
        if (data.type === 'CREATE_ROOM') {
          const code = (data.code && String(data.code).trim().length >= 3)
            ? String(data.code).trim().toUpperCase().slice(0, 8)
            : generateRoomCode();

          if (rooms.has(code)) {
            ws.send(
              JSON.stringify({
                type: 'ERROR',
                message: 'Bu oda kodu zaten kullanımda. Başka bir kod deneyin.',
              })
            );
            return;
          }

          const playerName = String(data.playerName || 'Komutan 1').trim().slice(0, 24);
          const roomTitle = String(data.title || `${playerName}'in Karargahı`).trim().slice(0, 36);
          const isPrivate = Boolean(data.isPrivate);

          const player: RoomPlayer = {
            id: clientId,
            name: playerName,
            team: 1,
            ws,
            ready: true,
            connectedAt: Date.now(),
          };

          const room: GameRoom = {
            code,
            title: roomTitle,
            hostName: playerName,
            status: 'waiting',
            isPrivate,
            players: [player],
            createdAt: Date.now(),
            commandHistory: [],
            processedCommandIds: new Set(),
          };

          rooms.set(code, room);
          currentRoomCode = code;
          lobbySockets.delete(ws);

          gameDb.upsertRoom({
            code,
            hostName: playerName,
            title: roomTitle,
            isPrivate,
          });

          ws.send(
            JSON.stringify({
              type: 'ROOM_JOINED',
              code,
              team: 1,
              title: roomTitle,
              hostName: playerName,
              players: room.players.map((p) => ({
                id: p.id,
                name: p.name,
                team: p.team,
              })),
              status: room.status,
            })
          );

          broadcastToLobby({
            type: 'ROOM_LIST',
            openRooms: getPublicRoomList(),
          });
          return;
        }

        // Join Room
        if (data.type === 'JOIN_ROOM') {
          const code = String(data.code || '')
            .trim()
            .toUpperCase();
          const room = rooms.get(code);

          if (!room) {
            ws.send(
              JSON.stringify({
                type: 'ERROR',
                message: 'Oda bulunamadı. Lütfen oda kodunu kontrol edin.',
              })
            );
            return;
          }

          // Reconnect check
          const existing = room.players.find((p) => p.id === clientId || p.name === data.playerName);
          if (existing) {
            existing.ws = ws;
            currentRoomCode = code;
            lobbySockets.delete(ws);

            if (room.disconnectTimer) {
              clearTimeout(room.disconnectTimer);
              room.disconnectTimer = null;
            }

            ws.send(
              JSON.stringify({
                type: 'ROOM_SYNC',
                code: room.code,
                team: existing.team,
                status: room.status,
                lastSnapshot: room.lastSnapshot,
                commandHistory: room.commandHistory,
              })
            );

            broadcastToRoom(room, {
              type: 'CHAT_MESSAGE',
              sender: 'Sistem',
              text: `${existing.name} savaşa yeniden bağlandı!`,
              isSystem: true,
            });
            return;
          }

          if (room.players.length >= 2) {
            ws.send(
              JSON.stringify({
                type: 'ERROR',
                message: 'Bu oda dolu! Yeni bir oda oluşturabilir veya başka bir odaya katılabilirsiniz.',
              })
            );
            return;
          }

          const guestName = String(data.playerName || 'Komutan 2').trim().slice(0, 24);
          const guestPlayer: RoomPlayer = {
            id: clientId,
            name: guestName,
            team: 2,
            ws,
            ready: true,
            connectedAt: Date.now(),
          };

          room.guestName = guestName;
          room.players.push(guestPlayer);
          room.status = 'playing';
          room.startedAt = Date.now();
          currentRoomCode = code;
          lobbySockets.delete(ws);

          gameDb.setRoomGuest(code, guestName);

          // Notify guest
          ws.send(
            JSON.stringify({
              type: 'ROOM_JOINED',
              code,
              team: 2,
              title: room.title,
              hostName: room.hostName,
              guestName,
              players: room.players.map((p) => ({
                id: p.id,
                name: p.name,
                team: p.team,
              })),
              status: room.status,
            })
          );

          // Start the match synchronously for both players
          const startTimestamp = Date.now() + 300; // 300ms countdown synchronizer
          broadcastToRoom(room, {
            type: 'MATCH_START',
            code: room.code,
            startTime: startTimestamp,
            players: room.players.map((p) => ({
              id: p.id,
              name: p.name,
              team: p.team,
            })),
          });

          broadcastToLobby({
            type: 'ROOM_LIST',
            openRooms: getPublicRoomList(),
          });
          return;
        }

        // Quick Match
        if (data.type === 'QUICK_MATCH') {
          const playerName = String(data.playerName || 'Savaşçı').trim().slice(0, 24);

          // Find open waiting room
          let openRoom: GameRoom | undefined;
          for (const r of rooms.values()) {
            if (
              !r.isPrivate &&
              r.status === 'waiting' &&
              r.players.length === 1 &&
              r.players[0].ws.readyState === WebSocket.OPEN
            ) {
              openRoom = r;
              break;
            }
          }

          if (openRoom) {
            const guestPlayer: RoomPlayer = {
              id: clientId,
              name: playerName,
              team: 2,
              ws,
              ready: true,
              connectedAt: Date.now(),
            };

            openRoom.guestName = playerName;
            openRoom.players.push(guestPlayer);
            openRoom.status = 'playing';
            openRoom.startedAt = Date.now();
            currentRoomCode = openRoom.code;
            lobbySockets.delete(ws);

            gameDb.setRoomGuest(openRoom.code, playerName);

            ws.send(
              JSON.stringify({
                type: 'ROOM_JOINED',
                code: openRoom.code,
                team: 2,
                title: openRoom.title,
                hostName: openRoom.hostName,
                guestName: playerName,
                players: openRoom.players.map((p) => ({
                  id: p.id,
                  name: p.name,
                  team: p.team,
                })),
                status: 'playing',
              })
            );

            const startTimestamp = Date.now() + 300;
            broadcastToRoom(openRoom, {
              type: 'MATCH_START',
              code: openRoom.code,
              startTime: startTimestamp,
              players: openRoom.players.map((p) => ({
                id: p.id,
                name: p.name,
                team: p.team,
              })),
            });

            broadcastToLobby({
              type: 'ROOM_LIST',
              openRooms: getPublicRoomList(),
            });
          } else {
            // Create a new waiting room
            const code = generateRoomCode();
            const player: RoomPlayer = {
              id: clientId,
              name: playerName,
              team: 1,
              ws,
              ready: true,
              connectedAt: Date.now(),
            };

            const room: GameRoom = {
              code,
              title: `${playerName}'in Hızlı Arenası`,
              hostName: playerName,
              status: 'waiting',
              isPrivate: false,
              players: [player],
              createdAt: Date.now(),
              commandHistory: [],
              processedCommandIds: new Set(),
            };

            rooms.set(code, room);
            currentRoomCode = code;
            lobbySockets.delete(ws);

            gameDb.upsertRoom({
              code,
              hostName: playerName,
              title: room.title,
              isPrivate: false,
            });

            ws.send(
              JSON.stringify({
                type: 'ROOM_JOINED',
                code,
                team: 1,
                title: room.title,
                hostName: playerName,
                players: [{ id: player.id, name: player.name, team: 1 }],
                status: 'waiting',
              })
            );

            broadcastToLobby({
              type: 'ROOM_LIST',
              openRooms: getPublicRoomList(),
            });
          }
          return;
        }

        // Authoritative Battle Command Relay
        if (data.type === 'BATTLE_COMMAND' && currentRoomCode) {
          const room = rooms.get(currentRoomCode);
          if (!room || room.status !== 'playing') return;

          const cmdId = String(data.cmdId || `${clientId}_${Date.now()}_${Math.random()}`);
          if (room.processedCommandIds.has(cmdId)) return;
          room.processedCommandIds.add(cmdId);

          const entry = {
            id: cmdId,
            team: data.team as 1 | 2,
            command: data.command,
            ts: Date.now(),
          };
          room.commandHistory.push(entry);

          // Relay to both (or to the other player) with authoritative server timestamp
          broadcastToRoom(room, {
            type: 'REMOTE_BATTLE_COMMAND',
            cmdId,
            senderId: clientId,
            team: data.team,
            command: data.command,
            serverTs: entry.ts,
          }, ws);
          return;
        }

        // Authoritative State Snapshot (Host -> Guest with zero desync)
        if (data.type === 'STATE_SNAPSHOT' && currentRoomCode) {
          const room = rooms.get(currentRoomCode);
          if (!room || room.status !== 'playing') return;

          room.lastSnapshot = data.snapshot;
          room.lastSnapshotTime = Date.now();

          // Relay authoritative snapshot to Guest / Spectators
          broadcastToRoom(
            room,
            {
              type: 'STATE_SNAPSHOT',
              snapshot: data.snapshot,
              serverTs: Date.now(),
            },
            ws
          );
          return;
        }

        // Match Finish Recording
        if (data.type === 'MATCH_FINISH' && currentRoomCode) {
          const room = rooms.get(currentRoomCode);
          if (!room || room.status === 'finished') return;

          room.status = 'finished';
          const winnerTeam = Number(data.winnerTeam) || 1;
          const winnerPlayer = room.players.find((p) => p.team === winnerTeam);
          const winnerName = winnerPlayer?.name || (winnerTeam === 1 ? room.hostName : (room.guestName || 'Bilinmeyen'));

          const durationSeconds = room.startedAt
            ? Math.max(1, (Date.now() - room.startedAt) / 1000)
            : Number(data.durationSeconds) || 60;

          gameDb.recordMatchResult({
            roomCode: room.code,
            player1Name: room.hostName,
            player2Name: room.guestName || 'Misafir Komutan',
            winnerTeam,
            winnerName,
            durationSeconds,
            player1Era: Number(data.t1Era) || 0,
            player2Era: Number(data.t2Era) || 0,
            totalUnits: Number(data.totalUnits) || 0,
          });

          broadcastToRoom(room, {
            type: 'MATCH_OVER',
            winnerTeam,
            winnerName,
            durationSeconds,
          });

          broadcastToLobby({
            type: 'ROOM_LIST',
            openRooms: getPublicRoomList(),
          });
          return;
        }

        // In-Room Chat / Tactical Emotes
        if (data.type === 'CHAT_MESSAGE' && currentRoomCode) {
          const room = rooms.get(currentRoomCode);
          if (!room) return;
          const sender = room.players.find((p) => p.id === clientId)?.name || 'Komutan';
          const text = String(data.text || '').trim().slice(0, 120);
          if (!text) return;

          broadcastToRoom(room, {
            type: 'CHAT_MESSAGE',
            sender,
            text,
            isSystem: false,
            timestamp: Date.now(),
          });
          return;
        }

        // Leave Room
        if (data.type === 'LEAVE_ROOM' && currentRoomCode) {
          handlePlayerLeave(currentRoomCode, clientId);
          currentRoomCode = null;
          lobbySockets.add(ws);
        }
      } catch (err) {
        // Silently ignore or log malformed packet
      }
    });

    ws.on('close', () => {
      lobbySockets.delete(ws);
      if (currentRoomCode) {
        handlePlayerLeave(currentRoomCode, clientId);
      }
    });
  });

  function handlePlayerLeave(roomCode: string, clientId: string) {
    const room = rooms.get(roomCode);
    if (!room) return;

    const leavingPlayer = room.players.find((p) => p.id === clientId);
    room.players = room.players.filter((p) => p.id !== clientId);

    if (room.players.length === 0) {
      gameDb.closeRoom(roomCode);
      rooms.delete(roomCode);
    } else {
      broadcastToRoom(room, {
        type: 'PLAYER_LEFT',
        leftPlayerId: clientId,
        leftPlayerName: leavingPlayer?.name,
      });

      // If playing and a player left, grace period before auto-win
      if (room.status === 'playing') {
        const remaining = room.players[0];
        room.disconnectTimer = setTimeout(() => {
          if (room.status === 'playing' && room.players.length === 1) {
            room.status = 'finished';
            gameDb.recordMatchResult({
              roomCode: room.code,
              player1Name: room.hostName,
              player2Name: room.guestName || 'Rakip',
              winnerTeam: remaining.team,
              winnerName: remaining.name,
              durationSeconds: room.startedAt ? (Date.now() - room.startedAt) / 1000 : 30,
            });
            broadcastToRoom(room, {
              type: 'MATCH_OVER',
              winnerTeam: remaining.team,
              winnerName: remaining.name,
              reason: 'Rakip oyundan ayrıldı.',
            });
          }
        }, 15000);
      }
    }

    broadcastToLobby({
      type: 'ROOM_LIST',
      openRooms: getPublicRoomList(),
    });
  }

  // Vite Development / Production static serving
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = fs.existsSync(path.join(process.cwd(), 'dist'))
      ? path.join(process.cwd(), 'dist')
      : path.resolve(__dirname, '..', 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[Çağlar Boyu Savaş Online] Sunucu http://0.0.0.0:${PORT} adresinde aktif.`);
  });
}

startServer();
