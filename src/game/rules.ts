import {
  ERAS,
  GROUND_Y,
  MAX_QUEUE_SIZE,
  TEAM1_BASE_X,
  TEAM1_SPAWN_X,
  TEAM2_BASE_X,
  TEAM2_SPAWN_X,
  getDoctrineCost,
  getTurretById,
  getUnitById,
} from './catalog';
import {
  ActiveUnit,
  AIDifficulty,
  BattleActionCommand,
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
  // Passive gold while standing still is disabled; gold is earned strictly by killing enemies!
  return 0;
}

export function calculateKillBountyMultiplier(teamState: TeamState): number {
  // Economy (Ganimet) doctrine increases gold & XP earned per enemy kill by +22% per level
  return 1 + teamState.doctrines.economyLevel * 0.22;
}

export function calculateEffectiveUnitStats(def: UnitDefinition, teamState: TeamState) {
  const warfareMult = 1 + teamState.doctrines.warfareLevel * 0.12;
  const fortressMult = 1 + teamState.doctrines.fortressLevel * 0.1;
  return {
    hp: Math.round(def.hp * fortressMult),
    shield: Math.round(def.shield * fortressMult),
    damage: Math.round(def.damage * warfareMult),
    moveSpeed: def.moveSpeed * (1 + teamState.doctrines.warfareLevel * 0.03),
    armor: Math.min(0.6, def.armor + teamState.doctrines.fortressLevel * 0.025),
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
  teamState.specialCooldown = Math.min(teamState.specialCooldown, 4);
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
  knockbackPower: number
): { actualDamage: number; killed: boolean } {
  if (target.state === 'ko' || target.hp <= 0) {
    return { actualDamage: 0, killed: false };
  }
  let remaining = Math.max(1, Math.round(rawDamage * (1 - target.armor)));
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
      ? 0.22
      : target.archetype === 'charger'
      ? 0.5
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
  if (aiTeam.specialCooldown <= 0 && elapsedTime > 15) {
    const enemyUnits = units.filter((u) => u.team !== aiTeam.team && u.state !== 'ko');
    const threatsNearBase = enemyUnits.filter((u) => Math.abs(u.x - TEAM2_BASE_X) < 650);
    if (enemyUnits.length >= 4 || threatsNearBase.length >= 2) {
      return { type: 'CAST_SPECIAL', team: aiTeam.team };
    }
  }

  // 3. Build or update turret if under pressure or well-funded
  const turretTierId = `turret_era${aiTeam.era}_${aiTeam.gold > 380 * (aiTeam.era + 1) ? 1 : 0}`;
  if (aiTeam.turrets[0] === null && aiTeam.gold >= 130 * (aiTeam.era + 1)) {
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
    aiTeam.gold >= 320 &&
    elapsedTime > 35
  ) {
    return { type: 'UNLOCK_SLOT', team: aiTeam.team };
  }

  if (
    aiTeam.unlockedTurretSlots >= 2 &&
    aiTeam.turrets[1] === null &&
    aiTeam.gold >= 260 * (aiTeam.era + 1)
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
  const hasFrontline = myUnits.some(
    (u) => u.archetype === 'swarmer' || u.archetype === 'colossus' || u.archetype === 'charger'
  );
  const rangerCount = myUnits.filter((u) => u.archetype === 'ranger').length;

  let chosenSlot = 0;
  if (!hasFrontline) {
    chosenSlot = aiTeam.gold >= 120 * Math.pow(2, aiTeam.era) ? 2 : 0;
  } else if (rangerCount < 2) {
    chosenSlot = 1;
  } else if (aiTeam.gold >= 240 * Math.pow(1.9, aiTeam.era)) {
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
    (u) => u.team !== aiTeam.team && u.state !== 'ko' && u.x > TEAM2_BASE_X - 450
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
