import {
  ERAS,
  GROUND_Y,
  MAX_QUEUE_SIZE,
  TEAM1_BASE_X,
  TEAM1_SPAWN_X,
  TEAM2_BASE_X,
  TEAM2_SPAWN_X,
  WORLD_WIDTH,
  getDoctrineCost,
  getEraUnits,
  getTurretById,
  getUnitById,
} from './catalog';
import {
  ActiveUnit,
  AIDifficulty,
  BattleActionCommand,
  ProjectilePoolItem,
  TeamId,
  TeamState,
  UnitDefinition,
} from './types';

export function createInitialTeamState(team: TeamId, name?: string): TeamState {
  const era0 = ERAS[0];
  return {
    team,
    name: name || (team === 1 ? 'Kuzey Sancağı' : 'Güney İmparatorluğu'),
    era: 0,
    hp: era0.baseMaxHp,
    maxHp: era0.baseMaxHp,
    trailingHp: era0.baseMaxHp,
    gold: 175,
    xp: 0,
    unlockedTurretSlots: 1,
    turrets: [null, null, null, null],
    queue: [],
    doctrines: {
      economyLevel: 0,
      warfareLevel: 0,
      fortressLevel: 0,
    },
    specialCooldown: 0,
    specialMaxCooldown: era0.specialCooldown,
    unitsSpawned: 0,
    unitsLost: 0,
    totalGoldEarned: 175,
    baseHitFlash: 0,
  };
}

export function calculatePassiveGoldPerSecond(_teamState: TeamState): number {
  // Base passive gold while hoarding gold is disabled; gold comes from kills, combat hits & anti-stall supply
  return 0;
}

export function getCheapestEraUnitCost(era: number): number {
  const eraUnits = getEraUnits(era);
  if (eraUnits.length === 0) return 35;
  return Math.min(...eraUnits.map((u) => u.cost));
}

export function calculateAntiStallSupplyPerSecond(
  teamState: TeamState,
  activeAllyUnits: number,
  activeEnemyUnits: number,
  enemiesNearMyBase = 0,
  enemyEra = 0,
  enemyHpRatio = 1
): number {
  const cheapestCost = getCheapestEraUnitCost(teamState.era);
  const totalAllyPresence = activeAllyUnits + teamState.queue.length;
  const econMult = 1 + teamState.doctrines.economyLevel * 0.22;
  const myHpRatio = teamState.hp / Math.max(1, teamState.maxHp);

  // 1. Deadlock Prevention (Acil Seferberlik İkmali):
  // If a commander has 0 units on field + 0 in queue (regardless of turrets!) and cannot comfortably afford units,
  // rapidly supply gold up to 1.35x cheapest unit cost so the game NEVER stalls.
  if (totalAllyPresence === 0 && teamState.gold < cheapestCost * 1.35) {
    return Math.round(cheapestCost * 0.36 * econMult);
  }

  // 2. Underdog & Siege Pressure Trickle (Geridekine & Kuşatma Altındakine Ufak Ufak Telafi Parası):
  // If enemies are pressing near our fortress, or we are outnumbered / behind in HP or Era,
  // provide a balanced comeback trickle (capped when gold is already high so it cannot be abused by rich players).
  const isOutnumbered = activeEnemyUnits > activeAllyUnits;
  const isBehindHp = myHpRatio + 0.12 < enemyHpRatio;
  const isBehindEra = enemyEra > teamState.era;
  const isPinnedAtGate = enemiesNearMyBase >= 1;

  if (
    teamState.gold < cheapestCost * 2.4 &&
    (isPinnedAtGate || isOutnumbered || isBehindHp || isBehindEra)
  ) {
    let pressureFactor = 0.08;
    if (isPinnedAtGate) pressureFactor += Math.min(0.2, enemiesNearMyBase * 0.055);
    if (isOutnumbered) pressureFactor += Math.min(0.14, (activeEnemyUnits - activeAllyUnits) * 0.035);
    if (isBehindHp) pressureFactor += Math.min(0.12, (enemyHpRatio - myHpRatio) * 0.22);
    if (isBehindEra) pressureFactor += 0.1;
    return Math.max(4, Math.round(cheapestCost * pressureFactor * econMult));
  }

  // 3. Low-Gold Combat Recovery (Cephe Lojistik Desteği):
  if (teamState.gold < cheapestCost) {
    return Math.round(cheapestCost * 0.18 * econMult);
  }

  // 4. Stalemate Breaker: if neither side has any units on the field and gold is below 2x cheapest unit
  if (totalAllyPresence === 0 && activeEnemyUnits === 0 && teamState.gold < cheapestCost * 2) {
    return Math.round(cheapestCost * 0.26 * econMult);
  }

  return 0;
}

