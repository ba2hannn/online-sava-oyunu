import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export interface RoomRecord {
  code: string;
  host_name: string;
  guest_name?: string | null;
  title: string;
  status: 'waiting' | 'playing' | 'finished';
  is_private: number;
  winner_team?: number | null;
  winner_name?: string | null;
  created_at: number;
  started_at?: number | null;
  finished_at?: number | null;
}

export interface MatchRecord {
  id?: number;
  room_code: string;
  player1_name: string;
  player2_name: string;
  winner_team: number;
  winner_name: string;
  duration_seconds: number;
  player1_era: number;
  player2_era: number;
  total_units: number;
  ended_at: number;
}

export interface CommanderRecord {
  name: string;
  wins: number;
  losses: number;
  total_matches: number;
  total_kills: number;
  last_seen: number;
}

export class GameDatabase {
  private db: Database.Database;

  constructor(customPath?: string) {
    const dataDir = customPath
      ? path.dirname(customPath)
      : path.join(process.cwd(), 'data');

    if (!fs.existsSync(dataDir)) {
      try {
        fs.mkdirSync(dataDir, { recursive: true });
      } catch {
        // Ignore if directory already exists
      }
    }

    const dbPath = customPath || path.join(dataDir, 'cbs_game.db');
    this.db = new Database(dbPath);

    // High concurrency tuning for real-time game
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('busy_timeout = 5000');

    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        code TEXT PRIMARY KEY,
        host_name TEXT NOT NULL,
        guest_name TEXT,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'waiting',
        is_private INTEGER NOT NULL DEFAULT 0,
        winner_team INTEGER,
        winner_name TEXT,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        finished_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);
      CREATE INDEX IF NOT EXISTS idx_rooms_created ON rooms(created_at DESC);

      CREATE TABLE IF NOT EXISTS matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_code TEXT NOT NULL,
        player1_name TEXT NOT NULL,
        player2_name TEXT NOT NULL,
        winner_team INTEGER NOT NULL,
        winner_name TEXT NOT NULL,
        duration_seconds INTEGER NOT NULL,
        player1_era INTEGER DEFAULT 0,
        player2_era INTEGER DEFAULT 0,
        total_units INTEGER DEFAULT 0,
        ended_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_matches_ended ON matches(ended_at DESC);

      CREATE TABLE IF NOT EXISTS commanders (
        name TEXT PRIMARY KEY,
        wins INTEGER DEFAULT 0,
        losses INTEGER DEFAULT 0,
        total_matches INTEGER DEFAULT 0,
        total_kills INTEGER DEFAULT 0,
        last_seen INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_commanders_wins ON commanders(wins DESC, total_matches DESC);
    `);
  }

  public upsertRoom(room: {
    code: string;
    hostName: string;
    title?: string;
    isPrivate?: boolean;
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO rooms (code, host_name, title, status, is_private, created_at)
      VALUES (@code, @host_name, @title, 'waiting', @is_private, @created_at)
      ON CONFLICT(code) DO UPDATE SET
        host_name = @host_name,
        title = @title,
        status = 'waiting',
        is_private = @is_private
    `);

