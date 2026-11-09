export type GameLifecycleState = 'title' | 'playing' | 'paused' | 'gameover';

export type GameMode = 'ai' | 'online' | 'local2p';

export type AIDifficulty = 'normal' | 'hard' | 'legendary';

export type TeamId = 1 | 2;

export type UnitArchetype = 'swarmer' | 'ranger' | 'charger' | 'colossus';

export interface EraDefinition {
  id: number; // 0 to 4
  name: string;
  subtitle: string;
  evolveXpCost: number;
  baseMaxHp: number;
  specialName: string;
  specialDescription: string;
  specialCooldown: number;
  accentColor: string;
  secondaryColor: string;
  skyTop: string;
  skyBottom: string;
  turretSlotCosts: [number, number, number, number];
}

export interface UnitDefinition {
  id: string;
  era: number;
  slotIndex: number; // 0..3
  name: string;
  roleClue: string;
  archetype: UnitArchetype;
  cost: number;
  trainTime: number; // seconds
  hp: number;
  shield: number;
  damage: number;
  attackRange: number;
  attackInterval: number;
  windupTime: number;
  moveSpeed: number;
  armor: number; // flat percentage reduction 0..0.45
  splashRadius: number;
  knockbackPower: number;
  rewardGold: number;
  rewardXp: number;
  width: number;
  height: number;
  primaryColor: string;
  accentColor: string;
  projectileType?: 'stone' | 'arrow' | 'bullet' | 'rocket' | 'laser' | 'plasma';
}

export interface TurretDefinition {
  id: string;
  era: number;
  tier: number; // 0 or 1 within era
  name: string;
  roleClue: string;
  cost: number;
  damage: number;
  range: number;
  fireInterval: number;
  splashRadius: number;
  projectileType: 'stone' | 'arrow' | 'cannon' | 'bullet' | 'missile' | 'ion' | 'tesla';
  primaryColor: string;
  accentColor: string;
}

export interface QueuedUnit {
  unitDefId: string;
  remainingTime: number;
  totalTime: number;
}

export interface InstalledTurret {
  slotIndex: number;
  turretDefId: string;
  cooldown: number;
  recoil: number;
  aimAngle: number;
  level: number; // 1..3 upgrade level
}

export interface DoctrineState {
  economyLevel: number; // 0..5 (+gold/sec)
  warfareLevel: number; // 0..5 (+damage & attack speed)
  fortressLevel: number; // 0..5 (+armor & base regen)
}

export interface ActiveUnit {
  uid: number;
  team: TeamId;
  defId: string;
  era: number;
  archetype: UnitArchetype;
  name: string;
  x: number;
  y: number;
  vx: number;
  hp: number;
  maxHp: number;
  trailingHp: number;
  shield: number;
  maxShield: number;
  damage: number;
  attackRange: number;
  attackInterval: number;
  windupTime: number;
  moveSpeed: number;
  armor: number;
  splashRadius: number;
  knockbackPower: number;
  rewardGold: number;
  rewardXp: number;
  width: number;
  height: number;
  primaryColor: string;
  accentColor: string;
  projectileType?: 'stone' | 'arrow' | 'bullet' | 'rocket' | 'laser' | 'plasma';
  // Dynamic animation & combat states
  state: 'walk' | 'windup' | 'recover' | 'ko';
  stateTimer: number;
  attackCooldown: number;
  walkDistance: number;
  scaleX: number;
  scaleY: number;
  hitFlashTimer: number;
  chargeReady: boolean;
  charging: boolean;
  koTimer: number;
  koAngle: number;
  koVy: number;
}

export interface TeamState {
  team: TeamId;
  name: string;
  era: number;
  hp: number;
  maxHp: number;
  trailingHp: number;
  gold: number;
  xp: number;
  unlockedTurretSlots: number; // starts at 1, up to 4
  turrets: (InstalledTurret | null)[];
  queue: QueuedUnit[];
  doctrines: DoctrineState;
  specialCooldown: number;
  specialMaxCooldown: number;
  unitsSpawned: number;
  unitsLost: number;
  totalGoldEarned: number;
  baseHitFlash: number;
  /** Sahadaki canlı birimlerin toplam nüfusu (motor her karede günceller). */
  fieldSupply?: number;
}

export interface ProjectilePoolItem {
  active: boolean;
  team: TeamId;
  type: 'stone' | 'arrow' | 'bullet' | 'cannon' | 'rocket' | 'missile' | 'laser' | 'plasma' | 'ion' | 'tesla' | 'meteor' | 'airstrike' | 'orbital';
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  damage: number;
  splashRadius: number;
  knockback: number;
  color: string;
  radius: number;
  life: number;
  maxLife: number;
  rotation: number;
}

export interface ParticlePoolItem {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  size: number;
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
  shape: 'circle' | 'spark' | 'smoke' | 'ring';
}

export interface FloatingTextPoolItem {
  active: boolean;
  x: number;
  y: number;
  vy: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
  scale: number;
}

export interface RunSummarySnapshot {
  winner: TeamId;
  playerTeam: TeamId;
  durationSec: number;
  playerEra: number;
  enemyEra: number;
  unitsDefeated: number;
  unitsSpawned: number;
  goldEarned: number;
  playerHpRemaining: number;
  playerMaxHp: number;
  enemyHpRemaining: number;
  enemyMaxHp: number;
  score: number;
  bestScore: number;
  mode: GameMode;
}

export interface BattleActionCommand {
  type:
    | 'SPAWN_UNIT'
    | 'CANCEL_QUEUE'
    | 'BUILD_TURRET'
    | 'UPGRADE_TURRET'
    | 'SELL_TURRET'
    | 'UNLOCK_SLOT'
    | 'EVOLVE_ERA'
    | 'CAST_SPECIAL'
    | 'UPGRADE_DOCTRINE'
    | 'EMOTE';
  team: TeamId;
  slotIndex?: number;
  defId?: string;
  doctrineKey?: 'economy' | 'warfare' | 'fortress';
  emoteText?: string;
  /**
   * Online only: per-sender monotonically increasing sequence number. The authoritative
   * host echoes the highest processed value back in `WorldSyncSnapshot.ackedCmdSeq` so the
   * replica knows which of its predicted commands are already reflected in a snapshot.
   */
  seq?: number;
}

export interface WorldSyncSnapshot {
  elapsedTime: number;
  nextUnitUid: number;
  team1: TeamState;
  team2: TeamState;
  units: ActiveUnit[];
  activeBanner: { text: string; color: string; timer: number } | null;
  /** Random id of the host's match instance; changes when the host starts a new match. */
  epoch?: string;
  /** Monotonic snapshot counter within `epoch`; replicas drop stale/duplicate snapshots. */
  seq?: number;
  /** Highest command `seq` the host has processed from each team. */
  ackedCmdSeq?: { 1: number; 2: number };
}