export function calculateFortressHitComebackReward(
  defenderTeam: TeamState,
  attackerTeam: TeamState,
  damageDealt: number
): { comebackGold: number; comebackXp: number; cooldownReductionSec: number } {
  // When a fortress is taking hits, give the defending player small emergency gold, XP & faster special cooldown
  // so getting pushed to your castle Gate allows a tactical comeback instead of an instant snowball loss!
  const econMult = 1 + defenderTeam.doctrines.economyLevel * 0.2;
  const defenderHpRatio = defenderTeam.hp / Math.max(1, defenderTeam.maxHp);
  const attackerHpRatio = attackerTeam.hp / Math.max(1, attackerTeam.maxHp);
  const behindMult = defenderHpRatio < attackerHpRatio ? 1.35 : 1.0;

  const comebackGold = Math.max(
    3,
    Math.round(damageDealt * 0.26 * econMult * behindMult)
  );
  const comebackXp = Math.max(2, Math.round(damageDealt * 0.18 * econMult));
  const cooldownReductionSec = Math.min(2.2, Math.max(0.35, damageDealt / 180));

  return { comebackGold, comebackXp, cooldownReductionSec };
}

export interface SituationalSpecialProfile {
  modeLabel: string;
  projectileType: ProjectilePoolItem['type'];
  projectileCount: number;
  damagePerHit: number;
  splashRadius: number;
  knockback: number;
  supplyGoldBonus: number;
  supplyXpBonus: number;
  targetXs: number[];
}

