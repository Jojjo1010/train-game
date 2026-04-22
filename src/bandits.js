import {
  CANVAS_WIDTH, CANVAS_HEIGHT,
  BANDIT_SPEED, BANDIT_SPAWN_INTERVAL, BANDIT_JUMP_DURATION,
  BANDIT_STEAL_RATE, BANDIT_FIGHT_DURATION, MAX_BANDITS
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

        // Track how long this bandit has been aboard
        this.dwellTime += dt;

        // Smooth steal ramp: 0 during grace, then linearly reaches full rate
        if (!this.targetSlot.autoWeaponId && this.dwellTime > BANDIT_GRACE_PERIOD) {
          const stealFraction = Math.min(1, (this.dwellTime - BANDIT_GRACE_PERIOD) / BANDIT_STEAL_RAMP);
          this.stealAccumulator += BANDIT_STEAL_RATE * stealFraction * dt;
          if (this.stealAccumulator >= 1) {
            const stolen = Math.floor(this.stealAccumulator);
            if (train.runGold > 0) {
              const actualStolen = Math.min(stolen, train.runGold);
              train.runGold = Math.max(0, train.runGold - stolen);
              this.totalStolen += stolen;
              this.stealFlash = 0.8;
              playStealCoin();
              // Floating damage attribution (gold — stolen gold)
              spawnAttribution(`-${actualStolen}g`, this.x, this.y - 10, '#f5c842', `bandit-gold-${this.targetSlot?.worldX}`);
            }
            this.stealAccumulator -= stolen;
          }
        }

        // HP damage: starts late, ramps slowly, caps low per bandit
        if (this.dwellTime >= BANDIT_HP_START) {
          const hpFraction = Math.min(1, (this.dwellTime - BANDIT_HP_START) / BANDIT_HP_RAMP);
          const hpDmg = BANDIT_MAX_HP_RATE * hpFraction * dt;
          train.hp -= hpDmg;
          if (train.damageFlash <= 0) train.damageFlash = 0.1;
          // Floating damage attribution (purple — bandit HP drain, throttled)
          const drainRate = BANDIT_MAX_HP_RATE * hpFraction;
          spawnAttribution(`-${drainRate.toFixed(1)}`, this.x, this.y - 20, '#cc66ff', `bandit-hp-${this.targetSlot?.worldX}`);
        }

        if (this.stealFlash > 0) this.stealFlash -= dt;
        // If slot has auto-weapon, it's degraded (checked in combat.js)

        // Check if crew just arrived at this slot
        if (this.targetSlot.crew) {
          this.state = STATES.FIGHTING;
          this.timer = BANDIT_FIGHT_DURATION;
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
        this.deathVy += 200 * dt; // gravity
        if (this.timer <= 0) {
          this.active = false;
        }
        break;
      }
    }
  }

  die() {
    if (this.targetSlot) {
      this.targetSlot._bandit = null;
    }
    this.state = STATES.DEAD;
    this.timer = 0.6;
    this.justDied = true; // signals BanditSystem to add spawn breathing room
    this.deathVx = (Math.random() - 0.5) * 100;
    this.deathVy = -120 - Math.random() * 60;
  }
}

export class BanditSystem {
  constructor() {
    this.pool = [];
    for (let i = 0; i < MAX_BANDITS; i++) {
      this.pool.push(new Bandit());
    }
    this.spawnTimer = 9; // initial delay — player gets ~9s to orient before first bandit
  }

  update(dt, train, difficulty, wavePhase) {
    // Update existing bandits
    for (const b of this.pool) {
      if (b.active) b.update(dt, train);
    }

    // Defeating a bandit earns a short spawn reprieve
    for (const b of this.pool) {
      if (b.justDied) {
        this.spawnTimer = Math.max(this.spawnTimer, 3);
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

    // Steal sound: loop only when a bandit is actually draining gold
    const anyStealing = this.pool.some(b =>
      b.active && b.state === STATES.ON_TRAIN && !b.targetSlot?.autoWeaponId
      && b.dwellTime > BANDIT_GRACE_PERIOD
    );
    if (anyStealing) {
      startStealLoop();
    } else {
      stopStealLoop();
    }
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
    this.spawnTimer = 9;
  }
}
