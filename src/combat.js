import {
  CANVAS_WIDTH, CANVAS_HEIGHT,
  MAX_PROJECTILES, PROJECTILE_SPEED, PROJECTILE_LIFETIME, PROJECTILE_RADIUS,
  DRIVER_DAMAGE_BUFF, XP_PER_KILL, MAX_RICOCHET_BOLTS, MAX_DAMAGE_NUMBERS
} from './constants.js';
import { playShoot, playEnemyHit, playEnemyKill, playTrainDamage } from './audio.js';

export class Projectile {
  constructor() {
    this.active = false;
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.damage = 0;
    this.lifetime = 0;
    this.radius = PROJECTILE_RADIUS;
    this.source = 'crew'; // 'crew' or 'auto'
  }

  spawn(x, y, angle, damage, source = 'crew') {
    this.active = true;
    this.x = x;
    this.y = y;
    this.vx = Math.cos(angle) * PROJECTILE_SPEED;
    this.vy = Math.sin(angle) * PROJECTILE_SPEED;
    this.damage = damage;
    this.lifetime = PROJECTILE_LIFETIME;
    this.source = source;
  }

  update(dt) {
    if (!this.active) return;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.lifetime -= dt;
    if (this.lifetime <= 0) this.active = false;
  }
}

function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

class DamageNumber {
  constructor() {
    this.active = false;
    this.x = 0;
    this.y = 0;
    this.damage = 0;
    this.life = 0;
    this.maxLife = 0.6;
    this.vy = -40; // float upward
  }

  spawn(x, y, damage) {
    this.active = true;
    this.x = x + (Math.random() - 0.5) * 16; // slight spread
    this.y = y - 10;
    this.damage = damage;
    this.life = this.maxLife;
  }

  update(dt) {
    if (!this.active) return;
    this.y += this.vy * dt;
    this.life -= dt;
    if (this.life <= 0) this.active = false;
  }
}

// MAX_DAMAGE_NUMBERS imported from constants

class RicochetBolt {
  constructor() {
    this.active = false;
    this.x = 0; this.y = 0;
    this.vx = 0; this.vy = 0;
    this.damage = 0;
    this.speed = 300;
    this.bouncesLeft = 0;
    this.hitEnemies = new Set();
  }

  spawn(x, y, angle, damage, bounces, speed) {
    this.active = true;
    this.x = x; this.y = y;
    this.prevX = x; this.prevY = y;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.damage = damage;
    this.speed = speed;
    this.bouncesLeft = bounces;
    this.hitEnemies.clear();
  }

  update(dt) {
    if (!this.active) return;
    this.prevX = this.x;
    this.prevY = this.y;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Bounce off screen edges (costs a bounce)
    if (this.x < 0) { this.x = 0; this.vx = Math.abs(this.vx); this.bouncesLeft--; }
    else if (this.x > CANVAS_WIDTH) { this.x = CANVAS_WIDTH; this.vx = -Math.abs(this.vx); this.bouncesLeft--; }
    if (this.y < 0) { this.y = 0; this.vy = Math.abs(this.vy); this.bouncesLeft--; }
    else if (this.y > CANVAS_HEIGHT) { this.y = CANVAS_HEIGHT; this.vy = -Math.abs(this.vy); this.bouncesLeft--; }

    if (this.bouncesLeft < 0) this.active = false;
  }

  redirectToward(tx, ty) {
    const dx = tx - this.x;
    const dy = ty - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 0) {
      this.vx = (dx / dist) * this.speed;
      this.vy = (dy / dist) * this.speed;
    }
  }
}

export class CombatSystem {
  constructor() {
    this.projectiles = [];
    for (let i = 0; i < MAX_PROJECTILES; i++) {
      this.projectiles.push(new Projectile());
    }
    this.ricochetBolts = [];
    for (let i = 0; i < MAX_RICOCHET_BOLTS; i++) {
      this.ricochetBolts.push(new RicochetBolt());
    }
    this.damageNumbers = [];
    for (let i = 0; i < MAX_DAMAGE_NUMBERS; i++) {
      this.damageNumbers.push(new DamageNumber());
    }
    this.pendingLevelUp = false;
  }

  handleEnemyDamageResult(e, train) {
    if (!e.active) {
      playEnemyKill();
      const leveled = train.addXP(XP_PER_KILL);
      if (leveled) this.pendingLevelUp = true;
    } else {
      playEnemyHit();
    }
  }

  spawnDamageNumber(x, y, damage) {
    const d = this.damageNumbers.find(n => !n.active);
    if (d) d.spawn(x, y, damage);
  }

