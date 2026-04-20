import {
  CANVAS_WIDTH, CANVAS_HEIGHT,
  BANDIT_SPEED, BANDIT_SPAWN_INTERVAL, BANDIT_JUMP_DURATION,
  BANDIT_STEAL_RATE, BANDIT_FIGHT_DURATION, MAX_BANDITS
} from './constants.js';

const STATES = {
  RUNNING: 0,    // running alongside the track
  JUMPING: 1,    // leaping onto the train
  ON_TRAIN: 2,   // sitting on a slot (stealing or disabling)
  FIGHTING: 3,   // crew is fighting them off
  DEAD: 4,       // kicked off, dying animation
};

export { STATES as BANDIT_STATES };

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

        // If slot has no auto-weapon, steal gold
        if (!this.targetSlot.autoWeaponId) {
          this.stealAccumulator += BANDIT_STEAL_RATE * dt;
          if (this.stealAccumulator >= 1) {
            const stolen = Math.floor(this.stealAccumulator);
            if (train.runGold > 0) {
              train.runGold = Math.max(0, train.runGold - stolen);
              this.totalStolen += stolen;
              this.stealFlash = 0.8;
            }
            this.stealAccumulator -= stolen;
          }
        }
        if (this.stealFlash > 0) this.stealFlash -= dt;
        // If slot has auto-weapon, it's disabled (checked in combat.js)

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
      // If crew was sent to fight on an auto-weapon slot, unassign them after
      if (this.targetSlot.autoWeaponId && this.targetSlot.crew) {
        const crew = this.targetSlot.crew;
        crew.assignment = null;
        this.targetSlot.crew = null;
      }
      this.targetSlot._bandit = null;
    }
    this.state = STATES.DEAD;
    this.timer = 0.6;
    // Fling off to the side
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
    this.spawnTimer = 8; // initial delay before first bandit
  }

  get activeBandits() {
    return this.pool.filter(b => b.active);
  }

  update(dt, train, difficulty) {
    // Update existing bandits
    for (const b of this.pool) {
      if (b.active) b.update(dt, train);
    }

    // Spawn new bandits
    const interval = Math.max(4, BANDIT_SPAWN_INTERVAL - difficulty * 1.5);
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = interval;
      this.trySpawn(train);
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
    for (const b of this.pool) {
      b.active = false;
      if (b.targetSlot) {
        b.targetSlot._bandit = null;
        b.targetSlot = null;
      }
    }
    this.spawnTimer = 8;
  }
}