export function calculateSituationalSpecialProfile(
  casterTeam: TeamState,
  enemyTeam: TeamState,
  units: ActiveUnit[]
): SituationalSpecialProfile {
  const era = casterTeam.era;
  const dir = casterTeam.team === 1 ? 1 : -1;
  const myBaseX = casterTeam.team === 1 ? TEAM1_BASE_X : TEAM2_BASE_X;
  const enemyBaseX = casterTeam.team === 1 ? TEAM2_BASE_X : TEAM1_BASE_X;

  const allyUnits = units.filter((u) => u.team === casterTeam.team && u.state !== 'ko');
  const enemyUnits = units.filter((u) => u.team !== casterTeam.team && u.state !== 'ko');
  const enemiesNearMyBase = enemyUnits.filter((u) => Math.abs(u.x - myBaseX) < 780);
  const alliesNearEnemyBase = allyUnits.filter((u) => Math.abs(u.x - enemyBaseX) < 840);

  const isUnderSiege =
    enemiesNearMyBase.length >= 1 ||
    enemyUnits.length > allyUnits.length ||
    casterTeam.hp < casterTeam.maxHp * 0.65;
  const isVanguardPush = !isUnderSiege && alliesNearEnemyBase.length >= 2;

  // Cataclysmic Ultimate Power across all 5 Eras (wipes entire armies across the lane!)
  const eraBaseCounts = [36, 52, 42, 46, 50];
  const eraBaseDamages = [680, 1250, 2600, 5600, 12500];
  const eraBaseSplash = [195, 175, 215, 240, 275];
  const eraBaseKnockback = [165, 130, 185, 210, 245];
  const eraProjectileTypes: ProjectilePoolItem['type'][] = [
    'meteor',
    'arrow',
    'cannon',
    'airstrike',
    'orbital',
  ];

  const warfareMult = 1 + casterTeam.doctrines.warfareLevel * 0.16;
  let situationalMult = 1.0;
  let countMult = 1.0;
  let modeLabel = 'KIYAMET TAARRUZ BARAJI';

  if (isUnderSiege) {
    // Outnumbered / defending base -> Cataclysmic Siege-Breaker boost + emergency gold supply
    situationalMult = 1.55;
    countMult = 1.45;
    modeLabel = 'SON DİRENİŞ KIYAMET BARAJI (+%55 GÜÇ)';
  } else if (isVanguardPush) {
    // Pushing enemy base -> Concentrated Siege Bombardment
    situationalMult = 1.35;
    countMult = 1.3;
    modeLabel = 'KUŞATMA YARMA KIYAMETİ (+%35 GÜÇ)';
  } else if (enemyTeam.era > casterTeam.era) {
    // Behind in Era -> Catch-up Overcharge
    situationalMult = 1.45;
    countMult = 1.35;
    modeLabel = 'DENGELEYİCİ SÜPER KIYAMET (+%45 GÜÇ)';
  }

  const projectileCount = Math.round((eraBaseCounts[era] ?? 38) * countMult);
  const damagePerHit = Math.round((eraBaseDamages[era] ?? 750) * warfareMult * situationalMult);
  const splashRadius = Math.round((eraBaseSplash[era] ?? 185) * (isUnderSiege ? 1.25 : 1.0));
  const knockback = Math.round((eraBaseKnockback[era] ?? 150) * (isUnderSiege ? 1.4 : 1.0));

  const cheapestCost = getCheapestEraUnitCost(era);
  const supplyGoldBonus = Math.round(
    cheapestCost * (isUnderSiege ? 2.2 : 1.2) * (1 + casterTeam.doctrines.economyLevel * 0.22)
  );
  const supplyXpBonus = Math.round(supplyGoldBonus * 1.4);

  // Build smart target X coordinates based on live battlefield state ("duruma göre")
  const targetXs: number[] = [];
  const startX = casterTeam.team === 1 ? 260 : WORLD_WIDTH - 260;
  const laneSpan = WORLD_WIDTH - 520;

  for (let i = 0; i < projectileCount; i++) {
    if (enemyUnits.length > 0 && i % 3 !== 2) {
      // 2/3 of projectiles lock directly onto live enemy units & clusters!
      const pickedEnemy = enemyUnits[i % enemyUnits.length];
      const spread = ((i * 53) % 150) - 75;
      const tx = Math.max(210, Math.min(WORLD_WIDTH - 210, pickedEnemy.x + spread));
      targetXs.push(tx);
    } else if (isVanguardPush) {
      // Focus bombardment on the enemy half of the map & enemy fortress perimeter
      const ratio = 0.35 + (i / Math.max(1, projectileCount - 1)) * 0.62;
      const tx = startX + dir * (laneSpan * ratio);
      targetXs.push(Math.max(210, Math.min(WORLD_WIDTH - 210, tx)));
    } else {
      // Full-corridor rolling barrage from friendly frontline to enemy base
      const ratio = i / Math.max(1, projectileCount - 1);
      const tx = startX + dir * (laneSpan * ratio);
      targetXs.push(Math.max(210, Math.min(WORLD_WIDTH - 210, tx)));
    }
  }

  return {
    modeLabel,
    projectileType: eraProjectileTypes[era] ?? 'meteor',
    projectileCount,
    damagePerHit,
    splashRadius,
    knockback,
    supplyGoldBonus,
    supplyXpBonus,
    targetXs,
  };
}

export function calculateArchetypeCounterMultiplier(
  attackerArchetype: UnitDefinition['archetype'] | undefined,
  targetArchetype: UnitDefinition['archetype']
): { damageMult: number; armorPenetration: number } {
  if (!attackerArchetype) {
    return { damageMult: 1.0, armorPenetration: 0 };
  }
  // Swarmer (Slot 1): Giant Slayer (+25% damage & 25% armor pen vs Colossus)
  if (attackerArchetype === 'swarmer' && targetArchetype === 'colossus') {
    return { damageMult: 1.25, armorPenetration: 0.25 };
  }
  // Ranger (Slot 2): Armor Piercing (+35% damage & 50% armor pen vs Colossus, +20% vs Charger)
  if (attackerArchetype === 'ranger') {
    if (targetArchetype === 'colossus') {
      return { damageMult: 1.35, armorPenetration: 0.5 };
    }
    if (targetArchetype === 'charger') {
      return { damageMult: 1.2, armorPenetration: 0.35 };
    }
  }
  // Charger (Slot 3): Flank Strike (+25% damage vs Ranger)
  if (attackerArchetype === 'charger' && targetArchetype === 'ranger') {
    return { damageMult: 1.25, armorPenetration: 0.15 };
  }
  return { damageMult: 1.0, armorPenetration: 0 };
}