    stmt.run({
      code: room.code,
      host_name: room.hostName,
      title: room.title || `${room.hostName}'in Odası`,
      is_private: room.isPrivate ? 1 : 0,
      created_at: Date.now(),
    });
  }

  public setRoomGuest(code: string, guestName: string): void {
    const stmt = this.db.prepare(`
      UPDATE rooms
      SET guest_name = ?, status = 'playing', started_at = ?
      WHERE code = ?
    `);
    stmt.run(guestName, Date.now(), code);
  }

  public finishRoom(
    code: string,
    winnerTeam: number,
    winnerName: string
  ): void {
    const stmt = this.db.prepare(`
      UPDATE rooms
      SET status = 'finished', winner_team = ?, winner_name = ?, finished_at = ?
      WHERE code = ?
    `);
    stmt.run(winnerTeam, winnerName, Date.now(), code);
  }

  public closeRoom(code: string): void {
    const stmt = this.db.prepare(`
      UPDATE rooms SET status = 'finished', finished_at = ? WHERE code = ? AND status != 'finished'
    `);
    stmt.run(Date.now(), code);
  }

  public getOpenRooms(limit = 30): Array<{
    code: string;
    hostName: string;
    title: string;
    playerCount: number;
    status: string;
    createdAt: number;
  }> {
    const stmt = this.db.prepare(`
      SELECT code, host_name as hostName, title,
             CASE WHEN guest_name IS NOT NULL THEN 2 ELSE 1 END as playerCount,
             status, created_at as createdAt
      FROM rooms
      WHERE is_private = 0 AND (status = 'waiting' OR status = 'playing')
      ORDER BY status DESC, created_at DESC
      LIMIT ?
    `);
    return stmt.all(limit) as Array<{
      code: string;
      hostName: string;
      title: string;
      playerCount: number;
      status: string;
      createdAt: number;
    }>;
  }

  public getRoom(code: string): RoomRecord | undefined {
    const stmt = this.db.prepare(`SELECT * FROM rooms WHERE code = ?`);
    return stmt.get(code) as RoomRecord | undefined;
  }

  public recordMatchResult(data: {
    roomCode: string;
    player1Name: string;
    player2Name: string;
    winnerTeam: number;
    winnerName: string;
    durationSeconds: number;
    player1Era?: number;
    player2Era?: number;
    totalUnits?: number;
  }): void {
    const insertMatch = this.db.prepare(`
      INSERT INTO matches (
        room_code, player1_name, player2_name, winner_team, winner_name,
        duration_seconds, player1_era, player2_era, total_units, ended_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const now = Date.now();
    insertMatch.run(
      data.roomCode,
      data.player1Name,
      data.player2Name,
      data.winnerTeam,
      data.winnerName,
      Math.max(1, Math.round(data.durationSeconds)),
      data.player1Era ?? 0,
      data.player2Era ?? 0,
      data.totalUnits ?? 0,
      now
    );

    this.finishRoom(data.roomCode, data.winnerTeam, data.winnerName);

    // Update player commander records
    this.updateCommander(data.player1Name, data.winnerTeam === 1, data.totalUnits ?? 0);
    this.updateCommander(data.player2Name, data.winnerTeam === 2, data.totalUnits ?? 0);
  }

  private updateCommander(name: string, won: boolean, units: number): void {
    if (!name || name.trim().length === 0) return;
    const cleanName = name.trim().slice(0, 32);

    const stmt = this.db.prepare(`
      INSERT INTO commanders (name, wins, losses, total_matches, total_kills, last_seen)
      VALUES (@name, @wins, @losses, 1, @kills, @last_seen)
      ON CONFLICT(name) DO UPDATE SET
        wins = wins + @wins,
        losses = losses + @losses,
        total_matches = total_matches + 1,
        total_kills = total_kills + @kills,
        last_seen = @last_seen
    `);

    stmt.run({
      name: cleanName,
      wins: won ? 1 : 0,
      losses: won ? 0 : 1,
      kills: Math.round(units / 2),
      last_seen: Date.now(),
    });
  }

  public getLeaderboard(limit = 20): Array<{
    name: string;
    wins: number;
    losses: number;
    totalMatches: number;
    winRate: number;
  }> {
    const stmt = this.db.prepare(`
      SELECT name, wins, losses, total_matches as totalMatches,
             ROUND(CASE WHEN total_matches > 0 THEN (wins * 100.0 / total_matches) ELSE 0 END, 1) as winRate
      FROM commanders
      WHERE total_matches > 0
      ORDER BY wins DESC, winRate DESC, total_matches DESC
      LIMIT ?
    `);
    return stmt.all(limit) as Array<{
      name: string;
      wins: number;
      losses: number;
      totalMatches: number;
      winRate: number;
    }>;
  }

  public getRecentMatches(limit = 10): Array<{
    id: number;
    roomCode: string;
    player1Name: string;
    player2Name: string;
    winnerTeam: number;
    winnerName: string;
    durationSeconds: number;
    endedAt: number;
  }> {
    const stmt = this.db.prepare(`
      SELECT id, room_code as roomCode, player1_name as player1Name,
             player2_name as player2Name, winner_team as winnerTeam,
             winner_name as winnerName, duration_seconds as durationSeconds,
             ended_at as endedAt
      FROM matches
      ORDER BY ended_at DESC
      LIMIT ?
    `);
    return stmt.all(limit) as Array<{
      id: number;
      roomCode: string;
      player1Name: string;
      player2Name: string;
      winnerTeam: number;
      winnerName: string;
      durationSeconds: number;
      endedAt: number;
    }>;
  }

  public getSystemStats(): {
    totalMatches: number;
    totalCommanders: number;
    activeRooms: number;
  } {
    const matchCount = (this.db.prepare(`SELECT COUNT(*) as c FROM matches`).get() as { c: number }).c;
    const commanderCount = (this.db.prepare(`SELECT COUNT(*) as c FROM commanders`).get() as { c: number }).c;
    const activeRooms = (this.db.prepare(`SELECT COUNT(*) as c FROM rooms WHERE status = 'waiting' OR status = 'playing'`).get() as { c: number }).c;

    return {
      totalMatches: matchCount,
      totalCommanders: commanderCount,
      activeRooms,
    };
  }

  public close(): void {
    this.db.close();
  }
}

export const gameDb = new GameDatabase();
