import {
  ERAS,
  GROUND_Y,
  TEAM1_BASE_X,
  TEAM2_BASE_X,
  WORLD_WIDTH,
  getTurretById,
} from './catalog';
import {
  applyBattleCommand,
  applyDamageToUnit,
  calculateAntiStallSupplyPerSecond,
  calculateArchetypeCounterMultiplier,
  calculateFortressHitComebackReward,
  calculateKillBountyMultiplier,
  calculateProximityBountyRatio,
  calculateSituationalSpecialProfile,
  checkWinCondition,
  createActiveUnit,
  createInitialTeamState,
  decideAICommand,
} from './rules';
import { soundEngine } from './audio';
import {
  ActiveUnit,
  AIDifficulty,
  BattleActionCommand,
  FloatingTextPoolItem,
  GameLifecycleState,
  GameMode,
  ParticlePoolItem,
  ProjectilePoolItem,
  RunSummarySnapshot,
  TeamId,
  TeamState,
  UnitDefinition,
  WorldSyncSnapshot,
} from './types';

const PARTICLE_POOL_SIZE = 512;
const PROJECTILE_POOL_SIZE = 256;
const FLOATING_TEXT_POOL_SIZE = 64;

export interface HUDStateSnapshot {
  team1: TeamState;
  team2: TeamState;
  playerTeam: TeamId;
  elapsedTime: number;
  cameraX: number;
  frontlineBonusPct: number;
  unitRadar: Array<{ x: number; team: TeamId; archetype: string }>;
  activeBanner: { text: string; color: string; timer: number } | null;
}

export class BattleSimulationEngine {
  public lifecycle: GameLifecycleState = 'title';
  public mode: GameMode = 'ai';
  public difficulty: AIDifficulty = 'normal';
  public playerTeam: TeamId = 1;

  public team1: TeamState = createInitialTeamState(1);
  public team2: TeamState = createInitialTeamState(2);
  public units: ActiveUnit[] = [];

  // Pre-allocated Zero-GC object pools
  public particles: ParticlePoolItem[] = [];
  public projectiles: ProjectilePoolItem[] = [];
  public floatingTexts: FloatingTextPoolItem[] = [];
  private particleCursor = 0;
  private projectileCursor = 0;
  private textCursor = 0;

  public nextUnitUid = 1;
  public elapsedTime = 0;
  public hitstopTimer = 0;
  public cameraTrauma = 0;
  public cameraX = 0;
  public targetCameraX = 0;
  public viewportWidth = 1280;
  public viewportHeight = 720;

  private aiDecisionTimer = 0;
  private titleAutoSpawnTimer = 0;
  private titlePanDir = 1;
  private bestScore = 2400;
  private outcomeDelayTimer = 0;
  private pendingWinner: TeamId | null = null;
  public activeBanner: { text: string; color: string; timer: number } | null = null;

  private onHudSync?: (snapshot: HUDStateSnapshot) => void;
  private onGameOver?: (summary: RunSummarySnapshot) => void;
  private onStateBroadcast?: (snapshot: WorldSyncSnapshot) => void;
  private hudSyncAccumulator = 0;
  private netSyncAccumulator = 0;

  // Ambient star/dust seeds
  private stars: Array<{ x: number; y: number; r: number; a: number }> = [];

  constructor(
    onHudSync?: (snapshot: HUDStateSnapshot) => void,
    onGameOver?: (summary: RunSummarySnapshot) => void,
    onStateBroadcast?: (snapshot: WorldSyncSnapshot) => void
  ) {
    this.onHudSync = onHudSync;
    this.onGameOver = onGameOver;
    this.onStateBroadcast = onStateBroadcast;

    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
      this.particles.push({
        active: false,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        gravity: 0,
        size: 3,
        color: '#ffffff',
        alpha: 1,
        life: 0,
        maxLife: 1,
        shape: 'circle',
      });
    }

    for (let i = 0; i < PROJECTILE_POOL_SIZE; i++) {
      this.projectiles.push({
        active: false,
        team: 1,
        type: 'stone',
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        gravity: 0,
        damage: 10,
        splashRadius: 0,
        knockback: 10,
        color: '#ffffff',
        radius: 5,
        life: 0,
        maxLife: 2,
        rotation: 0,
      });
    }

    for (let i = 0; i < FLOATING_TEXT_POOL_SIZE; i++) {
      this.floatingTexts.push({
        active: false,
        x: 0,
        y: 0,
        vy: -40,
        text: '',
        color: '#ffffff',
        life: 0,
        maxLife: 0.9,
        scale: 1,
      });
    }

    for (let i = 0; i < 65; i++) {
      this.stars.push({
        x: (i * 173) % WORLD_WIDTH,
        y: 25 + ((i * 97) % 240),
        r: 1 + (i % 2),
        a: 0.25 + (i % 5) * 0.14,
      });
    }