  update(dt, train, enemies) {
    // Update existing projectiles
    for (const p of this.projectiles) p.update(dt);
    // Update damage numbers
    for (const d of this.damageNumbers) d.update(dt);

    // Manned weapons — auto-fire in facing direction, auto-aim at enemies in cone
    const hasDriver = train.hasDriver;
    const areaMult = train.totalAreaMultiplier;
    for (const mount of train.allMounts) {
      if (!mount.isManned) continue;

      mount.cooldownTimer -= dt;
      if (mount.cooldownTimer > 0) continue;

      // Fire in cone direction — aim at target if one is in cone
      let angle = mount.coneDirection;
      const target = this.findTarget(mount, enemies, areaMult);
      if (target) {
        const dx = target.x - mount.worldX;
        const dy = target.y - mount.worldY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const t = dist / PROJECTILE_SPEED;
        const lx = target.x + (target.vx || 0) * t;
        const ly = target.y + (target.vy || 0) * t;
        angle = Math.atan2(ly - mount.worldY, lx - mount.worldX);
      }

      let damage = mount.damage * train.totalDamageMultiplier;
      if (hasDriver) damage *= DRIVER_DAMAGE_BUFF;

      this.fireProjectile(mount.worldX, mount.worldY, angle, damage);
      mount.cooldownTimer = (1 / mount.fireRate) * train.totalCooldownMultiplier;
      playShoot();
    }

    // Projectile-enemy collision
    this.checkProjectileHits(enemies, train);

    // Auto-weapons (VS-style)
    this.updateAutoWeapons(dt, train, enemies);

    // Enemy-train collision
    this.checkEnemyTrainCollision(enemies, train);
  }

  findTarget(mount, enemies, areaMult = 1) {
    let closest = null;
    const range = mount.range * areaMult;
    let closestDist = range * range;

    for (const e of enemies) {
      if (!e.active) continue;

      const dx = e.x - mount.worldX;
      const dy = e.y - mount.worldY;
      const distSq = dx * dx + dy * dy;

      if (distSq > closestDist) continue;

      // Cone check
      const angleToEnemy = Math.atan2(dy, dx);
      const diff = Math.abs(normalizeAngle(angleToEnemy - mount.coneDirection));
      if (diff <= mount.coneHalfAngle) {
        closest = e;
        closestDist = distSq;
      }
    }
    return closest;
  }

  fireProjectile(x, y, angle, damage, source = 'crew') {
    const proj = this.projectiles.find(p => !p.active);
    if (proj) proj.spawn(x, y, angle, damage, source);
  }

  checkProjectileHits(enemies, train) {
    for (const p of this.projectiles) {
      if (!p.active) continue;
      for (const e of enemies) {
        if (!e.active) continue;
        const dx = p.x - e.x;
        const dy = p.y - e.y;
        const dist = dx * dx + dy * dy;
        const minDist = p.radius + e.radius;
        if (dist <= minDist * minDist) {
          this.spawnDamageNumber(e.x, e.y, p.damage);
          e.takeDamage(p.damage);
          p.active = false;
          this.handleEnemyDamageResult(e, train);
          break;
        }
      }
    }
  }

  checkEnemyTrainCollision(enemies, train) {
    for (const e of enemies) {
      if (!e.active) continue;
      for (const car of train.cars) {
        const cx = Math.max(car.worldX, Math.min(e.x, car.worldX + car.width));
        const cy = Math.max(car.worldY, Math.min(e.y, car.worldY + car.height));
        const dx = e.x - cx;
        const dy = e.y - cy;
        if (dx * dx + dy * dy <= e.radius * e.radius) {
          train.hp -= Math.max(1, e.damage - train.totalShieldReduction);
          train.damageFlash = 0.25;
          train.shakeTimer = 0.2;
          playTrainDamage();
          e.active = false;
          break;
        }
      }
    }
  }