export function calculateKillBountyMultiplier(teamState: TeamState): number {
  // Economy (Ganimet) doctrine increases gold & XP earned per enemy kill by +22% per level
  return 1 + teamState.doctrines.economyLevel * 0.22;
}

export function calculateProximityBountyRatio(
  killerTeam: TeamId,
  killX: number
): { multiplier: number; bonusPercent: number; progress: number } {
  const span = Math.max(1, TEAM2_BASE_X - TEAM1_BASE_X);
  const rawProgress =
    killerTeam === 1
      ? (killX - TEAM1_BASE_X) / span
      : (TEAM2_BASE_X - killX) / span;
  const progress = Math.max(0, Math.min(1, rawProgress));
  // Turtling at own base (progress=0) yields 45% (0.45x).
  // Pushing to enemy base (progress=1) yields 225% (2.25x) — 5x more gold than turtling!
  const multiplier = Number((0.45 + Math.pow(progress, 1.15) * 1.8).toFixed(2));
  const bonusPercent = Math.round(multiplier * 100);
  return { multiplier, bonusPercent, progress };
}

export function calculateEffectiveUnitStats(def: UnitDefinition, teamState: TeamState) {
  const warfareMult = 1 + teamState.doctrines.warfareLevel * 0.12;
  const fortressMult = 1 + teamState.doctrines.fortressLevel * 0.1;
  return {
    hp: Math.round(def.hp * fortressMult),
    shield: Math.round(def.shield * fortressMult),
    damage: Math.round(def.damage * warfareMult),
    moveSpeed: def.moveSpeed * (1 + teamState.doctrines.warfareLevel * 0.03),
    armor: Math.min(0.5, def.armor + teamState.doctrines.fortressLevel * 0.02),
  };
}

export function canQueueUnit(teamState: TeamState, unitDefId: string): boolean {
  const def = getUnitById(unitDefId);
  if (!def) return false;
  if (def.era > teamState.era) return false;
  if (teamState.queue.length >= MAX_QUEUE_SIZE) return false;
  if (teamState.gold < def.cost) return false;
  return true;
}

export function enqueueUnit(teamState: TeamState, unitDefId: string): boolean {
  if (!canQueueUnit(teamState, unitDefId)) return false;
  const def = getUnitById(unitDefId)!;
  teamState.gold -= def.cost;
  teamState.queue.push({
    unitDefId: def.id,
    remainingTime: def.trainTime,
    totalTime: def.trainTime,
  });
  return true;
}

export function cancelQueuedUnit(teamState: TeamState, queueIndex: number): boolean {
  if (queueIndex < 0 || queueIndex >= teamState.queue.length) return false;
  const item = teamState.queue[queueIndex];
  const def = getUnitById(item.unitDefId);
  if (def) {
    teamState.gold += def.cost;
  }
  teamState.queue.splice(queueIndex, 1);
  return true;
}

export function unlockNextTurretSlot(teamState: TeamState): boolean {
  if (teamState.unlockedTurretSlots >= 4) return false;
  const eraDef = ERAS[teamState.era];
  const nextSlotIdx = teamState.unlockedTurretSlots;
  const cost = eraDef.turretSlotCosts[nextSlotIdx];
  if (teamState.gold < cost) return false;
  teamState.gold -= cost;
  teamState.unlockedTurretSlots += 1;
  return true;
}

export function buildTurretOnSlot(
  teamState: TeamState,
  slotIndex: number,
  turretDefId: string
): boolean {
  if (slotIndex < 0 || slotIndex >= teamState.unlockedTurretSlots) return false;
  const def = getTurretById(turretDefId);
  if (!def || def.era > teamState.era) return false;
  const existing = teamState.turrets[slotIndex];
  if (existing && existing.turretDefId === turretDefId) return false;

  // If replacing an older turret, auto-refund 65% of old turret value
  let refund = 0;
  if (existing) {
    const oldDef = getTurretById(existing.turretDefId);
    if (oldDef) {
      refund = Math.round(oldDef.cost * 0.65 * existing.level);
    }
  }
  const netCost = Math.max(0, def.cost - refund);
  if (teamState.gold < netCost) return false;

  teamState.gold -= netCost;
  teamState.turrets[slotIndex] = {
    slotIndex,
    turretDefId: def.id,
    cooldown: 0.2,
    recoil: 0,
    aimAngle: teamState.team === 1 ? 0 : Math.PI,
    level: 1,
  };
  return true;
}

