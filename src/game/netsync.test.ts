import test from 'node:test';
import assert from 'node:assert/strict';
import { BattleSimulationEngine } from './engine';
import { getEraUnits } from './catalog';
import { compactNumberReplacer } from './network';
import { BattleActionCommand, RunSummarySnapshot, WorldSyncSnapshot } from './types';

/**
 * Simulates the online setup: host engine (team 1, authoritative) and guest engine (team 2,
 * replica) connected through a relay with latency. Messages are JSON round-tripped exactly
 * like over the WebSocket (snapshots use the same compacting replacer as network.ts).
 */
type Msg =
  | { kind: 'snapshot'; payload: string }
  | { kind: 'command'; payload: string };

class FakeRelay {
  private queue: Array<{ at: number; to: 'host' | 'guest'; msg: Msg; order: number }> = [];
  private order = 0;
  constructor(private latency: number, private jitter = 0, private rand: () => number = Math.random) {}

  send(to: 'host' | 'guest', msg: Msg, now: number): void {
    // Jitter only on snapshots lets us exercise out-of-order delivery of world state while
    // commands stay ordered (as on a single WebSocket, where nothing is reordered at all).
    const extra = msg.kind === 'snapshot' ? this.rand() * this.jitter : 0;
    this.queue.push({ at: now + this.latency + extra, to, msg, order: this.order++ });
  }

  deliver(now: number, to: 'host' | 'guest'): Msg[] {
    const due = this.queue.filter((m) => m.to === to && m.at <= now);
    this.queue = this.queue.filter((m) => !(m.to === to && m.at <= now));
    due.sort((a, b) => a.at - b.at || a.order - b.order);
    return due.map((m) => m.msg);
  }

  pending(): number {
    return this.queue.length;
  }
}

function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function createPair(latency = 0.08, jitter = 0) {
  let now = 0;
  const relay = new FakeRelay(latency, jitter, seededRandom(7));
  const guestSummaries: RunSummarySnapshot[] = [];
  const hostSummaries: RunSummarySnapshot[] = [];

  const host = new BattleSimulationEngine(
    undefined,
    (s) => hostSummaries.push(s),
    (snap) => {
      relay.send('guest', { kind: 'snapshot', payload: JSON.stringify(snap, compactNumberReplacer) }, now);
    }
  );
  const guest = new BattleSimulationEngine(undefined, (s) => guestSummaries.push(s));

  host.resetMatch('online', 'normal', 1, 'Ev Sahibi', 'Misafir');
  guest.resetMatch('online', 'normal', 2, 'Ev Sahibi', 'Misafir');
  host.lifecycle = 'playing';
  guest.lifecycle = 'playing';

  const sendCommand = (from: 'host' | 'guest', cmd: BattleActionCommand): boolean => {
    const eng = from === 'host' ? host : guest;
    const stamped = eng.issueLocalCommand(cmd);
    if (!stamped) return false;
    relay.send(from === 'host' ? 'guest' : 'host', { kind: 'command', payload: JSON.stringify(stamped) }, now);
    return true;
  };

  const tick = (dt: number, onGuestSnapshot?: (snap: WorldSyncSnapshot, applied: boolean) => void) => {
    now += dt;
    for (const msg of relay.deliver(now, 'host')) {
      if (msg.kind === 'command') host.applyRemoteCommand(JSON.parse(msg.payload));
    }
    for (const msg of relay.deliver(now, 'guest')) {
      if (msg.kind === 'command') {
        guest.applyRemoteCommand(JSON.parse(msg.payload));
      } else {
        const snap = JSON.parse(msg.payload) as WorldSyncSnapshot;
        const applied = guest.applyWorldSnapshot(snap);
        onGuestSnapshot?.(snap, applied);
      }
    }
    host.step(dt, 0);
    guest.step(dt, 0);
  };

  return { host, guest, relay, sendCommand, tick, now: () => now, guestSummaries, hostSummaries };
}

function liveUids(units: { uid: number; state: string }[]): number[] {
  return units.filter((u) => u.state !== 'ko').map((u) => u.uid).sort((a, b) => a - b);
}

