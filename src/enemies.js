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
    this.knockbackVX = 0;
    this.knockbackVY = 0;
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
    this.knockbackVX = 0;
    this.knockbackVY = 0;
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
    } else {
      this.vx = 0;
      this.vy = 0;
    }

    // Apply knockback on top of movement velocity
    this.x += (this.vx + this.knockbackVX) * dt;
    this.y += (this.vy + this.knockbackVY) * dt;

    // Decay knockback
    const KNOCKBACK_DECAY = 12;
    this.knockbackVX *= Math.max(0, 1 - KNOCKBACK_DECAY * dt);
    this.knockbackVY *= Math.max(0, 1 - KNOCKBACK_DECAY * dt);

    if (this.flashTimer > 0) this.flashTimer -= dt;
  }

  // pvx/pvy: projectile velocity direction (used for knockback impulse)
  takeDamage(amount, pvx = 0, pvy = 0) {
    this.hp -= amount;
    this.flashTimer = 0.05;
    if (this.hp <= 0) {
      this.active = false;
    } else {
      // Apply knockback in the direction the projectile was travelling
      const pSpeed = Math.sqrt(pvx * pvx + pvy * pvy);
      if (pSpeed > 0) {
        const KNOCKBACK_STRENGTH = 80;
        this.knockbackVX += (pvx / pSpeed) * KNOCKBACK_STRENGTH;
        this.knockbackVY += (pvy / pSpeed) * KNOCKBACK_STRENGTH;
      }
    }
  }
}

// Enemy tier names (indexed by tier 0–2)
export const ENEMY_TIER_NAMES = ['Scavenger', 'Raider', 'War Rig'];

// Wave thematic labels — [warningText, surgeText]
const WAVE_LABELS = [
  ['Scouts approaching',      'Scout party'],       // wave 1
  ['Scouts approaching',      'Scout party'],       // wave 2
  ['Raiding party incoming',  'Under attack'],      // wave 3
  ['Raiding party incoming',  'Under attack'],      // wave 4
  ['The horde approaches',    'Horde assault'],     // wave 5
  ['The horde approaches',    'Horde assault'],     // wave 6
];
const WAVE_LABELS_MAX = ['The horde has found you', 'Overwhelming force']; // wave 7+