export function upgradeTurretOnSlot(teamState: TeamState, slotIndex: number): boolean {
  if (slotIndex < 0 || slotIndex >= teamState.unlockedTurretSlots) return false;
  const installed = teamState.turrets[slotIndex];
  if (!installed || installed.level >= 3) return false;
  const def = getTurretById(installed.turretDefId);
  if (!def) return false;
  const upgradeCost = Math.round(def.cost * 0.75 * installed.level);
  if (teamState.gold < upgradeCost) return false;

  teamState.gold -= upgradeCost;
  installed.level += 1;
  return true;
}

export function sellTurretOnSlot(teamState: TeamState, slotIndex: number): number {
  if (slotIndex < 0 || slotIndex >= 4) return 0;
  const installed = teamState.turrets[slotIndex];
  if (!installed) return 0;
  const def = getTurretById(installed.turretDefId);
  const refund = def ? Math.round(def.cost * 0.7 * installed.level) : 50;
  teamState.gold += refund;
  teamState.turrets[slotIndex] = null;
  return refund;
}

export function canEvolveEra(teamState: TeamState): boolean {
  if (teamState.era >= ERAS.length - 1) return false;
  const currentEra = ERAS[teamState.era];
  return teamState.xp >= currentEra.evolveXpCost;
}

export function evolveEra(teamState: TeamState): boolean {
  if (!canEvolveEra(teamState)) return false;
  const oldMax = teamState.maxHp;
  teamState.era += 1;
  const nextEra = ERAS[teamState.era];
  const hpGain = nextEra.baseMaxHp - oldMax;
  teamState.maxHp = nextEra.baseMaxHp;
  teamState.hp = Math.min(teamState.maxHp, teamState.hp + hpGain + Math.round(nextEra.baseMaxHp * 0.15));
  teamState.trailingHp = Math.max(teamState.trailingHp, teamState.hp);
  teamState.specialMaxCooldown = nextEra.specialCooldown;
  teamState.specialCooldown = Math.min(teamState.specialCooldown, 12);
  return true;
}

export function upgradeDoctrine(
  teamState: TeamState,
  key: 'economy' | 'warfare' | 'fortress'
): boolean {
  const field =
    key === 'economy'
      ? 'economyLevel'
      : key === 'warfare'
      ? 'warfareLevel'
      : 'fortressLevel';
  const currentLevel = teamState.doctrines[field];
  if (currentLevel >= 5) return false;
  const cost = getDoctrineCost(key, currentLevel);
  if (teamState.gold < cost) return false;
  teamState.gold -= cost;
  teamState.doctrines[field] += 1;
  if (key === 'fortress') {
    const bonusHp = Math.round(teamState.maxHp * 0.08);
    teamState.maxHp += bonusHp;
    teamState.hp = Math.min(teamState.maxHp, teamState.hp + bonusHp);
  }
  return true;
}

export function createActiveUnit(
  uid: number,
  teamState: TeamState,
  unitDefId: string
): ActiveUnit | null {
  const def = getUnitById(unitDefId);
  if (!def) return null;
  const eff = calculateEffectiveUnitStats(def, teamState);
  const spawnX = teamState.team === 1 ? TEAM1_SPAWN_X : TEAM2_SPAWN_X;
  return {
    uid,
    team: teamState.team,
    defId: def.id,
    era: def.era,
    archetype: def.archetype,
    name: def.name,
    x: spawnX,
    y: GROUND_Y,
    vx: 0,
    hp: eff.hp,
    maxHp: eff.hp,
    trailingHp: eff.hp,
    shield: eff.shield,
    maxShield: eff.shield,
    damage: eff.damage,
    attackRange: def.attackRange,
    attackInterval: def.attackInterval,
    windupTime: def.windupTime,
    moveSpeed: eff.moveSpeed,
    armor: eff.armor,
    splashRadius: def.splashRadius,
    knockbackPower: def.knockbackPower,
    rewardGold: def.rewardGold,
    rewardXp: def.rewardXp,
    width: def.width,
    height: def.height,
    primaryColor: def.primaryColor,
    accentColor: def.accentColor,
    projectileType: def.projectileType,
    state: 'walk',
    stateTimer: 0,
    attackCooldown: 0,
    walkDistance: 0,
    scaleX: 0.82,
    scaleY: 1.2,
    hitFlashTimer: 0,
    chargeReady: def.archetype === 'charger',
    charging: false,
    koTimer: 0,
    koAngle: 0,
    koVy: 0,
  };
}

