import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyDamageToUnit,
  buildTurretOnSlot,
  calculateAntiStallSupplyPerSecond,
  calculateArchetypeCounterMultiplier,
  calculateFortressHitComebackReward,
  calculateKillBountyMultiplier,
  calculatePassiveGoldPerSecond,
  calculateProximityBountyRatio,
  calculateSituationalSpecialProfile,
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
import { BALANCE, ERAS, TEAM1_BASE_X, TEAM2_BASE_X, UNITS, getTurretById, getUnitById } from './catalog';

test('unit queueing deducts gold and cancellation refunds full cost', () => {
  const team = createInitialTeamState(1);
  const initialGold = team.gold; // 150
  const queued = enqueueUnit(team, 'era0_swarmer'); // cost 40
  assert.equal(queued, true);
  assert.equal(team.gold, initialGold - 40);
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

  const built = buildTurretOnSlot(team, 0, 'turret_era0_0'); // cost 110
  assert.equal(built, true);
  assert.equal(team.gold, 890);
  assert.equal(team.turrets[0]?.level, 1);

  const upgraded = upgradeTurretOnSlot(team, 0);
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

test('unit damage mitigates by armor and absorbs shield before HP, with armor penetration support', () => {
  const team = createInitialTeamState(1);
  const colossus = createActiveUnit(1, team, 'era0_colossus');
  assert.ok(colossus);
  const startShield = colossus.shield;
  const startHp = colossus.hp;

  // Apply 30 raw damage -> mitigated by 11% armor = 27 damage -> absorbed by 36 shield
  const res1 = applyDamageToUnit(colossus, 30, 1, 20);
  assert.equal(res1.killed, false);
  assert.equal(colossus.shield, startShield - 27);
  assert.equal(colossus.hp, startHp);

  // Ranger counter multiplier grants +35% damage & 50% armor penetration vs Colossus
  const counter = calculateArchetypeCounterMultiplier('ranger', 'colossus');
  assert.equal(counter.damageMult, 1.35);
  assert.equal(counter.armorPenetration, 0.5);

  // Apply lethal damage
  const res2 = applyDamageToUnit(colossus, 2000, 1, 50);
  assert.equal(res2.killed, true);
  assert.equal(colossus.hp, 0);
  assert.equal(colossus.state, 'ko');
});

test('anti-stall supply, fortress comeback rewards, proximity bounty, and cataclysmic special powers work', () => {
  const team1 = createInitialTeamState(1);
  const team2 = createInitialTeamState(2);
  team1.gold = 500;

  // Passive income is the same budget for both commanders and grows with the era
  assert.equal(calculatePassiveGoldPerSecond(team1), calculatePassiveGoldPerSecond(team2));
  assert.ok(calculatePassiveGoldPerSecond(team1) > 0);
  const richEra = createInitialTeamState(1);
  richEra.era = 3;
  assert.ok(calculatePassiveGoldPerSecond(richEra) > calculatePassiveGoldPerSecond(team1) * 6);
  assert.equal(calculateKillBountyMultiplier(team1), 1);
  // Rich team with active units gets 0 anti-stall supply
  assert.equal(calculateAntiStallSupplyPerSecond(team1, 3, 2, 0, 0, 1), 0);

  // Depleted team with 0 units gets rapid anti-stall supply even if they have a turret
  team1.gold = 10;
  const emergencySupply = calculateAntiStallSupplyPerSecond(team1, 0, 3, 2, 0, 1);
  assert.ok(emergencySupply >= 12);

  // Fortress taking damage grants defender comeback gold, XP & special cooldown reduction
  const comeback = calculateFortressHitComebackReward(team1, team2, 120);
  // 120 damage -> only a small token of compensation (no more gold farming by being sieged)
  assert.ok(comeback.comebackGold >= 1 && comeback.comebackGold <= 12);
  assert.ok(comeback.cooldownReductionSec > 0.08 && comeback.cooldownReductionSec <= 0.6);

  // Situational special power scales up when outnumbered / under siege
  const enemyUnit = createActiveUnit(99, team2, 'era0_colossus')!;
  enemyUnit.x = TEAM1_BASE_X + 200;
  const specialProfile = calculateSituationalSpecialProfile(team1, team2, [enemyUnit]);
  // The ultimate is a random scatter, not a full-lane wipe: modest count/damage, no free gold
  assert.ok(specialProfile.projectileCount >= 14 && specialProfile.projectileCount <= 24);
  assert.ok(specialProfile.damagePerHit >= 60 && specialProfile.damagePerHit <= 120);
  assert.equal(specialProfile.supplyGoldBonus, 0);
  assert.equal(specialProfile.spawnHeights.length, specialProfile.projectileCount);
  // Targets and drop heights are spread out, never a single evenly spaced line
  const xs = [...specialProfile.targetXs].sort((a, b) => a - b);
  const gaps = xs.slice(1).map((x, i) => x - xs[i]);
  assert.ok(new Set(gaps.map((g) => Math.round(g))).size > gaps.length / 2);
  assert.ok(new Set(specialProfile.spawnHeights.map((h) => Math.round(h))).size > 10);

  // Killing near own base vs killing near enemy base
  const defensiveKill = calculateProximityBountyRatio(1, TEAM1_BASE_X + 20);
  const offensiveKill = calculateProximityBountyRatio(1, TEAM2_BASE_X - 20);
  assert.ok(offensiveKill.multiplier > defensiveKill.multiplier * 1.5);
  assert.ok(offensiveKill.multiplier < defensiveKill.multiplier * 2);
  assert.ok(offensiveKill.bonusPercent >= 130);
  assert.ok(defensiveKill.bonusPercent >= 70 && defensiveKill.bonusPercent <= 85);

  team1.gold = 500;
  assert.equal(upgradeDoctrine(team1, 'economy'), true);
  assert.ok(calculateKillBountyMultiplier(team1) > 1.1);

  assert.equal(upgradeDoctrine(team1, 'warfare'), true);
  assert.equal(team1.doctrines.warfareLevel, 1);

  assert.equal(checkWinCondition(team1, team2), null);
  team2.hp = 0;
  assert.equal(checkWinCondition(team1, team2), 1);
});

test('supply cap stops spamming the strongest unit and counts the queue too', () => {
  const team = createInitialTeamState(0 as 1);
  team.gold = 100000;
  // Era 0 cap is 10: two Colossi (4 each) fit, a third does not
  assert.equal(enqueueUnit(team, 'era0_colossus'), true);
  assert.equal(enqueueUnit(team, 'era0_colossus'), true);
  assert.equal(enqueueUnit(team, 'era0_colossus'), false);
  // Remaining supply (2) still allows cheap units
  assert.equal(enqueueUnit(team, 'era0_swarmer'), true);
  assert.equal(enqueueUnit(team, 'era0_swarmer'), true);
  assert.equal(enqueueUnit(team, 'era0_swarmer'), false);
  // Units already on the field count as well
  const fresh = createInitialTeamState(1);
  fresh.gold = 100000;
  fresh.fieldSupply = 10;
  assert.equal(enqueueUnit(fresh, 'era0_swarmer'), false);
});

test('kills no longer refund more than a unit cost, so gold cannot snowball', () => {
  for (const u of UNITS) {
    const baseRefund = u.rewardGold * BALANCE.KILL_GOLD_SCALE;
    assert.ok(baseRefund < u.cost * 0.45, `${u.id} bounty too generous`);
  }
});

test('towers cannot solo-kill the era infantry in under ~4 seconds', () => {
  for (let era = 0; era < 5; era++) {
    const tower = getTurretById(`turret_era${era}_0`)!;
    const swarmer = getUnitById(`era${era}_swarmer`)!;
    const dps = tower.damage / tower.fireInterval;
    const ttk = (swarmer.hp + swarmer.shield) / (dps * (1 - swarmer.armor));
    assert.ok(ttk >= 4, `era ${era} tower kills a swarmer in ${ttk.toFixed(1)}s`);
  }
});