  // === AUTO-WEAPONS (fire from their mount position) ===
  updateAutoWeapons(dt, train, enemies) {
    const dmgMult = train.totalDamageMultiplier;
    const cdMult = train.totalCooldownMultiplier;
    const areaMult = train.totalAreaMultiplier;

    // --- TURRET ---
    if (train.hasAutoWeapon('turret')) {
      const w = train.autoWeapons.turret;
      const m = w.mount;
      if (m._bandit) { w.cooldownTimer = 0.5; } else {
      const mx = m.worldX, my = m.worldY;
      const stats = train.getAutoWeaponStats('turret');
      w.cooldownTimer -= dt;
      if (w.cooldownTimer <= 0) {
        let closest = null;
        const range = stats.range * areaMult;
        let closestDist = range * range;
        for (const e of enemies) {
          if (!e.active) continue;
          const dx = e.x - mx, dy = e.y - my;
          const d = dx * dx + dy * dy;
          if (d < closestDist) { closest = e; closestDist = d; }
        }
        if (closest) {
          const dmg = stats.damage * dmgMult;
          for (let s = 0; s < stats.shotsPerBurst; s++) {
            const dist = Math.sqrt(closestDist);
            const t = dist / PROJECTILE_SPEED;
            const lx = closest.x + (closest.vx || 0) * t;
            const ly = closest.y + (closest.vy || 0) * t;
            const angle = Math.atan2(ly - my, lx - mx) + (s - (stats.shotsPerBurst - 1) / 2) * 0.08;
            this.fireProjectile(mx, my, angle, dmg, 'auto');
          }
          // Update mount cone direction to face target
          m.coneDirection = Math.atan2(closest.y - my, closest.x - mx);
          playShoot();
          w.cooldownTimer = stats.fireInterval * cdMult;
        }
      }
      } // end bandit check
    }

    // --- STEAM BLAST ---
    if (train.hasAutoWeapon('steamBlast')) {
      const w = train.autoWeapons.steamBlast;
      const m = w.mount;
      if (m._bandit) { w.tickTimer = 0.5; } else {
      const mx = m.worldX, my = m.worldY;
      const stats = train.getAutoWeaponStats('steamBlast');
      w.tickTimer -= dt;
      if (w.tickTimer <= 0) {
        w.tickTimer = stats.tickRate * cdMult;
        const r = stats.radius * areaMult;
        const r2 = r * r;
        const dmg = stats.damage * dmgMult;
        for (const e of enemies) {
          if (!e.active) continue;
          const dx = e.x - mx, dy = e.y - my;
          if (dx * dx + dy * dy <= r2) {
            this.spawnDamageNumber(e.x, e.y, dmg);
            e.takeDamage(dmg);
            this.handleEnemyDamageResult(e, train);
          }
        }
      }
      } // end bandit check
    }

    // --- RICOCHET SHOT ---
    if (train.hasAutoWeapon('ricochetShot')) {
      const w = train.autoWeapons.ricochetShot;
      const m = w.mount;
      if (m._bandit) { w.cooldownTimer = 0.5; } else {
      const mx = m.worldX, my = m.worldY;
      const stats = train.getAutoWeaponStats('ricochetShot');
      w.cooldownTimer -= dt;
      if (w.cooldownTimer <= 0) {
        w.cooldownTimer = stats.fireInterval * cdMult;
        const angle = Math.random() * Math.PI * 2;
        const bolt = this.ricochetBolts.find(b => !b.active);
        if (bolt) bolt.spawn(mx, my, angle, stats.damage * dmgMult, stats.bounces, stats.speed);
      }
      } // end bandit check
    }

    // Update ricochet bolts
    for (const bolt of this.ricochetBolts) {
      if (!bolt.active) continue;
      bolt.update(dt);
      // Check collision with enemies
      for (const e of enemies) {
        if (!e.active || bolt.hitEnemies.has(e)) continue;
        const dx = bolt.x - e.x;
        const dy = bolt.y - e.y;
        if (dx * dx + dy * dy <= (e.radius + 6) * (e.radius + 6)) {
          this.spawnDamageNumber(e.x, e.y, bolt.damage);
          e.takeDamage(bolt.damage);
          bolt.hitEnemies.add(e);
          this.handleEnemyDamageResult(e, train);
          bolt.bouncesLeft--;
          if (bolt.bouncesLeft <= 0) {
            bolt.active = false;
          } else {
            // Find nearest un-hit enemy to bounce toward
            let nextTarget = null;
            let nextDist = 300 * 300;
            for (const e2 of enemies) {
              if (!e2.active || bolt.hitEnemies.has(e2)) continue;
              const d2 = (bolt.x - e2.x) ** 2 + (bolt.y - e2.y) ** 2;
              if (d2 < nextDist) { nextTarget = e2; nextDist = d2; }
            }
            if (nextTarget) {
              bolt.redirectToward(nextTarget.x, nextTarget.y);
            } else {
              bolt.active = false;
            }
          }
          break;
        }
      }
    }
  }

  reset() {
    for (const p of this.projectiles) p.active = false;
    for (const b of this.ricochetBolts) b.active = false;
    for (const d of this.damageNumbers) d.active = false;
    this.pendingLevelUp = false;
  }
}