export function applyDamageToUnit(
  target: ActiveUnit,
  rawDamage: number,
  knockbackDir: number,
  knockbackPower: number,
  armorPenetration = 0
): { actualDamage: number; killed: boolean } {
  if (target.state === 'ko' || target.hp <= 0) {
    return { actualDamage: 0, killed: false };
  }
  const effectiveArmor = Math.max(0, target.armor * (1 - Math.min(1, armorPenetration)));
  let remaining = Math.max(1, Math.round(rawDamage * (1 - effectiveArmor)));
  if (target.shield > 0) {
    const absorbed = Math.min(target.shield, remaining);
    target.shield -= absorbed;
    remaining -= absorbed;
  }
  target.hp = Math.max(0, target.hp - remaining);
  target.hitFlashTimer = 0.06;
  target.scaleX = 1.16;
  target.scaleY = 0.84;

  // Apply knockback resisted by colossus/swarmer weight
  const weightResist =
    target.archetype === 'colossus'
      ? 0.25
      : target.archetype === 'charger'
      ? 0.55
      : 1.0;
  target.x = Math.max(
    TEAM1_BASE_X + 40,
    Math.min(TEAM2_BASE_X - 40, target.x + knockbackDir * knockbackPower * 0.35 * weightResist)
  );

  if (target.hp <= 0) {
    target.state = 'ko';
    target.koTimer = 0.38;
    target.koVy = -140;
    target.vx = knockbackDir * 120;
    return { actualDamage: remaining, killed: true };
  }
  return { actualDamage: remaining, killed: false };
}

export function checkWinCondition(team1: TeamState, team2: TeamState): TeamId | null {
  if (team2.hp <= 0) return 1;
  if (team1.hp <= 0) return 2;
  return null;
}

export function applyBattleCommand(
  teamState: TeamState,
  cmd: BattleActionCommand
): boolean {
  switch (cmd.type) {
    case 'SPAWN_UNIT':
      return cmd.defId ? enqueueUnit(teamState, cmd.defId) : false;
    case 'CANCEL_QUEUE':
      return typeof cmd.slotIndex === 'number'
        ? cancelQueuedUnit(teamState, cmd.slotIndex)
        : false;
    case 'BUILD_TURRET':
      return typeof cmd.slotIndex === 'number' && cmd.defId
        ? buildTurretOnSlot(teamState, cmd.slotIndex, cmd.defId)
        : false;
    case 'UPGRADE_TURRET':
      return typeof cmd.slotIndex === 'number'
        ? upgradeTurretOnSlot(teamState, cmd.slotIndex)
        : false;
    case 'SELL_TURRET':
      return typeof cmd.slotIndex === 'number'
        ? sellTurretOnSlot(teamState, cmd.slotIndex) > 0
        : false;
    case 'UNLOCK_SLOT':
      return unlockNextTurretSlot(teamState);
    case 'EVOLVE_ERA':
      return evolveEra(teamState);
    case 'UPGRADE_DOCTRINE':
      return cmd.doctrineKey ? upgradeDoctrine(teamState, cmd.doctrineKey) : false;
    default:
      return false;
  }
}