function getWaveLabel(waveNumber, isSurge) {
  const idx = Math.max(0, waveNumber - 1);
  const pair = idx < WAVE_LABELS.length ? WAVE_LABELS[idx] : WAVE_LABELS_MAX;
  // pair is either a two-element array or the max pair array
  return Array.isArray(pair) && pair.length === 2
    ? pair[isSurge ? 1 : 0]
    : pair[isSurge ? 1 : 0];
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
    this.postSurgeSilenceTimer = 0; // seconds of near-silence after surge ends
  }

  get activeEnemies() {
    return this.pool.filter(e => e.active);
  }

  /** Current wave info for HUD rendering */
  get waveInfo() {
    const isSurge = this.wavePhase === WAVE_PHASE.SURGE;
    const isWarning = this.wavePhase === WAVE_PHASE.WARNING;
    // Warning text refers to the upcoming wave (waveNumber + 1)
    const warningLabel = getWaveLabel(this.waveNumber + 1, false);
    const surgeLabel = getWaveLabel(this.waveNumber, true);
    return {
      waveNumber: this.waveNumber,
      phase: this.wavePhase,
      phaseTimer: this.wavePhaseTimer,
      cycleTimer: this.waveCycleTimer,
      isSurge,
      isWarning,
      isCalm: this.wavePhase === WAVE_PHASE.CALM,
      isBossStation: this.isBossStation,
      warningLabel,
      surgeLabel,
      modifier: this.modifier || null,
      direction: this.waveDirection || 'right',
    };
  }

  updateWave(dt) {
    switch (this.wavePhase) {
      case WAVE_PHASE.CALM:
        this.waveCycleTimer -= dt;
        if (this.waveCycleTimer <= WAVE_WARNING_DURATION) {
          // Transition to warning — assign direction for upcoming wave
          this.wavePhase = WAVE_PHASE.WARNING;
          this.wavePhaseTimer = this.waveCycleTimer;
          // Waves 1-2 are tutorial: always from right
          const upcomingWave = this.waveNumber + 1;
          if (upcomingWave <= 2) {
            this.waveDirection = 'right';
          } else {
            // Weighted random: right=30%, top=25%, bottom=25%, both=20%
            const r = Math.random();
            if (r < 0.30)      this.waveDirection = 'right';
            else if (r < 0.55) this.waveDirection = 'top';
            else if (r < 0.80) this.waveDirection = 'bottom';
            else               this.waveDirection = 'both';
          }
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
          // Brief silence after surge for "relief" feeling
          this.postSurgeSilenceTimer = 2.0;
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
        // Post-surge silence: near-zero spawns for first 2s, then ramp to normal calm rate
        if (this.postSurgeSilenceTimer > 0) {
          // t goes from 1 (just started silence) to 0 (silence ending)
          const t = this.postSurgeSilenceTimer / 2.0;
          // Exponential ramp: almost nothing at start, approaches calm rate at end
          return WAVE_CALM_SPAWN_MULT * (1 - t) * (1 - t) * 0.15;
        }
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
    // Tick post-surge silence timer
    if (this.postSurgeSilenceTimer > 0) this.postSurgeSilenceTimer -= dt;
    const waveMult = this.getWaveSpawnMultiplier();

    // Difficulty scales with distance AND station depth (unchanged)
    const distDiff = 1 + (distance / TARGET_DISTANCE) * 2;
    const difficulty = distDiff + (stationDifficulty - 1);
    // Modifier spawn multiplier (swarm=2x faster, armored=0.5x, etc.)
    const modSpawnMult = this.modifier ? this.modifier.spawnMult : 1;

    const interval = Math.max(
      ENEMY_SPAWN_INTERVAL_MIN / stationDifficulty,
      ENEMY_SPAWN_INTERVAL_START / stationDifficulty - difficulty * 0.2
    );

    // Apply wave multiplier and modifier: lower interval = faster spawns
    const waveInterval = interval / waveMult / modSpawnMult;

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

    let x, y;
    const margin = 30;
    const dir = this.waveDirection || 'right';

    if (dir === 'right') {
      // Original multi-edge spawning (tutorial/right waves)
      const edge = Math.random();
      if (edge < 0.30) {
        x = Math.random() * CANVAS_WIDTH;
        y = -margin;
      } else if (edge < 0.60) {
        x = Math.random() * CANVAS_WIDTH;
        y = CANVAS_HEIGHT + margin;
      } else if (edge < 0.85) {
        x = -margin;
        y = Math.random() * CANVAS_HEIGHT;
      } else {
        x = CANVAS_WIDTH + margin;
        y = Math.random() * CANVAS_HEIGHT;
      }
    } else {
      // Directional wave spawn
      const trainX = CANVAS_WIDTH * 0.3;
      const trainY = CANVAS_HEIGHT / 2;

      let spawnSide;
      if (dir === 'both') {
        spawnSide = Math.random() < 0.5 ? 'top' : 'bottom';
      } else {
        spawnSide = dir; // 'top' or 'bottom'
      }

      if (spawnSide === 'top') {
        x = Math.random() * CANVAS_WIDTH;
        y = -margin;
      } else {
        // bottom
        x = Math.random() * CANVAS_WIDTH;
        y = CANVAS_HEIGHT + margin;
      }
    }

    // Color, size and HP based on difficulty
    const colorIdx = Math.min(Math.floor(difficulty / 2), 2);
    const modHpMult = this.modifier ? this.modifier.hpMult : 1;
    enemy.color = Spawner.COLORS[colorIdx];
    enemy.radius = ENEMY_RADIUS * ENEMY_RADIUS_MULT[colorIdx];
    enemy.hp = hp * ENEMY_HP_MULT[colorIdx] * modHpMult;
    enemy.maxHp = enemy.hp;
    enemy.tier = colorIdx;
    enemy.name = ENEMY_TIER_NAMES[colorIdx];
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
    this.postSurgeSilenceTimer = 0;
    this.modifier = null;
    this.waveDirection = 'right';
  }

  /** Apply Ambush modifier — skip calm, start immediately in surge */
  applyAmbush() {
    this.waveNumber = 1;
    this.wavePhase = WAVE_PHASE.SURGE;
    this.wavePhaseTimer = WAVE_SURGE_DURATION * 0.7; // slightly shorter first surge
    this.waveCycleTimer = WAVE_CYCLE_DURATION * 0.6;
    this.spawnTimer = 0.2;
  }
}
