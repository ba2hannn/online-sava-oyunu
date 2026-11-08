import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyDamageToUnit,
  buildTurretOnSlot,
  calculateKillBountyMultiplier,
  calculatePassiveGoldPerSecond,
  cancelQueuedUnit,
  canEvolveEra,
  checkWinCondition,
  createActiveUnit,
  createInitialTeamState,
  enqueueUnit,
  evolveEra,
  sellTurretOnSlot,
  unlockNextTurretSlot,
  upgradeDoctrine,
  upgradeTurretOnSlot,
} from './rules';
import { ERAS } from './catalog';

test('unit queueing deducts gold and cancellation refunds full cost', () => {
  const team = createInitialTeamState(1);
  const initialGold = team.gold; // 175
  const queued = enqueueUnit(team, 'era0_swarmer'); // cost 35
  assert.equal(queued, true);
  assert.equal(team.gold, initialGold - 35);
  assert.equal(team.queue.length, 1);

  const cancelled = cancelQueuedUnit(team, 0);
  assert.equal(cancelled, true);
  assert.equal(team.gold, initialGold);
  assert.equal(team.queue.length, 0);
});

test('era evolution requires XP threshold and scales fortress max HP', () => {
  const team = createInitialTeamState(1);
  assert.equal(canEvolveEra(team), false);

  team.xp = ERAS[0].evolveXpCost;
  assert.equal(canEvolveEra(team), true);

  const evolved = evolveEra(team);
  assert.equal(evolved, true);
  assert.equal(team.era, 1);
  assert.equal(team.maxHp, ERAS[1].baseMaxHp);
});

test('turret build, upgrade, slot unlock, and sell mechanics work accurately', () => {
  const team = createInitialTeamState(1);
  team.gold = 1000;

  const built = buildTurretOnSlot(team, 0, 'turret_era0_0'); // cost 100
  assert.equal(built, true);
  assert.equal(team.gold, 900);
  assert.equal(team.turrets[0]?.level, 1);

  const upgraded = upgradeTurretOnSlot(team, 0); // cost 75
  assert.equal(upgraded, true);
  assert.equal(team.turrets[0]?.level, 2);

  // Slot 1 is locked initially
  assert.equal(buildTurretOnSlot(team, 1, 'turret_era0_0'), false);
  assert.equal(unlockNextTurretSlot(team), true);
  assert.equal(team.unlockedTurretSlots, 2);
  assert.equal(buildTurretOnSlot(team, 1, 'turret_era0_0'), true);

  const refund = sellTurretOnSlot(team, 0);
  assert.ok(refund > 0);
  assert.equal(team.turrets[0], null);
});

test('unit damage mitigates by armor and absorbs shield before HP', () => {
  const team = createInitialTeamState(1);
  const colossus = createActiveUnit(1, team, 'era0_colossus');
  assert.ok(colossus);
  const startShield = colossus.shield;
  const startHp = colossus.hp;

  // Apply 50 raw damage -> mitigated by 20% armor = 40 damage -> absorbed by 80 shield
  const res1 = applyDamageToUnit(colossus, 50, 1, 20);
  assert.equal(res1.killed, false);
  assert.equal(colossus.shield, startShield - 40);
  assert.equal(colossus.hp, startHp);

  // Apply lethal damage
  const res2 = applyDamageToUnit(colossus, 2000, 1, 50);
  assert.equal(res2.killed, true);
  assert.equal(colossus.hp, 0);
  assert.equal(colossus.state, 'ko');
});

test('doctrines upgrade stats, passive gold is disabled, and win condition detects destroyed base', () => {
  const team1 = createInitialTeamState(1);
  const team2 = createInitialTeamState(2);
  team1.gold = 500;

  assert.equal(calculatePassiveGoldPerSecond(team1), 0);
  assert.equal(calculateKillBountyMultiplier(team1), 1);

  assert.equal(upgradeDoctrine(team1, 'economy'), true);
  assert.ok(calculateKillBountyMultiplier(team1) > 1.2);

  assert.equal(upgradeDoctrine(team1, 'warfare'), true);
  assert.equal(team1.doctrines.warfareLevel, 1);

  assert.equal(checkWinCondition(team1, team2), null);
  team2.hp = 0;
  assert.equal(checkWinCondition(team1, team2), 1);
});
