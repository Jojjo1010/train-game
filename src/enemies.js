import {
  CANVAS_WIDTH, CANVAS_HEIGHT, MAX_ENEMIES,
  ENEMY_BASE_HP, ENEMY_BASE_SPEED, ENEMY_RADIUS,
  ENEMY_CONTACT_DAMAGE, ENEMY_SPAWN_INTERVAL_START, ENEMY_SPAWN_INTERVAL_MIN,
  ENEMY_RADIUS_MULT, ENEMY_HP_MULT,
  TARGET_DISTANCE,
  WAVE_CYCLE_DURATION, WAVE_SURGE_DURATION, WAVE_CALM_DURATION,
  WAVE_SURGE_SPAWN_MULT, WAVE_CALM_SPAWN_MULT, WAVE_ESCALATION,
  WAVE_WARNING_DURATION, WAVE_BOSS_SURGE_MULT
} from './constants.js';

export class Enemy {
  constructor() {
    this.active = false;
    this.x = 0;
    this.y = 0;
    this.hp = 0;
    this.maxHp = 0;
    this.speed = 0;
    this.radius = ENEMY_RADIUS;
    this.color = '#2d6a2e';
    this.kind = 'zombie'; // 'zombie' or 'bug'
    this.damage = ENEMY_CONTACT_DAMAGE;
    this.flashTimer = 0;
  }

  spawn(x, y, hp, speed, targetBounds) {
    this.active = true;
    this.x = x;
    this.y = y;
    this.hp = hp;
    this.maxHp = hp;
    this.speed = speed;
    this.vx = 0;
    this.vy = 0;
    this.flashTimer = 0;
    this.targetBounds = targetBounds;
  }

  update(dt) {
    if (!this.active) return;

    const tb = this.targetBounds;
    let targetX = Math.max(tb.x, Math.min(this.x, tb.x + tb.w));
    let targetY = Math.max(tb.y, Math.min(this.y, tb.y + tb.h));

    const dx = targetX - this.x;
    const dy = targetY - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 1) {
      this.vx = (dx / dist) * this.speed;
      this.vy = (dy / dist) * this.speed;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
    } else {
      this.vx = 0;
      this.vy = 0;
    }

    if (this.flashTimer > 0) this.flashTimer -= dt;
  }

  takeDamage(amount) {
    this.hp -= amount;
    this.flashTimer = 0.1;
    if (this.hp <= 0) {
      this.active = false;
    }
  }
}

// Wave phases
const WAVE_PHASE = { CALM: 0, WARNING: 1, SURGE: 2 };

export class Spawner {
  constructor() {
    this.pool = [];
    for (let i = 0; i < MAX_ENEMIES; i++) {
      this.pool.push(new Enemy());
    }
    this.spawnTimer = 1; // start with a brief delay

    // Wave state
    this.waveNumber = 0;
    this.wavePhase = WAVE_PHASE.CALM;
    this.waveCycleTimer = WAVE_CYCLE_DURATION; // time until next surge
    this.wavePhaseTimer = 0; // time remaining in current phase
    this.isBossStation = false;
  }

  get activeEnemies() {
    return this.pool.filter(e => e.active);
  }

  /** Current wave info for HUD rendering */
  get waveInfo() {
    return {
      waveNumber: this.waveNumber,
      phase: this.wavePhase,
      phaseTimer: this.wavePhaseTimer,
      cycleTimer: this.waveCycleTimer,
      isSurge: this.wavePhase === WAVE_PHASE.SURGE,
      isWarning: this.wavePhase === WAVE_PHASE.WARNING,
      isCalm: this.wavePhase === WAVE_PHASE.CALM,
      isBossStation: this.isBossStation,
    };
  }

  updateWave(dt) {
    switch (this.wavePhase) {
      case WAVE_PHASE.CALM:
        this.waveCycleTimer -= dt;
        if (this.waveCycleTimer <= WAVE_WARNING_DURATION) {
          // Transition to warning
          this.wavePhase = WAVE_PHASE.WARNING;
          this.wavePhaseTimer = this.waveCycleTimer;
        }
        break;

      case WAVE_PHASE.WARNING:
        this.wavePhaseTimer -= dt;
        if (this.wavePhaseTimer <= 0) {
          // Transition to surge
          this.waveNumber++;
          this.wavePhase = WAVE_PHASE.SURGE;
          this.wavePhaseTimer = WAVE_SURGE_DURATION;
        }
        break;

      case WAVE_PHASE.SURGE:
        this.wavePhaseTimer -= dt;
        if (this.wavePhaseTimer <= 0) {
          // Transition to calm, reset cycle
          this.wavePhase = WAVE_PHASE.CALM;
          this.wavePhaseTimer = WAVE_CALM_DURATION;
          this.waveCycleTimer = WAVE_CYCLE_DURATION;
        }
        break;
    }
  }

