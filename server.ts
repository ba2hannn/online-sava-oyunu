import express from 'express';
import { createServer as createHttpServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface RoomPlayer {
  id: string;
  name: string;
  team: 1 | 2;
  ws: WebSocket;
  ready: boolean;
}

interface GameRoom {
  code: string;
  hostName: string;
  status: 'waiting' | 'playing' | 'finished';
  players: RoomPlayer[];
  createdAt: number;
  commandHistory: Array<{ id: string; team: 1 | 2; command: unknown; ts: number }>;
  processedCommandIds: Set<string>;
}

const rooms = new Map<string, GameRoom>();
const waitingQueue: RoomPlayer[] = [];

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return rooms.has(code) ? generateRoomCode() : code;
}

function broadcastToRoom(room: GameRoom, payload: unknown) {
  const msg = JSON.stringify(payload);
  for (const p of room.players) {
    if (p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(msg);
    }
  }
}

function getPublicRoomList() {
  const list: Array<{
    code: string;
    hostName: string;
    playerCount: number;
    status: string;
  }> = [];
  for (const room of rooms.values()) {
    if (room.status === 'waiting' && room.players.length === 1) {
      list.push({
        code: room.code,
        hostName: room.hostName,
        playerCount: room.players.length,
        status: room.status,
      });
    }
  }
  return list.slice(0, 10);
}

async function startServer() {
  const app = express();
  const httpServer = createHttpServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  app.use(express.json());

  app.get('/api/lobby-stats', (_req, res) => {
    res.json({
      activeRooms: rooms.size,
      openRooms: getPublicRoomList(),
      waitingPlayers: waitingQueue.length,
    });
  });

  wss.on('connection', (ws) => {
    let clientId = `cmd_${Math.random().toString(36).slice(2, 10)}`;
    let currentRoomCode: string | null = null;

    ws.send(
      JSON.stringify({
        type: 'WELCOME',
        clientId,
        openRooms: getPublicRoomList(),
      })
    );

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString());

        if (data.type === 'LIST_ROOMS') {
          ws.send(
            JSON.stringify({
              type: 'ROOM_LIST',
              openRooms: getPublicRoomList(),
            })
          );
          return;
        }

        if (data.type === 'CREATE_ROOM') {
          const code = generateRoomCode();
          const playerName = (data.playerName || 'Komutan 1').slice(0, 24);
          const player: RoomPlayer = {
            id: clientId,
            name: playerName,
            team: 1,
            ws,
            ready: true,
          };
          const room: GameRoom = {
            code,
            hostName: playerName,
            status: 'waiting',
            players: [player],
            createdAt: Date.now(),
            commandHistory: [],
            processedCommandIds: new Set(),
          };
          rooms.set(code, room);
          currentRoomCode = code;

          ws.send(
            JSON.stringify({
              type: 'ROOM_JOINED',
              code,
              team: 1,
              players: room.players.map((p) => ({
                id: p.id,
                name: p.name,
                team: p.team,
              })),
              status: room.status,
            })
          );
          return;
        }

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
          const existing = room.players.find((p) => p.id === clientId);
          if (existing) {
            existing.ws = ws;
            currentRoomCode = code;
            ws.send(
              JSON.stringify({
                type: 'ROOM_SYNC',
                code: room.code,
                team: existing.team,
                status: room.status,
                commandHistory: room.commandHistory,
              })
            );
            return;
          }

          if (room.players.length >= 2) {
            ws.send(
              JSON.stringify({
                type: 'ERROR',
                message: 'Bu oda dolu (2/2 Komutan).',
              })
            );
            return;
          }

          const playerName = (data.playerName || 'Komutan 2').slice(0, 24);
          const player: RoomPlayer = {
            id: clientId,
            name: playerName,
            team: 2,
            ws,
            ready: true,
          };
          room.players.push(player);
          room.status = 'playing';
          currentRoomCode = code;

          broadcastToRoom(room, {
            type: 'MATCH_START',
            code: room.code,
            players: room.players.map((p) => ({
              id: p.id,
              name: p.name,
              team: p.team,
            })),
          });
          return;
        }

        if (data.type === 'QUICK_MATCH') {
          const playerName = (data.playerName || 'Savaşçı').slice(0, 24);
          // Find any open waiting room first
          let openRoom: GameRoom | undefined;
          for (const r of rooms.values()) {
            if (r.status === 'waiting' && r.players.length === 1 && r.players[0].ws.readyState === WebSocket.OPEN) {
              openRoom = r;
              break;
            }
          }

          if (openRoom) {
            const player: RoomPlayer = {
              id: clientId,
              name: playerName,
              team: 2,
              ws,
              ready: true,
            };
            openRoom.players.push(player);
            openRoom.status = 'playing';
            currentRoomCode = openRoom.code;

            broadcastToRoom(openRoom, {
              type: 'MATCH_START',
              code: openRoom.code,
              players: openRoom.players.map((p) => ({
                id: p.id,
                name: p.name,
                team: p.team,
              })),
            });
          } else {
            // Create a new room waiting for opponent
            const code = generateRoomCode();
            const player: RoomPlayer = {
              id: clientId,
              name: playerName,
              team: 1,
              ws,
              ready: true,
            };
            const room: GameRoom = {
              code,
              hostName: playerName,
              status: 'waiting',
              players: [player],
              createdAt: Date.now(),
              commandHistory: [],
              processedCommandIds: new Set(),
            };
            rooms.set(code, room);
            currentRoomCode = code;

            ws.send(
              JSON.stringify({
                type: 'ROOM_JOINED',
                code,
                team: 1,
                players: [{ id: player.id, name: player.name, team: 1 }],
                status: 'waiting',
              })
            );
          }
          return;
        }

        if (data.type === 'BATTLE_COMMAND' && currentRoomCode) {
          const room = rooms.get(currentRoomCode);
          if (!room) return;
          const cmdId = String(data.cmdId || `${clientId}_${Date.now()}_${Math.random()}`);
          // Idempotency guard
          if (room.processedCommandIds.has(cmdId)) return;
          room.processedCommandIds.add(cmdId);

          const entry = {
            id: cmdId,
            team: data.team as 1 | 2,
            command: data.command,
            ts: Date.now(),
          };
          room.commandHistory.push(entry);

          broadcastToRoom(room, {
            type: 'REMOTE_BATTLE_COMMAND',
            cmdId,
            senderId: clientId,
            team: data.team,
            command: data.command,
          });
          return;
        }

        if (data.type === 'LEAVE_ROOM' && currentRoomCode) {
          const room = rooms.get(currentRoomCode);
          if (room) {
            room.players = room.players.filter((p) => p.id !== clientId);
            if (room.players.length === 0) {
              rooms.delete(currentRoomCode);
            } else {
              broadcastToRoom(room, {
                type: 'PLAYER_LEFT',
                leftPlayerId: clientId,
              });
            }
          }
          currentRoomCode = null;
        }
      } catch {
        // Ignore malformed packets
      }
    });

    ws.on('close', () => {
      if (currentRoomCode) {
        const room = rooms.get(currentRoomCode);
        if (room) {
          room.players = room.players.filter((p) => p.id !== clientId);
          if (room.players.length === 0) {
            rooms.delete(currentRoomCode);
          } else {
            broadcastToRoom(room, {
              type: 'PLAYER_LEFT',
              leftPlayerId: clientId,
            });
          }
        }
      }
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Çağlar Boyu Savaş Online sunucusu http://0.0.0.0:${PORT} üzerinde aktif.`);
  });
}

startServer();