test('co-op: both players keep the same set of units under latency, jitter and heavy spawning', () => {
  const { host, guest, relay, sendCommand, tick } = createPair(0.09, 0.25);
  // Plenty of gold on both sides so many units are on the field at once.
  host.team1.gold = 1_000_000;
  host.team2.gold = 1_000_000;
  host.team1.maxHp = host.team1.hp = 1_000_000;
  host.team2.maxHp = host.team2.hp = 1_000_000;

  const dt = 1 / 60;
  const era0 = getEraUnits(0);
  const uidOwner = new Map<number, string>(); // uid -> "team:defId" as created by the host
  const hostLife = new Map<number, { first: number; last: number }>();
  const seenOnGuest = new Set<number>();
  let guestCommandsAccepted = 0;
  let snapshotsApplied = 0;
  let staleRejected = 0;
  let lastSnapshotUids = new Set<number>();
  let t = 0;

  for (let frame = 0; frame < 60 * 30; frame++) {
    t += dt;
    if (frame % 25 === 0) {
      sendCommand('host', { type: 'SPAWN_UNIT', team: 1, defId: era0[frame % era0.length].id });
    }
    if (frame % 25 === 12) {
      if (sendCommand('guest', { type: 'SPAWN_UNIT', team: 2, defId: era0[(frame >> 2) % era0.length].id })) {
        guestCommandsAccepted++;
      }
    }

    tick(dt, (snap, applied) => {
      if (!applied) {
        staleRejected++;
        return;
      }
      snapshotsApplied++;
      lastSnapshotUids = new Set(snap.units.map((u) => u.uid));
      // Right after applying, the guest holds exactly the host's units: nothing extra, nothing missing.
      assert.deepEqual(
        guest.units.map((u) => u.uid).sort((a, b) => a - b),
        snap.units.map((u) => u.uid).sort((a, b) => a - b)
      );
    });

    for (const u of host.units) {
      const key = `${u.team}:${u.defId}`;
      const prevOwner = uidOwner.get(u.uid);
      if (prevOwner) assert.equal(prevOwner, key, `uid ${u.uid} reused for a different unit`);
      uidOwner.set(u.uid, key);
      const life = hostLife.get(u.uid);
      if (life) life.last = t;
      else hostLife.set(u.uid, { first: t, last: t });
    }
    // The guest never invents units: every uid it shows was minted by the host for the same unit.
    for (const u of guest.units) {
      assert.ok(lastSnapshotUids.has(u.uid), `guest unit ${u.uid} appeared without a host snapshot`);
      const owner = uidOwner.get(u.uid);
      assert.ok(owner, `guest shows unit uid ${u.uid} that the host never created`);
      assert.equal(owner, `${u.team}:${u.defId}`);
      seenOnGuest.add(u.uid);
    }
  }

  // Stop issuing commands and let everything in flight settle.
  for (let i = 0; i < 60 * 2; i++) tick(dt);
  assert.equal(relay.pending() < 4, true, 'relay drained (only the last few snapshots in flight)');

  assert.ok(snapshotsApplied > 200, `expected many snapshots, got ${snapshotsApplied}`);
  assert.ok(staleRejected > 0, 'jitter should have produced some out-of-order snapshots that were dropped');
  // The 5-slot training queue throttles orders, so not every attempt is accepted.
  assert.ok(guestCommandsAccepted > 10, `guest orders accepted: ${guestCommandsAccepted}`);
  assert.equal(host.team2.unitsSpawned + host.team2.queue.length, guestCommandsAccepted,
    'every guest order must reach the host exactly once');
  assert.equal(guest.getPendingCommandCount(), 0, 'all guest predictions acknowledged');

  // Every unit that lived on the host for a meaningful time was visible to the guest.
  for (const [uid, life] of hostLife) {
    if (life.last - life.first >= 0.4) {
      assert.ok(seenOnGuest.has(uid), `host unit ${uid} (${uidOwner.get(uid)}) never shown on guest`);
    }
  }

  // Final state: the latest snapshot leaves both sides with identical rosters and economies.
  const final = JSON.parse(JSON.stringify(host.exportWorldSnapshot(), compactNumberReplacer));
  assert.equal(guest.applyWorldSnapshot(final), true);
  assert.deepEqual(liveUids(guest.units), liveUids(host.units));
  assert.deepEqual(guest.team2.queue.map((q) => q.unitDefId), host.team2.queue.map((q) => q.unitDefId));
  assert.deepEqual(guest.team1.queue.map((q) => q.unitDefId), host.team1.queue.map((q) => q.unitDefId));
});

test('replica never spawns units from its own queue (no uid collisions)', () => {
  const { host, guest } = createPair();
  host.team2.gold = 10_000;
  guest.applyWorldSnapshot(host.exportWorldSnapshot());

  const defId = getEraUnits(0)[0].id;
  assert.ok(guest.issueLocalCommand({ type: 'SPAWN_UNIT', team: 2, defId }));
  for (let i = 0; i < 60 * 10; i++) guest.step(1 / 60, 0);

  assert.equal(guest.units.length, 0, 'replica must wait for the host to create the unit');
  assert.equal(guest.team2.queue.length, 1);
  assert.equal(guest.team2.queue[0].remainingTime, 0);
});