export function decideAICommand(
  aiTeam: TeamState,
  enemyTeam: TeamState,
  units: ActiveUnit[],
  difficulty: AIDifficulty,
  elapsedTime: number
): BattleActionCommand | null {
  // 1. Evolve Era immediately if able
  if (canEvolveEra(aiTeam)) {
    return { type: 'EVOLVE_ERA', team: aiTeam.team };
  }

  // 2. Cast Special Power if enemies are clustered or pushing AI base
  if (aiTeam.specialCooldown <= 0 && elapsedTime > 18) {
    const enemyUnits = units.filter((u) => u.team !== aiTeam.team && u.state !== 'ko');
    const threatsNearBase = enemyUnits.filter((u) => Math.abs(u.x - TEAM2_BASE_X) < 680);
    if (enemyUnits.length >= 4 || threatsNearBase.length >= 2) {
      return { type: 'CAST_SPECIAL', team: aiTeam.team };
    }
  }

  // 3. Build or update turret if under pressure or well-funded
  const turretTierId = `turret_era${aiTeam.era}_${aiTeam.gold > 420 * (aiTeam.era + 1) ? 1 : 0}`;
  if (aiTeam.turrets[0] === null && aiTeam.gold >= 140 * (aiTeam.era + 1)) {
    return {
      type: 'BUILD_TURRET',
      team: aiTeam.team,
      slotIndex: 0,
      defId: `turret_era${aiTeam.era}_0`,
    };
  }

  if (
    difficulty !== 'normal' &&
    aiTeam.unlockedTurretSlots < 2 &&
    aiTeam.gold >= 340 &&
    elapsedTime > 40
  ) {
    return { type: 'UNLOCK_SLOT', team: aiTeam.team };
  }

  if (
    aiTeam.unlockedTurretSlots >= 2 &&
    aiTeam.turrets[1] === null &&
    aiTeam.gold >= 280 * (aiTeam.era + 1)
  ) {
    return {
      type: 'BUILD_TURRET',
      team: aiTeam.team,
      slotIndex: 1,
      defId: turretTierId,
    };
  }

  // 4. Upgrade economy doctrine occasionally in hard/legendary
  if (
    difficulty !== 'normal' &&
    aiTeam.doctrines.economyLevel < aiTeam.era + 1 &&
    aiTeam.gold >= getDoctrineCost('economy', aiTeam.doctrines.economyLevel) * 1.4
  ) {
    return {
      type: 'UPGRADE_DOCTRINE',
      team: aiTeam.team,
      doctrineKey: 'economy',
    };
  }

  // 5. Queue units with tactical composition (Frontline + Ranger + Charger/Colossus)
  if (aiTeam.queue.length >= 3) return null;

  const myUnits = units.filter((u) => u.team === aiTeam.team && u.state !== 'ko');
  const enemyColossusCount = units.filter(
    (u) => u.team !== aiTeam.team && u.state !== 'ko' && u.archetype === 'colossus'
  ).length;
  const hasFrontline = myUnits.some(
    (u) => u.archetype === 'swarmer' || u.archetype === 'colossus' || u.archetype === 'charger'
  );
  const rangerCount = myUnits.filter((u) => u.archetype === 'ranger').length;
  const colossusCount = myUnits.filter((u) => u.archetype === 'colossus').length;

  let chosenSlot = 0;
  if (enemyColossusCount > 0 && rangerCount < 3) {
    // Counter enemy Colossus with Armor-Piercing Rangers & Swarmers!
    chosenSlot = myUnits.length === 0 ? 0 : 1;
  } else if (!hasFrontline) {
    chosenSlot = aiTeam.gold >= 165 * Math.pow(2.05, aiTeam.era) ? 2 : 0;
  } else if (rangerCount < 2) {
    chosenSlot = 1;
  } else if (colossusCount === 0 && aiTeam.gold >= 380 * Math.pow(2.05, aiTeam.era)) {
    chosenSlot = 3;
  } else {
    chosenSlot = Math.floor((elapsedTime * 7) % 3);
  }

  const unitDefId = `era${aiTeam.era}_${
    chosenSlot === 0
      ? 'swarmer'
      : chosenSlot === 1
      ? 'ranger'
      : chosenSlot === 2
      ? 'charger'
      : 'colossus'
  }`;

  if (canQueueUnit(aiTeam, unitDefId)) {
    return {
      type: 'SPAWN_UNIT',
      team: aiTeam.team,
      defId: unitDefId,
    };
  }

  // Fallback to swarmer if short on gold and enemy is close to AI base
  const urgentThreat = units.some(
    (u) => u.team !== aiTeam.team && u.state !== 'ko' && u.x > TEAM2_BASE_X - 480
  );
  if (urgentThreat && canQueueUnit(aiTeam, `era${aiTeam.era}_swarmer`)) {
    return {
      type: 'SPAWN_UNIT',
      team: aiTeam.team,
      defId: `era${aiTeam.era}_swarmer`,
    };
  }

  return null;
}
