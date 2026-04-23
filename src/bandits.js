import {
  CANVAS_WIDTH, CANVAS_HEIGHT,
  BANDIT_SPEED, BANDIT_SPAWN_INTERVAL, BANDIT_JUMP_DURATION,
  BANDIT_STEAL_RATE, BANDIT_FIGHT_DURATION, MAX_BANDITS,
  GUNNER_FIGHT_DURATION_MULT
} from './constants.js';
import { startStealLoop, stopStealLoop, playStealCoin } from './audio.js';
import { spawnDamageNumber as spawnAttribution } from './damageAttribution.js';

const STATES = {
  RUNNING: 0,    // running alongside the track
  JUMPING: 1,    // leaping onto the train
  ON_TRAIN: 2,   // sitting on a slot (stealing or disabling)
  FIGHTING: 3,   // crew is fighting them off
  DEAD: 4,       // kicked off, dying animation
};

export { STATES as BANDIT_STATES };

// Escalation: smooth ramps, not step functions
const BANDIT_GRACE_PERIOD = 2.5;     // 0–2.5s: no stealing (just settled in; was 4)
const BANDIT_STEAL_RAMP = 3;         // seconds after grace to reach full steal rate (was 5)
const BANDIT_HP_START = 10;          // seconds before HP drain begins
const BANDIT_HP_RAMP = 4;            // seconds to reach max HP drain rate
const BANDIT_MAX_HP_RATE = 0.5;      // max HP/s per bandit (was 1.0 instant)

export class Bandit {
  constructor() {
    this.active = false;
    this.state = STATES.RUNNING;
    this.x = 0;
    this.y = 0;
    this.targetSlot = null;
    this.timer = 0;
    this.runSpeed = 0;
    this.side = 1; // 1 = below track, -1 = above track
    this.jumpStartX = 0;
    this.jumpStartY = 0;
    this.stealAccumulator = 0;
    this.flashTimer = 0;
    this.stealFlash = 0; // timer for showing "-gold" number
    this.totalStolen = 0;
    this.deathVx = 0;
    this.deathVy = 0;
    this.dwellTime = 0; // seconds spent ON_TRAIN (drives escalation)
    this.justDied = false; // flag for BanditSystem spawn cooldown
  }

  spawn(x, y, targetSlot, side) {
    this.active = true;
    this.state = STATES.RUNNING;
    this.x = x;
    this.y = y;
    this.targetSlot = targetSlot;
    this.side = side;
    this.runSpeed = BANDIT_SPEED * (0.9 + Math.random() * 0.2);
    this.timer = 0;
    this.stealAccumulator = 0;
    this.flashTimer = 0;
    this.stealFlash = 0;
    this.totalStolen = 0;
    this.dwellTime = 0;
    this.timeOnSlot = 0;
    this.justDied = false;
  }

  update(dt, train) {
    if (!this.active) return;

    switch (this.state) {
      case STATES.RUNNING: {
        // Run toward the target slot's X position
        const targetX = this.targetSlot.worldX;
        const dx = targetX - this.x;

        if (Math.abs(dx) < 8) {
          // Close enough — jump!
          this.state = STATES.JUMPING;
          this.timer = BANDIT_JUMP_DURATION;
          this.jumpStartX = this.x;
          this.jumpStartY = this.y;
        } else {
          // Run toward target
          this.x += Math.sign(dx) * this.runSpeed * dt;
        }
        break;
      }

      case STATES.JUMPING: {
        this.timer -= dt;
        const progress = 1 - Math.max(0, this.timer / BANDIT_JUMP_DURATION);
        // Lerp position from start to slot
        this.x = this.jumpStartX + (this.targetSlot.worldX - this.jumpStartX) * progress;
        this.y = this.jumpStartY + (this.targetSlot.worldY - this.jumpStartY) * progress;
        // Arc upward
        this.y -= Math.sin(progress * Math.PI) * 30;

        if (this.timer <= 0) {
          // Check if slot is still valid (no crew arrived while jumping)
          if (this.targetSlot.crew) {
            // Crew got there first — bandit bounces off
            this.die();
          } else {
            this.state = STATES.ON_TRAIN;
            this.x = this.targetSlot.worldX;
            this.y = this.targetSlot.worldY;
            this.targetSlot._bandit = this;
          }
        }
        break;
      }

      case STATES.ON_TRAIN: {
        // Stay on the slot
        this.x = this.targetSlot.worldX;
        this.y = this.targetSlot.worldY;
        this.timeOnSlot += dt;
        this.dwellTime += dt;

        // PROTOTYPE: bandits ONLY degrade the mount (handled in combat.js).
        // No gold stealing, no HP drain.

        if (this.stealFlash > 0) this.stealFlash -= dt;

        // Check if crew just arrived at this slot
        if (this.targetSlot.crew) {
          const crew = this.targetSlot.crew;
          if (crew.role === 'Brawler') {
            // Brawler: instant kick-off + AOE damage burst
            this._brawlerKick = true; // signal for main.js to apply AOE
            this._kickWorldX = this.targetSlot.worldX;
            this._kickWorldY = this.targetSlot.worldY;
            this._kickCrew = crew;
            this.die();
          } else {
            this.state = STATES.FIGHTING;
            this.timer = crew.role === 'Gunner'
              ? BANDIT_FIGHT_DURATION * GUNNER_FIGHT_DURATION_MULT
              : BANDIT_FIGHT_DURATION;
          }
        }
        break;
      }

      case STATES.FIGHTING: {
        this.x = this.targetSlot.worldX;
        this.y = this.targetSlot.worldY;
        this.timer -= dt;
        this.flashTimer = (this.flashTimer + dt * 12) % 1; // flicker

        if (this.timer <= 0) {
          this.die();
        }
        break;
      }

      case STATES.DEAD: {
        this.timer -= dt;
        this.x += this.deathVx * dt;
        this.y += this.deathVy * dt;
        if (!this._brawlerKicked) {
          this.deathVy += 200 * dt; // gravity for normal death
        }

        // Brawler kick: land when timer expires
        if (this._brawlerKicked && !this._kickLanded && this.timer <= 0) {
          this._kickLanded = true;
          this._landX = this.x;
          this._landY = this.y;
          // Stay visible briefly after landing
          this.timer = 0.3;
          this.deathVx = 0;
          this.deathVy = 0;
        } else if (this.timer <= 0) {
          this.active = false;
        }
        break;
      }
    }
  }