    this.setupTitleDemo();
  }

  public setupTitleDemo(): void {
    this.resetMatch('ai', 'normal', 1);
    this.lifecycle = 'title';
    this.team1.era = 1;
    this.team2.era = 1;
    // Spawn a lively clash right in the middle for the Title Screen live camera tour
    const u1 = createActiveUnit(this.nextUnitUid++, this.team1, 'era1_charger');
    const u2 = createActiveUnit(this.nextUnitUid++, this.team1, 'era1_ranger');
    const u3 = createActiveUnit(this.nextUnitUid++, this.team2, 'era1_swarmer');
    const u4 = createActiveUnit(this.nextUnitUid++, this.team2, 'era1_ranger');
    if (u1) {
      u1.x = WORLD_WIDTH * 0.42;
      this.units.push(u1);
    }
    if (u2) {
      u2.x = WORLD_WIDTH * 0.34;
      this.units.push(u2);
    }
    if (u3) {
      u3.x = WORLD_WIDTH * 0.56;
      this.units.push(u3);
    }
    if (u4) {
      u4.x = WORLD_WIDTH * 0.64;
      this.units.push(u4);
    }
    this.cameraX = WORLD_WIDTH * 0.22;
    this.targetCameraX = this.cameraX;
  }

  public resetMatch(
    mode: GameMode,
    difficulty: AIDifficulty,
    playerTeam: TeamId = 1,
    team1Name?: string,
    team2Name?: string
  ): void {
    this.mode = mode;
    this.difficulty = difficulty;
    this.playerTeam = playerTeam;
    this.team1 = createInitialTeamState(
      1,
      team1Name || (playerTeam === 1 ? 'Senin Sancağın' : 'Kuzey Komutanlığı')
    );
    this.team2 = createInitialTeamState(
      2,
      team2Name ||
        (mode === 'ai'
          ? difficulty === 'legendary'
            ? 'Efsanevi İmparator (YZ)'
            : difficulty === 'hard'
            ? 'Zorlu Komutan (YZ)'
            : 'Vadi Muhafızı (YZ)'
          : 'Rakip Komutan')
    );
    this.units = [];
    this.nextUnitUid = 1;
    this.elapsedTime = 0;
    this.hitstopTimer = 0;
    this.cameraTrauma = 0;
    this.outcomeDelayTimer = 0;
    this.pendingWinner = null;
    this.activeBanner = {
      text: `${ERAS[0].name.toUpperCase()} BAŞLADI`,
      color: ERAS[0].accentColor,
      timer: 2.2,
    };

    for (const p of this.particles) p.active = false;
    for (const pr of this.projectiles) pr.active = false;
    for (const ft of this.floatingTexts) ft.active = false;

    this.cameraX = playerTeam === 1 ? 0 : this.getMaxCameraX();
    this.targetCameraX = this.cameraX;
    this.emitHudSnapshot();
  }

  public getEffectiveViewWidth(): number {
    const scale = Math.max(0.25, this.viewportHeight / 720);
    return this.viewportWidth / scale;
  }

  public getMaxCameraX(): number {
    // Allow panning all the way to WORLD_WIDTH + 80 so right fortress has generous right padding
    return Math.max(0, WORLD_WIDTH + 80 - this.getEffectiveViewWidth());
  }

  public setCameraNormalized(norm: number): void {
    const clamped = Math.max(0, Math.min(1, norm));
    this.targetCameraX = clamped * this.getMaxCameraX();
  }

  public spawnParticle(
    x: number,
    y: number,
    vx: number,
    vy: number,
    color: string,
    size = 4,
    maxLife = 0.55,
    gravity = 240,
    shape: 'circle' | 'spark' | 'smoke' | 'ring' = 'circle'
  ): void {
    const p = this.particles[this.particleCursor];
    this.particleCursor = (this.particleCursor + 1) % PARTICLE_POOL_SIZE;
    p.active = true;
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.color = color;
    p.size = size;
    p.life = 0;
    p.maxLife = maxLife;
    p.gravity = gravity;
    p.alpha = 1;
    p.shape = shape;
  }

  public spawnBurst(
    x: number,
    y: number,
    count: number,
    color: string,
    speed = 180,
    size = 4
  ): void {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
      const spd = speed * (0.4 + Math.random() * 0.8);
      this.spawnParticle(
        x,
        y,
        Math.cos(angle) * spd,
        Math.sin(angle) * spd - 45,
        color,
        size * (0.7 + Math.random() * 0.6),
        0.35 + Math.random() * 0.35,
        280,
        i % 3 === 0 ? 'spark' : 'circle'
      );
    }
  }

  public spawnFloatingText(
    x: number,
    y: number,
    text: string,
    color: string,
    scale = 1
  ): void {
    const ft = this.floatingTexts[this.textCursor];
    this.textCursor = (this.textCursor + 1) % FLOATING_TEXT_POOL_SIZE;
    ft.active = true;
    ft.x = x + (Math.random() - 0.5) * 18;
    ft.y = y;
    ft.vy = -52;
    ft.text = text;
    ft.color = color;
    ft.life = 0;
    ft.maxLife = 0.85;
    ft.scale = scale;
  }

  public spawnProjectile(
    team: TeamId,
    type: ProjectilePoolItem['type'],
    x: number,
    y: number,
    vx: number,
    vy: number,
    gravity: number,
    damage: number,
    splashRadius: number,
    knockback: number,
    color: string,
    radius = 6
  ): void {
    const pr = this.projectiles[this.projectileCursor];
    this.projectileCursor = (this.projectileCursor + 1) % PROJECTILE_POOL_SIZE;
    pr.active = true;
    pr.team = team;
    pr.type = type;
    pr.x = x;
    pr.y = y;
    pr.vx = vx;
    pr.vy = vy;
    pr.gravity = gravity;
    pr.damage = damage;
    pr.splashRadius = splashRadius;
    pr.knockback = knockback;
    pr.color = color;
    pr.radius = radius;
    pr.life = 0;
    pr.maxLife = 6.5;
    pr.rotation = Math.atan2(vy, vx);
  }

  public executeCommand(cmd: BattleActionCommand): boolean {
    const targetTeam = cmd.team === 1 ? this.team1 : this.team2;

    if (cmd.type === 'EMOTE' && cmd.emoteText) {
      this.activeBanner = {
        text: `${targetTeam.name}: "${cmd.emoteText}"`,
        color: cmd.team === 1 ? '#38bdf8' : '#f87171',
        timer: 2.4,
      };
      soundEngine.playUiClick();
      this.emitHudSnapshot();
      return true;
    }

    if (cmd.type === 'CAST_SPECIAL') {
      if (targetTeam.specialCooldown > 0) return false;
      const warfareCdMult = Math.max(0.7, 1 - targetTeam.doctrines.warfareLevel * 0.06);
      targetTeam.specialCooldown = Math.round(targetTeam.specialMaxCooldown * warfareCdMult);
      this.triggerSpecialPower(targetTeam);
      this.emitHudSnapshot();
      return true;
    }

    const prevEra = targetTeam.era;
    const ok = applyBattleCommand(targetTeam, cmd);
    if (ok) {
      if (cmd.type === 'EVOLVE_ERA' && targetTeam.era > prevEra) {
        const newEra = ERAS[targetTeam.era];
        this.activeBanner = {
          text: `${targetTeam.name} → ${newEra.name.toUpperCase()}!`,
          color: newEra.accentColor,
          timer: 2.6,
        };
        const baseX = targetTeam.team === 1 ? TEAM1_BASE_X : TEAM2_BASE_X;
        this.spawnBurst(baseX, GROUND_Y - 90, 28, newEra.accentColor, 260, 6);
        this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.45);
        soundEngine.playEraEvolve();
      } else {
        soundEngine.playUiClick();
      }
      this.emitHudSnapshot();
    }
    return ok;
  }

  private triggerSpecialPower(teamState: TeamState): void {
    const era = ERAS[teamState.era];
    const enemyTeam = teamState.team === 1 ? this.team2 : this.team1;
    const profile = calculateSituationalSpecialProfile(teamState, enemyTeam, this.units);

    // Grant tactical supply bonus on cast so using your ultimate helps break sieges & fund counter-attacks
    teamState.gold += profile.supplyGoldBonus;
    teamState.totalGoldEarned += profile.supplyGoldBonus;
    teamState.xp += profile.supplyXpBonus;

    this.activeBanner = {
      text: `${era.specialName.toUpperCase()} · ${profile.modeLabel}!`,
      color: era.accentColor,
      timer: 3.4,
    };
    soundEngine.playSpecialPower();
    this.cameraTrauma = 1.0;
    this.hitstopTimer = 0.06;

    const dir = teamState.team === 1 ? 1 : -1;
    const baseX = teamState.team === 1 ? TEAM1_BASE_X : TEAM2_BASE_X;
    this.spawnFloatingText(
      baseX + dir * 70,
      GROUND_Y - 170,
      `+${profile.supplyGoldBonus}A İKMAL · KIYAMET ATEŞİ!`,
      era.accentColor,
      1.2
    );

    for (let i = 0; i < profile.projectileCount; i++) {
      const targetX = profile.targetXs[i] ?? WORLD_WIDTH * 0.5;
      // Spread spawnY across -45 to -1600 so the cataclysmic barrage rains down continuously for 3.5-4.5 seconds!
      const spawnY = -45 - i * 26 - (i % 4) * 18;
      const horizontalLead = dir * (profile.projectileType === 'arrow' ? 165 : 115);
      const vx = dir * (profile.projectileType === 'arrow' ? 225 : 155);
      const vy =
        profile.projectileType === 'orbital'
          ? 780 + (i % 5) * 35
          : profile.projectileType === 'arrow'
          ? 640 + (i % 5) * 30
          : 560 + (i % 5) * 28;

      this.spawnProjectile(
        teamState.team,
        profile.projectileType,
        targetX - horizontalLead,
        spawnY,
        vx,
        vy,
        190,
        profile.damagePerHit,
        profile.splashRadius,
        profile.knockback,
        era.accentColor,
        profile.projectileType === 'arrow' ? 8 : teamState.era >= 3 ? 13 : 11
      );
    }
  }

  public step(rawDt: number, cameraMoveDir: number): void {
    const dt = Math.min(rawDt, 0.05);

    // Camera movement works in playing & title
    if (this.lifecycle === 'title') {
      const maxCam = this.getMaxCameraX();
      this.targetCameraX += this.titlePanDir * 85 * dt;
      if (this.targetCameraX >= maxCam - 40) {
        this.targetCameraX = Math.max(0, maxCam - 40);
        this.titlePanDir = -1;
      } else if (this.targetCameraX <= 40) {
        this.targetCameraX = 40;
        this.titlePanDir = 1;
      }
      this.cameraX += (this.targetCameraX - this.cameraX) * Math.min(1, dt * 5);

      // Keep ambient battle alive in title background
      this.titleAutoSpawnTimer += dt;
      if (this.titleAutoSpawnTimer > 2.2) {
        this.titleAutoSpawnTimer = 0;
        if (this.units.filter((u) => u.team === 1).length < 4) {
          const slot = Math.floor(Math.random() * 3);
          const types = ['swarmer', 'ranger', 'charger'];
          const u = createActiveUnit(
            this.nextUnitUid++,
            this.team1,
            `era${this.team1.era}_${types[slot]}`
          );
          if (u) this.units.push(u);
        }
        if (this.units.filter((u) => u.team === 2).length < 4) {
          const slot = Math.floor(Math.random() * 3);
          const types = ['swarmer', 'ranger', 'charger'];
          const u = createActiveUnit(
            this.nextUnitUid++,
            this.team2,
            `era${this.team2.era}_${types[slot]}`
          );
          if (u) this.units.push(u);
        }
      }
      // Keep bases immortal in title screen
      this.team1.hp = this.team1.maxHp;
      this.team2.hp = this.team2.maxHp;
    } else if (this.lifecycle === 'playing') {
      const maxCam = this.getMaxCameraX();
      if (cameraMoveDir !== 0) {
        this.targetCameraX = Math.max(
          -60,
          Math.min(maxCam, this.targetCameraX + cameraMoveDir * 1080 * dt)
        );
      } else {
        this.targetCameraX = Math.max(-60, Math.min(maxCam, this.targetCameraX));
      }
      this.cameraX += (this.targetCameraX - this.cameraX) * Math.min(1, dt * 14);
    } else {
      return;
    }

    // Decay trauma, banner, hit flash in real dt
    this.cameraTrauma = Math.max(0, this.cameraTrauma - dt * 1.85);
    this.team1.baseHitFlash = Math.max(0, this.team1.baseHitFlash - dt);
    this.team2.baseHitFlash = Math.max(0, this.team2.baseHitFlash - dt);
    if (this.activeBanner) {
      this.activeBanner.timer -= dt;
      if (this.activeBanner.timer <= 0) this.activeBanner = null;
    }

    // Update trailing ghost bars
    this.team1.trailingHp += (this.team1.hp - this.team1.trailingHp) * Math.min(1, dt * 4.5);
    this.team2.trailingHp += (this.team2.hp - this.team2.trailingHp) * Math.min(1, dt * 4.5);

    // Handle defeat/victory short dramatic beat (0.45s)
    if (this.pendingWinner !== null && this.lifecycle === 'playing') {
      this.outcomeDelayTimer -= dt;
      this.stepParticlesAndTexts(dt);
      if (this.outcomeDelayTimer <= 0) {
        const winner = this.pendingWinner;
        this.pendingWinner = null;
        this.lifecycle = 'gameover';
        soundEngine.playOutcome(winner === this.playerTeam);
        const pTeam = this.playerTeam === 1 ? this.team1 : this.team2;
        const eTeam = this.playerTeam === 1 ? this.team2 : this.team1;
        const rawScore =
          Math.round(pTeam.xp * 1.2 + pTeam.totalGoldEarned * 0.5) +
          (winner === this.playerTeam ? 1500 : 250);
        this.bestScore = Math.max(this.bestScore, rawScore);
        this.onGameOver?.({
          winner,
          playerTeam: this.playerTeam,
          durationSec: Math.round(this.elapsedTime),
          playerEra: pTeam.era,
          enemyEra: eTeam.era,
          unitsDefeated: eTeam.unitsLost,
          unitsSpawned: pTeam.unitsSpawned,
          goldEarned: Math.round(pTeam.totalGoldEarned),
          playerHpRemaining: Math.max(0, Math.round(pTeam.hp)),
          playerMaxHp: pTeam.maxHp,
          enemyHpRemaining: Math.max(0, Math.round(eTeam.hp)),
          enemyMaxHp: eTeam.maxHp,
          score: rawScore,
          bestScore: this.bestScore,
          mode: this.mode,
        });
      }
      return;
    }

    // Hitstop pauses simulation physics while keeping particles & camera shake alive
    if (this.hitstopTimer > 0) {
      this.hitstopTimer = Math.max(0, this.hitstopTimer - dt);
      this.stepParticlesAndTexts(dt);
      return;
    }

    const simDt = dt;
    this.elapsedTime += simDt;

    // Step economy, regeneration, queues, and turrets for both teams
    this.stepTeamState(this.team1, simDt);
    this.stepTeamState(this.team2, simDt);

    // Step AI Commander if mode === 'ai' and playing
    if (this.lifecycle === 'playing' && this.mode === 'ai') {
      this.aiDecisionTimer += simDt;
      const aiInterval =
        this.difficulty === 'legendary' ? 0.55 : this.difficulty === 'hard' ? 0.8 : 1.05;
      if (this.aiDecisionTimer >= aiInterval) {
        this.aiDecisionTimer = 0;
        // AI Commander receives a steady war-supply budget to send relentless waves at the player,
        // while XP is earned primarily from combat + a small commander tactical progression
        const eraScale = Math.pow(1.85, this.team2.era);
        const supplyGold =
          (this.difficulty === 'legendary' ? 28 : this.difficulty === 'hard' ? 21 : 15) *
          eraScale;
        const supplyXp =
          (this.difficulty === 'legendary' ? 18 : this.difficulty === 'hard' ? 12 : 7) *
          eraScale;
        this.team2.gold += supplyGold;
        this.team2.xp += supplyXp;

        const aiCmd = decideAICommand(
          this.team2,
          this.team1,
          this.units,
          this.difficulty,
          this.elapsedTime
        );
        if (aiCmd) {
          this.executeCommand(aiCmd);
        }
      }
    }

    this.stepUnits(simDt);
    this.stepTurrets(this.team1, simDt);
    this.stepTurrets(this.team2, simDt);
    this.stepProjectiles(simDt);
    this.stepParticlesAndTexts(simDt);

    if (this.lifecycle === 'playing' && this.pendingWinner === null) {
      const win = checkWinCondition(this.team1, this.team2);
      if (win !== null) {
        this.pendingWinner = win;
        this.outcomeDelayTimer = 0.48;
        const defeatedBaseX = win === 1 ? TEAM2_BASE_X : TEAM1_BASE_X;
        this.spawnBurst(defeatedBaseX, GROUND_Y - 80, 42, '#f97316', 320, 8);
        this.cameraTrauma = 1.0;
        this.hitstopTimer = 0.07;
      }
    }

    this.hudSyncAccumulator += dt;
    if (this.hudSyncAccumulator >= 0.08) {
      this.hudSyncAccumulator = 0;
      this.emitHudSnapshot();
    }

    // Host (Team 1) periodically broadcasts authoritative world snapshot in Online Mode
    if (this.lifecycle === 'playing' && this.mode === 'online' && this.playerTeam === 1) {
      this.netSyncAccumulator += dt;
      if (this.netSyncAccumulator >= 0.1) {
        this.netSyncAccumulator = 0;
        this.onStateBroadcast?.(this.exportWorldSnapshot());
      }
    }
  }

  private stepTeamState(team: TeamState, dt: number): void {
    const enemyTeam = team.team === 1 ? this.team2 : this.team1;
    const myBaseX = team.team === 1 ? TEAM1_BASE_X : TEAM2_BASE_X;
    let allyCount = 0;
    let enemyCount = 0;
    let enemiesNearMyBase = 0;
    for (const u of this.units) {
      if (u.state === 'ko') continue;
      if (u.team === team.team) {
        allyCount++;
      } else {
        enemyCount++;
        if (Math.abs(u.x - myBaseX) < 680) {
          enemiesNearMyBase++;
        }
      }
    }

    // Dynamic Anti-Stall & Underdog Comeback Supply:
    // Standing idle with a rich treasury gives 0 gold, but if you are behind, outnumbered,
    // pinned at your gate, or out of units/gold, the game supplies emergency logistics so it NEVER stalls!
    if (this.lifecycle === 'playing') {
      const supplyPerSec = calculateAntiStallSupplyPerSecond(
        team,
        allyCount,
        enemyCount,
        enemiesNearMyBase,
        enemyTeam.era,
        enemyTeam.hp / Math.max(1, enemyTeam.maxHp)
      );
      if (supplyPerSec > 0) {
        const gain = supplyPerSec * dt;
        team.gold += gain;
        team.totalGoldEarned += gain;
      }
    }

    if (team.doctrines.fortressLevel > 0 && team.hp > 0 && team.hp < team.maxHp) {
      team.hp = Math.min(
        team.maxHp,
        team.hp + team.doctrines.fortressLevel * (5 + team.era * 4.5) * dt
      );
    }

    if (team.specialCooldown > 0) {
      // Situational Cooldown Acceleration: if enemies are pressing your base, special power charges up to 45% faster!
      const siegeHaste = enemiesNearMyBase >= 2 ? 1.45 : enemiesNearMyBase === 1 ? 1.2 : 1.0;
      team.specialCooldown = Math.max(0, team.specialCooldown - dt * siegeHaste);
    }

    if (team.queue.length > 0) {
      // Check if spawn zone is congested by friendly units
      const spawnX = team.team === 1 ? 250 : WORLD_WIDTH - 250;
      const blockingAlly = this.units.some(
        (u) => u.team === team.team && u.state !== 'ko' && Math.abs(u.x - spawnX) < 34
      );
      const head = team.queue[0];
      head.remainingTime = Math.max(0, head.remainingTime - dt);
      if (head.remainingTime <= 0 && !blockingAlly) {
        team.queue.shift();
        const spawned = createActiveUnit(this.nextUnitUid++, team, head.unitDefId);
        if (spawned) {
          this.units.push(spawned);
          team.unitsSpawned += 1;
          this.spawnBurst(spawned.x, GROUND_Y - 24, 6, spawned.accentColor, 95, 3);
          if (this.lifecycle === 'playing') {
            soundEngine.playSpawn();
          }
        }
      }
    }
  }

  private stepTurrets(team: TeamState, dt: number): void {
    const baseX = team.team === 1 ? TEAM1_BASE_X : TEAM2_BASE_X;
    const dir = team.team === 1 ? 1 : -1;
    const fortressDocLevel = team.doctrines.fortressLevel;
    const warfareDocLevel = team.doctrines.warfareLevel;

    for (let i = 0; i < 4; i++) {
      const t = team.turrets[i];
      if (!t) continue;
      const def = getTurretById(t.turretDefId);
      if (!def) continue;

      t.recoil = Math.max(0, t.recoil - dt * 6);
      t.cooldown = Math.max(0, t.cooldown - dt);

      const turretX = baseX + dir * 24;
      const turretY = GROUND_Y - 115 - i * 44;
      const effectiveRange = def.range * (1 + fortressDocLevel * 0.06);

      // Find nearest enemy unit within range
      let bestTarget: ActiveUnit | null = null;
      let bestDist = effectiveRange;
      for (const u of this.units) {
        if (u.team === team.team || u.state === 'ko') continue;
        const d = Math.abs(u.x - turretX);
        if (d <= bestDist) {
          bestDist = d;
          bestTarget = u;
        }
      }

      if (bestTarget) {
        const dx = bestTarget.x - turretX;
        const dy = bestTarget.y - bestTarget.height * 0.5 - turretY;
        t.aimAngle = Math.atan2(dy, dx);

        if (t.cooldown <= 0) {
          const levelMult =
            (1 + (t.level - 1) * 0.35) *
            (1 + warfareDocLevel * 0.12) *
            (bestDist < 340 ? 1.25 : 1.0); // +25% Point-Blank Gate Defense bonus!
          const fireRateBoost = (1 + (t.level - 1) * 0.14) * (1 + fortressDocLevel * 0.08);
          t.cooldown = def.fireInterval / fireRateBoost;
          t.recoil = 1;

          const speed =
            def.projectileType === 'ion' || def.projectileType === 'tesla'
              ? 880
              : def.projectileType === 'bullet'
              ? 720
              : 540;
          const dist = Math.hypot(dx, dy) || 1;
          const grav =
            def.projectileType === 'stone' || def.projectileType === 'cannon' ? 220 : 0;
          const vyLift = grav > 0 ? -0.5 * grav * (dist / speed) : 0;

          this.spawnProjectile(
            team.team,
            def.projectileType,
            turretX + Math.cos(t.aimAngle) * 20,
            turretY + Math.sin(t.aimAngle) * 20,
            (dx / dist) * speed,
            (dy / dist) * speed + vyLift,
            grav,
            Math.round(def.damage * levelMult),
            def.splashRadius,
            def.splashRadius > 50 ? 42 : 24,
            def.accentColor,
            def.splashRadius > 50 ? 7 : 5
          );
          if (this.lifecycle === 'playing') {
            soundEngine.playShot(def.projectileType);
          }
        }
      }
    }
  }

  private stepUnits(dt: number): void {
    // Sort units by X so frontline spacing stays clean
    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i];
      u.hitFlashTimer = Math.max(0, u.hitFlashTimer - dt);
      u.trailingHp += (u.hp - u.trailingHp) * Math.min(1, dt * 6);
      u.scaleX += (1 - u.scaleX) * Math.min(1, dt * 12);
      u.scaleY += (1 - u.scaleY) * Math.min(1, dt * 12);

      // Regenerate shield slightly for Colossus / Future units out of hit flash
      if (u.state !== 'ko' && u.maxShield > 0 && u.shield < u.maxShield && u.hitFlashTimer <= 0) {
        u.shield = Math.min(u.maxShield, u.shield + u.maxShield * 0.05 * dt);
      }

      if (u.state === 'ko') {
        u.koTimer -= dt;
        u.x += u.vx * dt;
        u.y += u.koVy * dt;
        u.koVy += 520 * dt;
        u.koAngle += (u.team === 1 ? -5.5 : 5.5) * dt;
        if (u.koTimer <= 0) {
          this.units.splice(i, 1);
        }
        continue;
      }

      const dir = u.team === 1 ? 1 : -1;
      const enemyBaseX = u.team === 1 ? TEAM2_BASE_X : TEAM1_BASE_X;
      u.attackCooldown = Math.max(0, u.attackCooldown - dt);

      // Find closest enemy unit in front
      let nearestEnemy: ActiveUnit | null = null;
      let nearestDist = Infinity;
      for (const other of this.units) {
        if (other.team === u.team || other.state === 'ko') continue;
        const delta = (other.x - u.x) * dir;
        if (delta >= -20 && delta < nearestDist) {
          nearestDist = Math.max(0, delta - (u.width + other.width) * 0.42);
          nearestEnemy = other;
        }
      }

      const distToBase = Math.max(0, (enemyBaseX - u.x) * dir - 75);
      const effectiveTargetDist = Math.min(nearestDist, distToBase);
      const inAttackRange = effectiveTargetDist <= u.attackRange;

      // Distinct Archetype Policy 1: Ranged Marksman / Kiter backs up if enemy Swarmer gets too close
      if (
        u.archetype === 'ranger' &&
        nearestEnemy &&
        nearestDist < 75 &&
        u.attackCooldown > 0.25
      ) {
        const retreatX = u.x - dir * u.moveSpeed * 0.55 * dt;
        const homeLimit = u.team === 1 ? TEAM1_BASE_X + 95 : TEAM2_BASE_X - 95;
        if ((u.team === 1 && retreatX > homeLimit) || (u.team === 2 && retreatX < homeLimit)) {
          u.x = retreatX;
          u.walkDistance += u.moveSpeed * 0.55 * dt;
        }
      }

      if (u.state === 'windup') {
        u.stateTimer -= dt;
        if (u.stateTimer <= 0) {
          this.performUnitAttack(u, nearestEnemy, distToBase <= u.attackRange);
          u.state = 'recover';
          u.stateTimer = 0.16;
          u.attackCooldown = u.attackInterval;
        }
        continue;
      }

      if (u.state === 'recover') {
        u.stateTimer -= dt;
        if (u.stateTimer <= 0) {
          u.state = 'walk';
        }
        continue;
      }

      if (inAttackRange) {
        u.charging = false;
        if (u.attackCooldown <= 0) {
          u.state = 'windup';
          u.stateTimer = u.windupTime;
          u.scaleX = 0.88;
          u.scaleY = 1.14;
        }
      } else {
        // Check friendly spacing directly ahead (allow ranged units to walk closer behind frontline)
        let blockedByAlly = false;
        const spacingGap = u.archetype === 'ranger' ? 22 : 34;
        for (const ally of this.units) {
          if (ally.uid === u.uid || ally.team !== u.team || ally.state === 'ko') continue;
          const ahead = (ally.x - u.x) * dir;
          if (ahead > 0 && ahead < (u.width + ally.width) * 0.38 + spacingGap * 0.45) {
            blockedByAlly = true;
            break;
          }
        }

        if (!blockedByAlly) {
          // Distinct Archetype Policy 2: Charger accelerates into a high-speed charge when spotting enemies within 260px
          let speedMult = 1;
          if (u.archetype === 'charger' && u.chargeReady && effectiveTargetDist < 260) {
            u.charging = true;
            speedMult = 1.55;
            if (Math.random() < 0.35) {
              this.spawnParticle(
                u.x - dir * 18,
                GROUND_Y - 4,
                -dir * 60,
                -25,
                u.accentColor,
                3.5,
                0.28,
                80
              );
            }
          }
          const stepX = dir * u.moveSpeed * speedMult * dt;
          u.x += stepX;
          u.walkDistance += Math.abs(stepX);
        }
      }
    }
  }

  private performUnitAttack(
    attacker: ActiveUnit,
    targetUnit: ActiveUnit | null,
    hittingBase: boolean
  ): void {
    const dir = attacker.team === 1 ? 1 : -1;
    const muzzleX = attacker.x + dir * (attacker.width * 0.45);
    const muzzleY = attacker.y - attacker.height * 0.58;

    // Lunge squash-and-stretch
    attacker.scaleX = 1.22;
    attacker.scaleY = 0.82;

    // Ranged projectile unit
    if (attacker.projectileType) {
      const speed =
        attacker.projectileType === 'laser' || attacker.projectileType === 'plasma'
          ? 840
          : attacker.projectileType === 'bullet' || attacker.projectileType === 'rocket'
          ? 640
          : 510;
      const grav =
        attacker.projectileType === 'stone' || attacker.projectileType === 'arrow' ? 140 : 0;
      const dist = targetUnit ? Math.abs(targetUnit.x - muzzleX) : attacker.attackRange;
      const vyLift = grav > 0 ? -0.5 * grav * (dist / speed) : 0;

      this.spawnProjectile(
        attacker.team,
        attacker.projectileType,
        muzzleX,
        muzzleY,
        dir * speed,
        vyLift,
        grav,
        attacker.damage,
        attacker.splashRadius,
        attacker.knockbackPower,
        attacker.accentColor,
        attacker.projectileType === 'plasma' ? 8 : 5
      );
      if (this.lifecycle === 'playing') {
        soundEngine.playShot(attacker.projectileType);
      }
      return;
    }

    // Melee / Charger / Colossus direct impact
    let bonusMultiplier = 1;
    if (attacker.archetype === 'charger' && attacker.charging) {
      bonusMultiplier = 1.65;
      attacker.charging = false;
      attacker.chargeReady = false;
      this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.25);
      this.hitstopTimer = Math.max(this.hitstopTimer, 0.035);
      this.spawnParticle(
        muzzleX,
        GROUND_Y - 24,
        0,
        0,
        attacker.accentColor,
        42,
        0.28,
        0,
        'ring'
      );
    } else if (attacker.archetype === 'colossus') {
      this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.3);
      this.hitstopTimer = Math.max(this.hitstopTimer, 0.04);
      this.spawnParticle(
        muzzleX,
        GROUND_Y - 12,
        0,
        0,
        attacker.accentColor,
        64,
        0.32,
        0,
        'ring'
      );
    }

    const totalDmg = Math.round(attacker.damage * bonusMultiplier);

    if (targetUnit) {
      this.dealSplashOrSingleDamage(
        attacker.team,
        targetUnit.x,
        GROUND_Y - targetUnit.height * 0.5,
        totalDmg,
        attacker.splashRadius,
        dir,
        attacker.knockbackPower,
        targetUnit,
        attacker.archetype
      );
    } else if (hittingBase) {
      this.damageEnemyBase(attacker.team, totalDmg);
    }
  }

  private dealSplashOrSingleDamage(
    attackerTeam: TeamId,
    impactX: number,
    impactY: number,
    damage: number,
    splashRadius: number,
    dir: number,
    knockback: number,
    directTarget?: ActiveUnit,
    attackerArchetype?: UnitDefinition['archetype']
  ): void {
    const myTeamState = attackerTeam === 1 ? this.team1 : this.team2;
    const enemyTeamState = attackerTeam === 1 ? this.team2 : this.team1;
    const isHeavy = damage >= 95 || splashRadius >= 55;

    this.spawnBurst(
      impactX,
      impactY,
      isHeavy ? 14 : 6,
      isHeavy ? '#fbbf24' : '#f8fafc',
      isHeavy ? 210 : 120,
      isHeavy ? 5 : 3.5
    );
    if (this.lifecycle === 'playing') {
      soundEngine.playHit(isHeavy);
    }

    if (splashRadius > 0) {
      for (const u of this.units) {
        if (u.team === attackerTeam || u.state === 'ko') continue;
        const dist = Math.abs(u.x - impactX);
        if (dist <= splashRadius) {
          const falloff =
            u === directTarget ? 1 : Math.max(0.38, 1 - dist / (splashRadius * 1.2));
          const counter = calculateArchetypeCounterMultiplier(attackerArchetype, u.archetype);
          const effectiveDmg = Math.round(damage * falloff * counter.damageMult);
          const res = applyDamageToUnit(
            u,
            effectiveDmg,
            dir,
            knockback,
            counter.armorPenetration
          );
          if (res.actualDamage > 0) {
            this.spawnFloatingText(
              u.x,
              u.y - u.height - 8,
              `-${res.actualDamage}`,
              isHeavy ? '#fbbf24' : '#f87171',
              isHeavy ? 1.15 : 0.95
            );
          }
          if (res.killed) {
            this.rewardKill(myTeamState, enemyTeamState, u);
          }
        }
      }
      // Also check if splash hits enemy base (sky barrages obliterate enemy units, while dealing light structural shake to the castle)
      const enemyBaseX = attackerTeam === 1 ? TEAM2_BASE_X : TEAM1_BASE_X;
      if (Math.abs(enemyBaseX - impactX) <= splashRadius + 55) {
        const baseSplashRatio = splashRadius >= 145 ? 0.022 : 0.55;
        this.damageEnemyBase(attackerTeam, Math.max(4, Math.round(damage * baseSplashRatio)));
      }
    } else if (directTarget) {
      const counter = calculateArchetypeCounterMultiplier(
        attackerArchetype,
        directTarget.archetype
      );
      const effectiveDmg = Math.round(damage * counter.damageMult);
      const res = applyDamageToUnit(
        directTarget,
        effectiveDmg,
        dir,
        knockback,
        counter.armorPenetration
      );
      if (res.actualDamage > 0) {
        this.spawnFloatingText(
          directTarget.x,
          directTarget.y - directTarget.height - 8,
          `-${res.actualDamage}`,
          counter.damageMult > 1 ? '#fde047' : '#f87171',
          counter.damageMult > 1 ? 1.08 : 0.95
        );
      }
      if (res.killed) {
        this.rewardKill(myTeamState, enemyTeamState, directTarget);
      }
    }
  }

  private rewardKill(
    killerTeam: TeamState,
    victimTeam: TeamState,
    victim: ActiveUnit
  ): void {
    victimTeam.unitsLost += 1;
    const bountyMult = calculateKillBountyMultiplier(killerTeam);
    const prox = calculateProximityBountyRatio(killerTeam.team, victim.x);

    // If the killer is pinned at their own base and outnumbered, grant a Last-Stand Defense floor (85%)
    const allyCount = this.units.filter((u) => u.team === killerTeam.team && u.state !== 'ko').length;
    const enemyCount = this.units.filter((u) => u.team !== killerTeam.team && u.state !== 'ko').length;
    const effectiveMult =
      prox.progress < 0.25 && enemyCount > allyCount
        ? Math.max(0.85, prox.multiplier)
        : prox.multiplier;
    const effectivePct = Math.round(effectiveMult * 100);

    const goldEarned = Math.max(
      6,
      Math.round(victim.rewardGold * 1.65 * bountyMult * effectiveMult)
    );
    const xpEarned = Math.max(
      8,
      Math.round(victim.rewardXp * 1.35 * bountyMult * (0.75 + prox.progress * 0.65))
    );
    killerTeam.gold += goldEarned;
    killerTeam.totalGoldEarned += goldEarned;
    killerTeam.xp += xpEarned;
    this.spawnBurst(victim.x, victim.y - victim.height * 0.5, 14, victim.accentColor, 190, 4.5);
    if (killerTeam.team === this.playerTeam) {
      const tagColor =
        effectivePct >= 145
          ? '#4ade80'
          : effectivePct <= 70
          ? '#94a3b8'
          : '#fde047';
      this.spawnFloatingText(
        victim.x,
        victim.y - victim.height - 26,
        `+${goldEarned}A (%${effectivePct}) · +${xpEarned}XP`,
        tagColor,
        effectivePct >= 145 ? 1.15 : 1.0
      );
    }
  }

  private damageEnemyBase(attackerTeam: TeamId, damage: number): void {
    const attackerState = attackerTeam === 1 ? this.team1 : this.team2;
    const enemyTeam = attackerTeam === 1 ? this.team2 : this.team1;
    const baseX = attackerTeam === 1 ? TEAM2_BASE_X : TEAM1_BASE_X;
    if (this.lifecycle === 'title') return;

    // Fortress Doctrine reduces incoming castle damage by 6% per level
    const armorReduction = Math.min(0.3, enemyTeam.doctrines.fortressLevel * 0.06);
    const finalDamage = Math.max(1, Math.round(damage * (1 - armorReduction)));

    enemyTeam.hp = Math.max(0, enemyTeam.hp - finalDamage);
    enemyTeam.baseHitFlash = 0.08;
    this.spawnBurst(baseX, GROUND_Y - 70, 10, '#f97316', 165, 4.5);
    this.spawnFloatingText(baseX, GROUND_Y - 140, `-${finalDamage}`, '#fb923c', 1.2);
    this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.18);
    soundEngine.playHit(true);

    // Grant Defender Comeback Gold, XP & Special Cooldown boost when their fortress is being hit!
    const comeback = calculateFortressHitComebackReward(enemyTeam, attackerState, finalDamage);
    enemyTeam.gold += comeback.comebackGold;
    enemyTeam.totalGoldEarned += comeback.comebackGold;
    enemyTeam.xp += comeback.comebackXp;
    if (enemyTeam.specialCooldown > 0) {
      enemyTeam.specialCooldown = Math.max(
        0,
        enemyTeam.specialCooldown - comeback.cooldownReductionSec
      );
    }
    if (enemyTeam.team === this.playerTeam) {
      this.spawnFloatingText(
        baseX,
        GROUND_Y - 175,
        `+${comeback.comebackGold}A DİRENİŞ İKMALİ`,
        '#38bdf8',
        0.95
      );
    }
  }

  private stepProjectiles(dt: number): void {
    for (const pr of this.projectiles) {
      if (!pr.active) continue;
      pr.life += dt;
      if (pr.life >= pr.maxLife) {
        pr.active = false;
        continue;
      }

      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      pr.vy += pr.gravity * dt;
      pr.rotation = Math.atan2(pr.vy, pr.vx);

      // Trail particles for special / missiles
      if (
        (pr.type === 'meteor' ||
          pr.type === 'rocket' ||
          pr.type === 'missile' ||
          pr.type === 'orbital' ||
          pr.type === 'plasma') &&
        Math.random() < 0.65
      ) {
        this.spawnParticle(
          pr.x,
          pr.y,
          -pr.vx * 0.12,
          -pr.vy * 0.12,
          pr.color,
          pr.radius * 0.85,
          0.24,
          0
        );
      }

      const dir = pr.team === 1 ? 1 : -1;
      const enemyBaseX = pr.team === 1 ? TEAM2_BASE_X : TEAM1_BASE_X;

      // Check unit collision
      let hitUnit: ActiveUnit | undefined;
      for (const u of this.units) {
        if (u.team === pr.team || u.state === 'ko') continue;
        if (
          Math.abs(pr.x - u.x) <= u.width * 0.55 + pr.radius &&
          pr.y >= u.y - u.height - pr.radius &&
          pr.y <= u.y + 10
        ) {
          hitUnit = u;
          break;
        }
      }

      if (hitUnit) {
        this.dealSplashOrSingleDamage(
          pr.team,
          pr.x,
          pr.y,
          pr.damage,
          pr.splashRadius,
          dir,
          pr.knockback,
          hitUnit
        );
        pr.active = false;
        continue;
      }

      // Check enemy base collision
      if (Math.abs(pr.x - enemyBaseX) <= 62 && pr.y >= GROUND_Y - 190 && pr.y <= GROUND_Y + 10) {
        if (pr.splashRadius >= 145) {
          this.dealSplashOrSingleDamage(
            pr.team,
            pr.x,
            pr.y,
            pr.damage,
            pr.splashRadius,
            dir,
            pr.knockback
          );
        } else {
          this.damageEnemyBase(pr.team, pr.damage);
        }
        pr.active = false;
        continue;
      }

      // Check ground impact
      if (pr.y >= GROUND_Y) {
        if (pr.splashRadius > 0) {
          this.dealSplashOrSingleDamage(
            pr.team,
            pr.x,
            GROUND_Y - 6,
            pr.damage,
            pr.splashRadius,
            dir,
            pr.knockback
          );
          if (pr.type === 'meteor' || pr.type === 'orbital' || pr.type === 'airstrike') {
            this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.22);
            this.spawnParticle(pr.x, GROUND_Y - 8, 0, 0, pr.color, 72, 0.35, 0, 'ring');
          }
        } else {
          this.spawnBurst(pr.x, GROUND_Y - 4, 4, pr.color, 75, 2.5);
        }
        pr.active = false;
      }
    }
  }

  private stepParticlesAndTexts(dt: number): void {
    for (const p of this.particles) {
      if (!p.active) continue;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.active = false;
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.gravity * dt;
      p.alpha = Math.max(0, 1 - p.life / p.maxLife);
    }

    for (const ft of this.floatingTexts) {
      if (!ft.active) continue;
      ft.life += dt;
      if (ft.life >= ft.maxLife) {
        ft.active = false;
        continue;
      }
      ft.y += ft.vy * dt;
    }
  }

  public emitHudSnapshot(): void {
    if (!this.onHudSync) return;
    // Compute player's current frontline position for the HUD Taarruz Ganimeti % indicator
    let frontlineX = this.playerTeam === 1 ? TEAM1_BASE_X + 95 : TEAM2_BASE_X - 95;
    for (const u of this.units) {
      if (u.team === this.playerTeam && u.state !== 'ko') {
        if (this.playerTeam === 1 && u.x > frontlineX) frontlineX = u.x;
        if (this.playerTeam === 2 && u.x < frontlineX) frontlineX = u.x;
      }
    }
    const frontlineBonusPct = calculateProximityBountyRatio(
      this.playerTeam,
      frontlineX
    ).bonusPercent;

    this.onHudSync({
      team1: {
        ...this.team1,
        turrets: [...this.team1.turrets],
        queue: [...this.team1.queue],
        doctrines: { ...this.team1.doctrines },
      },
      team2: {
        ...this.team2,
        turrets: [...this.team2.turrets],
        queue: [...this.team2.queue],
        doctrines: { ...this.team2.doctrines },
      },
      playerTeam: this.playerTeam,
      elapsedTime: this.elapsedTime,
      cameraX: this.cameraX,
      frontlineBonusPct,
      unitRadar: this.units
        .filter((u) => u.state !== 'ko')
        .map((u) => ({ x: u.x, team: u.team, archetype: u.archetype })),
      activeBanner: this.activeBanner ? { ...this.activeBanner } : null,
    });
  }

  public exportWorldSnapshot(): WorldSyncSnapshot {
    return {
      elapsedTime: this.elapsedTime,
      nextUnitUid: this.nextUnitUid,
      team1: {
        ...this.team1,
        turrets: this.team1.turrets.map((t) => (t ? { ...t } : null)),
        queue: this.team1.queue.map((q) => ({ ...q })),
        doctrines: { ...this.team1.doctrines },
      },
      team2: {
        ...this.team2,
        turrets: this.team2.turrets.map((t) => (t ? { ...t } : null)),
        queue: this.team2.queue.map((q) => ({ ...q })),
        doctrines: { ...this.team2.doctrines },
      },
      units: this.units.map((u) => ({ ...u })),
      activeBanner: this.activeBanner ? { ...this.activeBanner } : null,
    };
  }

  public applyWorldSnapshot(snap: WorldSyncSnapshot): void {
    if (!snap || typeof snap.elapsedTime !== 'number') return;
    this.elapsedTime = snap.elapsedTime;
    this.nextUnitUid = Math.max(this.nextUnitUid, snap.nextUnitUid || 1);

    // Preserve smooth trailingHp while syncing authoritative team stats
    const t1Trailing = this.team1.trailingHp;
    const t2Trailing = this.team2.trailingHp;
    this.team1 = {
      ...snap.team1,
      trailingHp: t1Trailing,
      turrets: snap.team1.turrets.map((t) => (t ? { ...t } : null)),
      queue: snap.team1.queue.map((q) => ({ ...q })),
      doctrines: { ...snap.team1.doctrines },
    };
    this.team2 = {
      ...snap.team2,
      trailingHp: t2Trailing,
      turrets: snap.team2.turrets.map((t) => (t ? { ...t } : null)),
      queue: snap.team2.queue.map((q) => ({ ...q })),
      doctrines: { ...snap.team2.doctrines },
    };

    // Reconcile active units smoothly by uid
    const existingByUid = new Map<number, ActiveUnit>();
    for (const u of this.units) {
      existingByUid.set(u.uid, u);
    }

    this.units = (snap.units || []).map((incoming) => {
      const prev = existingByUid.get(incoming.uid);
      if (prev) {
        let blendedX = incoming.x;
        const diff = incoming.x - prev.x;
        if (Math.abs(diff) < 3 || incoming.state === 'windup' || incoming.state === 'recover' || incoming.state === 'ko') {
          blendedX = incoming.x;
        } else if (Math.abs(diff) < 55) {
          blendedX = prev.x + diff * 0.6;
        }

        return {
          ...incoming,
          x: blendedX,
          walkDistance: prev.walkDistance,
          scaleX: prev.scaleX,
          scaleY: prev.scaleY,
          trailingHp: prev.trailingHp,
          hitFlashTimer: Math.max(prev.hitFlashTimer, incoming.hitFlashTimer),
        };
      }
      return { ...incoming };
    });

    if (snap.activeBanner) {
      this.activeBanner = { ...snap.activeBanner };
    }
    this.emitHudSnapshot();
  }

  public render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    this.viewportWidth = width;
    this.viewportHeight = height;

    ctx.save();

    // Scale virtual vertical coordinate so GROUND_Y sits comfortably above bottom dock
    const virtualHeight = 720;
    const scale = height / virtualHeight;
    const maxCam = this.getMaxCameraX();
    const clampedCamX = Math.max(-60, Math.min(maxCam, this.cameraX));

    // Apply decaying trauma^2 camera shake
    const shakeMag = this.cameraTrauma * this.cameraTrauma * 14;
    const shakeX = (Math.random() * 2 - 1) * shakeMag;
    const shakeY = (Math.random() * 2 - 1) * shakeMag;

    // 1. Sky Gradient blended from dominant era
    const domEra = ERAS[Math.max(this.team1.era, this.team2.era)];
    const skyGrad = ctx.createLinearGradient(0, 0, 0, height);
    skyGrad.addColorStop(0, domEra.skyTop);
    skyGrad.addColorStop(0.75, domEra.skyBottom);
    skyGrad.addColorStop(1, '#090c12');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, width, height);

    ctx.scale(scale, scale);
    ctx.translate(shakeX, shakeY);

    // 2. Parallax Starfield & Atmospheric Embers
    for (const s of this.stars) {
      const sx = ((s.x - clampedCamX * 0.15) % WORLD_WIDTH + WORLD_WIDTH) % WORLD_WIDTH;
      ctx.fillStyle = `rgba(248, 250, 252, ${s.a})`;
      ctx.beginPath();
      ctx.arc(sx, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 3. Far Parallax Mountains (0.28x camera speed)
    ctx.save();
    ctx.translate(-clampedCamX * 0.28, 0);
    ctx.fillStyle = '#131926';
    ctx.beginPath();
    ctx.moveTo(-200, GROUND_Y);
    const peaks = [0, 280, 560, 890, 1220, 1560, 1890, 2240, 2600, 2900];
    const heights = [310, 210, 340, 190, 295, 225, 330, 205, 290, 320];
    for (let i = 0; i < peaks.length; i++) {
      ctx.lineTo(peaks[i], heights[i]);
    }
    ctx.lineTo(3000, GROUND_Y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // 4. Midground Ridges & Era Monuments (0.55x camera speed)
    ctx.save();
    ctx.translate(-clampedCamX * 0.55, 0);
    ctx.fillStyle = '#1b2232';
    ctx.beginPath();
    ctx.moveTo(-200, GROUND_Y);
    for (let x = -100; x <= WORLD_WIDTH + 200; x += 220) {
      const h = GROUND_Y - 110 - ((x * 13) % 75);
      ctx.lineTo(x, h);
    }
    ctx.lineTo(WORLD_WIDTH + 300, GROUND_Y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // 5. World Space Camera Transform
    ctx.save();
    ctx.translate(-clampedCamX, 0);

    // Battlefield Lane & Ground Strata
    const groundGrad = ctx.createLinearGradient(0, GROUND_Y - 8, 0, virtualHeight);
    groundGrad.addColorStop(0, '#2c3440');
    groundGrad.addColorStop(0.12, '#1c212b');
    groundGrad.addColorStop(1, '#0b0e14');
    ctx.fillStyle = groundGrad;
    ctx.fillRect(0, GROUND_Y - 4, WORLD_WIDTH, virtualHeight - GROUND_Y + 40);

    // Subtle distance markers on the battlefield floor
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 2;
    for (let x = 300; x < WORLD_WIDTH - 250; x += 150) {
      ctx.beginPath();
      ctx.moveTo(x, GROUND_Y);
      ctx.lineTo(x - 16, GROUND_Y + 34);
      ctx.stroke();
    }

    // Center Battlefield Obelisk / Midline Marker
    const midX = WORLD_WIDTH / 2;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.09)';
    ctx.beginPath();
    ctx.moveTo(midX - 14, GROUND_Y);
    ctx.lineTo(midX - 5, GROUND_Y - 95);
    ctx.lineTo(midX, GROUND_Y - 112);
    ctx.lineTo(midX + 5, GROUND_Y - 95);
    ctx.lineTo(midX + 14, GROUND_Y);
    ctx.closePath();
    ctx.fill();

    // 6. Render Fortresses & Turrets
    this.renderFortress(ctx, this.team1, TEAM1_BASE_X, 1);
    this.renderFortress(ctx, this.team2, TEAM2_BASE_X, -1);

    // 7. Render Active Units
    for (const u of this.units) {
      this.renderUnit(ctx, u);
    }

    // 8. Render Projectiles
    for (const pr of this.projectiles) {
      if (!pr.active) continue;
      this.renderProjectile(ctx, pr);
    }

    // 9. Render Pooled Particles
    for (const p of this.particles) {
      if (!p.active) continue;
      ctx.save();
      ctx.globalAlpha = p.alpha;
      if (p.shape === 'ring') {
        const currentR = p.size * (0.25 + 0.75 * (p.life / p.maxLife));
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 3.5 * p.alpha;
        ctx.beginPath();
        ctx.arc(p.x, p.y, currentR, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // 10. Render Pooled Floating Combat Text
    ctx.font = '700 15px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    for (const ft of this.floatingTexts) {
      if (!ft.active) continue;
      const alpha = Math.max(0, 1 - ft.life / ft.maxLife);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(ft.text, ft.x, ft.y);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    }

    ctx.restore(); // end world camera transform
    ctx.restore(); // end scale
  }

  private renderFortress(
    ctx: CanvasRenderingContext2D,
    team: TeamState,
    baseX: number,
    dir: number
  ): void {
    const era = ERAS[team.era];
    ctx.save();
    ctx.translate(baseX, GROUND_Y);

    const flash = team.baseHitFlash > 0;
    const mainColor = flash
      ? '#ffffff'
      : team.era === 0
      ? '#5c4033'
      : team.era === 1
      ? '#475569'
      : team.era === 2
      ? '#573b2e'
      : team.era === 3
      ? '#334155'
      : '#0f172a';
    const trimColor = flash ? '#fde047' : era.accentColor;

    // Main Bastion Silhouette
    ctx.fillStyle = mainColor;
    ctx.strokeStyle = trimColor;
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.moveTo(-70, 0);
    ctx.lineTo(-62, -185 - team.era * 12);
    ctx.lineTo(58, -185 - team.era * 12);
    ctx.lineTo(70, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Era-specific roof/spire
    ctx.fillStyle = trimColor;
    if (team.era === 0) {
      // Megalithic stone arch & tusks
      ctx.fillRect(-52, -198, 104, 16);
    } else if (team.era === 1) {
      // Battlements
      for (let bx = -60; bx <= 45; bx += 26) {
        ctx.fillRect(bx, -212, 16, 18);
      }
    } else if (team.era === 2) {
      // Imperial dome
      ctx.beginPath();
      ctx.arc(0, -195, 46, Math.PI, 0);
      ctx.fill();
    } else if (team.era === 3) {
      // Radar & armored bunker sloped crown
      ctx.fillRect(-56, -215, 112, 14);
      ctx.beginPath();
      ctx.arc(dir * -15, -230, 18, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      // Cyber quantum spire
      ctx.beginPath();
      ctx.moveTo(-36, -230);
      ctx.lineTo(0, -295);
      ctx.lineTo(36, -230);
      ctx.closePath();
      ctx.fill();
    }

    // Team Banner Emblem
    ctx.fillStyle = team.team === 1 ? '#0284c7' : '#dc2626';
    ctx.fillRect(dir * -28, -145, 26, 56);
    ctx.strokeStyle = '#fde047';
    ctx.lineWidth = 2;
    ctx.strokeRect(dir * -28, -145, 26, 56);

    // Fortress Gate
    ctx.fillStyle = '#090d16';
    ctx.beginPath();
    ctx.arc(dir * 22, 0, 32, Math.PI, 0);
    ctx.fill();

    // Turret Slots & Mounted Turrets
    for (let i = 0; i < 4; i++) {
      const slotY = -115 - i * 44;
      const slotX = dir * 24;
      const isUnlocked = i < team.unlockedTurretSlots;

      ctx.fillStyle = isUnlocked ? '#1e293b' : 'rgba(15, 23, 42, 0.45)';
      ctx.strokeStyle = isUnlocked ? trimColor : 'rgba(148, 163, 184, 0.25)';
      ctx.lineWidth = 2;
      ctx.fillRect(slotX - 18, slotY - 8, 36, 14);
      ctx.strokeRect(slotX - 18, slotY - 8, 36, 14);

      const installed = team.turrets[i];
      if (installed) {
        const def = getTurretById(installed.turretDefId);
        if (def) {
          ctx.save();
          ctx.translate(slotX, slotY - 8);
          ctx.fillStyle = def.primaryColor;
          ctx.beginPath();
          ctx.arc(0, 0, 12, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = def.accentColor;
          ctx.stroke();

          // Turret Barrel with Recoil
          ctx.rotate(installed.aimAngle);
          const recoilOffset = -installed.recoil * 6;
          ctx.fillStyle = def.accentColor;
          ctx.fillRect(4 + recoilOffset, -4, 22, 8);
          ctx.restore();
        }
      }
    }

    // In-World Fortress Health Bar above Bastion
    const barW = 128;
    const barH = 10;
    const barY = -265 - team.era * 12;
    ctx.fillStyle = 'rgba(9, 13, 22, 0.88)';
    ctx.fillRect(-barW / 2 - 2, barY - 2, barW + 4, barH + 4);

    // Trailing ghost bar
    const trailPct = Math.max(0, Math.min(1, team.trailingHp / team.maxHp));
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(-barW / 2, barY, barW * trailPct, barH);

    // Actual HP bar
    const hpPct = Math.max(0, Math.min(1, team.hp / team.maxHp));
    ctx.fillStyle = team.team === 1 ? '#10b981' : '#ef4444';
    ctx.fillRect(-barW / 2, barY, barW * hpPct, barH);

    ctx.restore();
  }

  private renderUnit(ctx: CanvasRenderingContext2D, u: ActiveUnit): void {
    const dir = u.team === 1 ? 1 : -1;
    const walkBob =
      u.state === 'walk' ? Math.sin(u.walkDistance * 0.085) * 4 : 0;
    const strideAngle =
      u.state === 'walk' ? Math.sin(u.walkDistance * 0.085) * 0.25 : 0;

    ctx.save();
    ctx.translate(u.x, u.y + walkBob);
    if (u.state === 'ko') {
      ctx.rotate(u.koAngle);
      ctx.globalAlpha = Math.max(0, u.koTimer / 0.38);
    }
    ctx.scale(dir * u.scaleX, u.scaleY);

    // Ground shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
    ctx.beginPath();
    ctx.ellipse(0, -walkBob, u.width * 0.48, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Windup Telegraph Warning Glow for heavy/charger/colossus attacks
    if (u.state === 'windup') {
      const progress = 1 - u.stateTimer / Math.max(0.05, u.windupTime);
      ctx.strokeStyle = u.accentColor;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(u.width * 0.35, -u.height * 0.55, 10 + progress * 14, 0, Math.PI * 2);
      ctx.stroke();
    }

    const bodyFill = u.hitFlashTimer > 0 ? '#ffffff' : u.primaryColor;
    const trimFill = u.hitFlashTimer > 0 ? '#fde047' : u.accentColor;
    const teamBadge = u.team === 1 ? '#38bdf8' : '#f87171';

    // Distinct Silhouette per Archetype
    if (u.archetype === 'charger') {
      // Mounted Cavalry / Dino / Tank / Hover-Tank
      ctx.fillStyle = bodyFill;
      ctx.strokeStyle = trimFill;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.roundRect(-u.width * 0.48, -u.height * 0.62, u.width * 0.96, u.height * 0.44, 8);
      ctx.fill();
      ctx.stroke();

      // Turret/Rider top
      ctx.fillStyle = trimFill;
      ctx.beginPath();
      ctx.roundRect(-u.width * 0.18, -u.height * 0.9, u.width * 0.42, u.height * 0.3, 5);
      ctx.fill();

      // Forward Lance / Cannon barrel
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(u.width * 0.18, -u.height * 0.78, u.width * 0.48, 6);
    } else if (u.archetype === 'colossus') {
      // Heavy Armored Titan / Mammoth / Siege / Goliath / Omega Mecha
      ctx.fillStyle = bodyFill;
      ctx.strokeStyle = trimFill;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(-u.width * 0.46, -u.height * 0.88, u.width * 0.92, u.height * 0.76, 10);
      ctx.fill();
      ctx.stroke();

      // Shoulder Pauldrons & Visor
      ctx.fillStyle = trimFill;
      ctx.fillRect(-u.width * 0.5, -u.height * 0.82, u.width, 12);
      ctx.fillStyle = teamBadge;
      ctx.fillRect(4, -u.height * 0.72, u.width * 0.32, 8);
    } else {
      // Humanoid Swarmer or Ranger
      // Legs
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(-4, -16);
      ctx.lineTo(-4 + Math.sin(strideAngle) * 10, 0);
      ctx.moveTo(4, -16);
      ctx.lineTo(4 - Math.sin(strideAngle) * 10, 0);
      ctx.stroke();

      // Torso
      ctx.fillStyle = bodyFill;
      ctx.strokeStyle = trimFill;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-u.width * 0.36, -u.height * 0.72, u.width * 0.72, u.height * 0.45, 6);
      ctx.fill();
      ctx.stroke();

      // Head & Helmet Crest
      ctx.fillStyle = trimFill;
      ctx.beginPath();
      ctx.arc(0, -u.height * 0.84, 9, 0, Math.PI * 2);
      ctx.fill();

      // Weapon Silhouette
      ctx.fillStyle = '#f8fafc';
      if (u.archetype === 'ranger') {
        // Bow / Musket / RPG / Railgun
        ctx.fillRect(4, -u.height * 0.62, 22, 5);
      } else {
        // Melee Club / Sword / Plasma Blade with windup angle
        ctx.save();
        ctx.translate(8, -u.height * 0.55);
        ctx.rotate(u.state === 'windup' ? -0.75 : u.state === 'recover' ? 0.65 : 0.15);
        ctx.fillStyle = trimFill;
        ctx.fillRect(0, -22, 6, 26);
        ctx.restore();
      }
    }

    // Team identification plume
    ctx.fillStyle = teamBadge;
    ctx.beginPath();
    ctx.arc(0, -u.height - 4, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // Shield Bubble if active
    if (u.shield > 0) {
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.65)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, -u.height * 0.5, u.height * 0.56, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();

    // Unit Health Bar (drawn unflipped when damaged or shield active)
    if (u.state !== 'ko' && (u.hp < u.maxHp || u.shield > 0)) {
      const bw = Math.max(30, u.width * 0.85);
      const bh = 5;
      const bx = u.x - bw / 2;
      const by = u.y - u.height - 16;

      ctx.fillStyle = 'rgba(9, 13, 22, 0.85)';
      ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);

      const trail = Math.max(0, Math.min(1, u.trailingHp / u.maxHp));
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(bx, by, bw * trail, bh);

      const pct = Math.max(0, Math.min(1, u.hp / u.maxHp));
      ctx.fillStyle = u.team === 1 ? '#22c55e' : '#ef4444';
      ctx.fillRect(bx, by, bw * pct, bh);

      if (u.maxShield > 0 && u.shield > 0) {
        const spct = Math.max(0, Math.min(1, u.shield / u.maxShield));
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(bx, by - 3, bw * spct, 2);
      }
    }
  }

  private renderProjectile(ctx: CanvasRenderingContext2D, pr: ProjectilePoolItem): void {
    ctx.save();
    ctx.translate(pr.x, pr.y);
    ctx.rotate(pr.rotation);

    if (pr.type === 'laser' || pr.type === 'ion' || pr.type === 'tesla') {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = pr.color;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(-16, 0);
      ctx.lineTo(16, 0);
      ctx.stroke();
    } else if (pr.type === 'arrow') {
      ctx.strokeStyle = pr.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(-12, 0);
      ctx.lineTo(10, 0);
      ctx.stroke();
    } else {
      ctx.fillStyle = pr.color;
      ctx.beginPath();
      ctx.arc(0, 0, pr.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