test('own commands survive snapshots generated before the host processed them', () => {
  const { host, guest } = createPair();
  host.team2.gold = 1_000;
  guest.applyWorldSnapshot(host.exportWorldSnapshot());

  const defId = getEraUnits(0)[1].id;
  const cmd = guest.issueLocalCommand({ type: 'SPAWN_UNIT', team: 2, defId });
  assert.ok(cmd && typeof cmd.seq === 'number');
  const goldAfterOrder = guest.team2.gold;

  // A snapshot taken before the host saw the order must not wipe the queued unit.
  assert.equal(guest.applyWorldSnapshot(host.exportWorldSnapshot()), true);
  assert.equal(guest.team2.queue.length, 1);
  assert.equal(guest.team2.gold, goldAfterOrder);
  assert.equal(guest.getPendingCommandCount(), 1);

  // Once the host applies it, the order is acknowledged and not double-counted.
  host.applyRemoteCommand(cmd!);
  assert.equal(guest.applyWorldSnapshot(host.exportWorldSnapshot()), true);
  assert.equal(guest.team2.queue.length, 1);
  assert.equal(guest.getPendingCommandCount(), 0);
});

test('lost guest commands are eventually dropped instead of predicted forever', () => {
  const { host, guest } = createPair();
  host.team2.gold = 1_000;
  guest.applyWorldSnapshot(host.exportWorldSnapshot());
  assert.ok(guest.issueLocalCommand({ type: 'SPAWN_UNIT', team: 2, defId: getEraUnits(0)[0].id }));
  for (let i = 0; i < 40; i++) guest.applyWorldSnapshot(host.exportWorldSnapshot());
  assert.equal(guest.getPendingCommandCount(), 0);
  assert.equal(guest.team2.queue.length, 0, 'host never got it, so the authoritative state wins');
});

test('stale and duplicate snapshots are ignored; a new host match epoch is accepted', () => {
  const { host, guest } = createPair();
  const s1 = host.exportWorldSnapshot();
  host.team1.gold += 500;
  const s2 = host.exportWorldSnapshot();
  assert.equal(guest.applyWorldSnapshot(s2), true);
  assert.equal(guest.applyWorldSnapshot(s1), false);
  assert.equal(guest.applyWorldSnapshot(s2), false);
  assert.equal(guest.team1.gold, s2.team1.gold);

  host.resetMatch('online', 'normal', 1);
  host.lifecycle = 'playing';
  assert.equal(guest.applyWorldSnapshot(host.exportWorldSnapshot()), true);
});

test('players can only command their own team', () => {
  const { host, guest } = createPair();
  host.team1.gold = host.team2.gold = 1_000;
  guest.applyWorldSnapshot(host.exportWorldSnapshot());
  const defId = getEraUnits(0)[0].id;

  assert.equal(guest.issueLocalCommand({ type: 'SPAWN_UNIT', team: 1, defId }), null);
  assert.equal(host.applyRemoteCommand({ type: 'SPAWN_UNIT', team: 1, defId }), false);
  assert.equal(host.team1.queue.length, 0);
  assert.equal(guest.applyRemoteCommand({ type: 'SPAWN_UNIT', team: 2, defId }), false);
  assert.equal(host.applyRemoteCommand({ type: 'SPAWN_UNIT', team: 2, defId }), true);
});

test('only the host decides the winner; the replica follows its snapshot', () => {
  const { host, guest, guestSummaries } = createPair();
  guest.applyWorldSnapshot(host.exportWorldSnapshot());

  // Predicted (local) fortress destruction on the replica is not a result.
  guest.team1.hp = 0;
  for (let i = 0; i < 60; i++) guest.step(1 / 60, 0);
  assert.equal(guest.lifecycle, 'playing');
  assert.equal(guestSummaries.length, 0);

  host.team1.hp = 0;
  guest.applyWorldSnapshot(host.exportWorldSnapshot());
  for (let i = 0; i < 60; i++) guest.step(1 / 60, 0);
  assert.equal(guest.lifecycle, 'gameover');
  assert.equal(guestSummaries.length, 1);
  assert.equal(guestSummaries[0].winner, 2);
});

test('server MATCH_OVER ends the match with a summary on both roles', () => {
  const { host, guest, hostSummaries, guestSummaries } = createPair();
  host.concludeFromAuthority(1);
  guest.concludeFromAuthority(1);
  for (let i = 0; i < 60; i++) {
    host.step(1 / 60, 0);
    guest.step(1 / 60, 0);
  }
  assert.equal(hostSummaries.length, 1);
  assert.equal(guestSummaries.length, 1);
  assert.equal(guestSummaries[0].winner, 1);
});

test('snapshot number compaction never turns a living fortress into a destroyed one', () => {
  assert.equal(compactNumberReplacer('hp', 0.004), 0.01);
  assert.equal(compactNumberReplacer('x', 123.456789), 123.46);
  assert.equal(compactNumberReplacer('uid', 42), 42);
  assert.equal(compactNumberReplacer('hp', 0), 0);
});