  getWeaponFactor() {
    if (this.state !== STATES.ON_TRAIN && this.state !== STATES.FIGHTING) return null;
    if (this.timeOnSlot < 2) return 0.75;
    if (this.timeOnSlot < 5) return 0.30;
    return 0;
  }

  die() {
    const wasKicked = this._brawlerKick;
    if (this.targetSlot) {
      this.targetSlot._bandit = null;
      this.targetSlot = null; // clear so renderer uses b.x/b.y for positioning
    }
    this.state = STATES.DEAD;
    this.justDied = true;
    this._brawlerKicked = false;
    this._kickLanded = false;
    this._landX = 0;
    this._landY = 0;
    this._landTimer = 0;
    this._kickTrail = [];
    if (wasKicked) {
      // Brawler kick: visible arc, lands nearby with AOE
      this._brawlerKicked = true;
      this._kickTrail = [];
      this.timer = 0.6; // shorter flight so it's visible
      // Kick away from train center, stay on screen
      const trainCenterY = CANVAS_HEIGHT / 2;
      const awayDir = this.y <= trainCenterY ? -1 : 1;
      this.deathVx = -(80 + Math.random() * 60); // fly backward (left)
      this.deathVy = awayDir * (150 + Math.random() * 80); // fly away from track
    } else {
      this.timer = 0.6;
      this.deathVx = (Math.random() - 0.5) * 100;
      this.deathVy = -120 - Math.random() * 60;
    }
  }
}

export class BanditSystem {
  constructor() {
    this.pool = [];
    for (let i = 0; i < MAX_BANDITS; i++) {
      this.pool.push(new Bandit());
    }
    this.spawnTimer = 15; // initial delay — player gets ~9s to orient before first bandit
  }

  update(dt, train, difficulty, wavePhase) {
    // Update existing bandits
    for (const b of this.pool) {
      if (b.active) b.update(dt, train);
    }

    // Defeating a bandit earns a brief spawn reprieve (PROTOTYPE: was 3)
    for (const b of this.pool) {
      if (b.justDied) {
        this.spawnTimer = Math.max(this.spawnTimer, 1.5);
        b.justDied = false;
      }
    }

    // Spawn new bandits
    // During SURGE (phase 2), bandits spawn ~50% faster via accelerated countdown
    const isSurge = wavePhase === 2;
    const spawnTickRate = isSurge ? 1.5 : 1.0;
    const interval = Math.max(3, BANDIT_SPAWN_INTERVAL - difficulty * 1.0);
    this.spawnTimer -= dt * spawnTickRate;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = interval;
      this.trySpawn(train);
    }

    stopStealLoop();
  }

  trySpawn(train) {
    // Find unmanned slots (no crew, and no bandit already there)
    const availableSlots = train.allMounts.filter(
      m => !m.crew && !m._bandit
    );
    if (availableSlots.length === 0) return;

    const bandit = this.pool.find(b => !b.active);
    if (!bandit) return;

    // Pick a random available slot
    const slot = availableSlots[Math.floor(Math.random() * availableSlots.length)];

    // Spawn from ahead of the train (right side), above or below track
    const side = Math.random() < 0.5 ? -1 : 1;
    const x = CANVAS_WIDTH + 30;
    const trackY = CANVAS_HEIGHT / 2;
    const y = trackY + side * (40 + Math.random() * 30);

    bandit.spawn(x, y, slot, side);
  }

  // Check if a mount has a bandit on it (used to disable weapons)
  hasBandit(mount) {
    return mount._bandit != null && mount._bandit.active &&
      (mount._bandit.state === STATES.ON_TRAIN || mount._bandit.state === STATES.FIGHTING);
  }

  reset() {
    stopStealLoop();
    for (const b of this.pool) {
      b.active = false;
      if (b.targetSlot) {
        b.targetSlot._bandit = null;
        b.targetSlot = null;
      }
    }
    this.spawnTimer = 15;
  }
}