  /** Get the spawn rate multiplier based on current wave phase */
  getWaveSpawnMultiplier() {
    const escalation = 1 + this.waveNumber * WAVE_ESCALATION;
    switch (this.wavePhase) {
      case WAVE_PHASE.SURGE: {
        const baseMult = this.isBossStation ? WAVE_BOSS_SURGE_MULT : WAVE_SURGE_SPAWN_MULT;
        return baseMult * escalation;
      }
      case WAVE_PHASE.CALM:
        // During the post-surge calm, reduce rate
        return this.waveNumber > 0 ? WAVE_CALM_SPAWN_MULT : 1;
      case WAVE_PHASE.WARNING:
        return 1; // normal rate during warning
      default:
        return 1;
    }
  }

  update(dt, distance, carBounds, stationDifficulty = 1) {
    // Update wave state
    this.updateWave(dt);
    const waveMult = this.getWaveSpawnMultiplier();

    // Difficulty scales with distance AND station depth (unchanged)
    const distDiff = 1 + (distance / TARGET_DISTANCE) * 2;
    const difficulty = distDiff + (stationDifficulty - 1);
    const interval = Math.max(
      ENEMY_SPAWN_INTERVAL_MIN / stationDifficulty,
      ENEMY_SPAWN_INTERVAL_START / stationDifficulty - difficulty * 0.2
    );

    // Apply wave multiplier: lower interval = faster spawns
    const waveInterval = interval / waveMult;

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      // Spawn more enemies per tick at higher difficulty; wave can add extra
      const baseCount = Math.min(4, Math.floor(stationDifficulty));
      const surgeExtra = this.wavePhase === WAVE_PHASE.SURGE ? Math.floor(this.waveNumber * 0.5) : 0;
      const spawnCount = Math.min(6, baseCount + surgeExtra);
      for (let i = 0; i < spawnCount; i++) this.spawnEnemy(difficulty, carBounds);
      this.spawnTimer = waveInterval;
    }
  }

  static COLORS = ['#2d6a2e', '#3a8a3c', '#1a4d1a'];

  spawnEnemy(difficulty, carBounds) {
    const enemy = this.pool.find(e => !e.active);
    if (!enemy) return;

    const hp = ENEMY_BASE_HP * (1 + difficulty * 0.15);
    const speed = ENEMY_BASE_SPEED * (1 + difficulty * 0.1);

    // Spawn mostly from sides and behind (front has no weapons)
    const edge = Math.random();
    let x, y;
    const margin = 30;

    if (edge < 0.30) {
      // Top
      x = Math.random() * CANVAS_WIDTH;
      y = -margin;
    } else if (edge < 0.60) {
      // Bottom
      x = Math.random() * CANVAS_WIDTH;
      y = CANVAS_HEIGHT + margin;
    } else if (edge < 0.85) {
      // Left (behind train)
      x = -margin;
      y = Math.random() * CANVAS_HEIGHT;
    } else {
      // Right (ahead) — rare, keeps some pressure
      x = CANVAS_WIDTH + margin;
      y = Math.random() * CANVAS_HEIGHT;
    }

    // Color, size and HP based on difficulty
    const colorIdx = Math.min(Math.floor(difficulty / 2), 2);
    enemy.color = Spawner.COLORS[colorIdx];
    enemy.radius = ENEMY_RADIUS * ENEMY_RADIUS_MULT[colorIdx];
    enemy.hp = hp * ENEMY_HP_MULT[colorIdx];
    enemy.maxHp = enemy.hp;
    enemy.kind = Math.random() < 0.6 ? 'zombie' : 'bug';

    // Pick target: 70% cargo, 15% rear weapon, 15% front weapon
    let targetBounds = carBounds.cargo; // default
    const targetRoll = Math.random();
    if (targetRoll < 0.70) {
      targetBounds = carBounds.cargo;
    } else if (targetRoll < 0.85) {
      targetBounds = carBounds.rearWeapon;
    } else {
      targetBounds = carBounds.frontWeapon;
    }

    enemy.spawn(x, y, hp, speed, targetBounds);
  }

  reset() {
    for (const e of this.pool) e.active = false;
    this.spawnTimer = 1;
    // Reset wave state
    this.waveNumber = 0;
    this.wavePhase = WAVE_PHASE.CALM;
    this.waveCycleTimer = WAVE_CYCLE_DURATION;
    this.wavePhaseTimer = 0;
    this.isBossStation = false;
  }
}
