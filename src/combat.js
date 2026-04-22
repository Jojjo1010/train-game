import {
  CANVAS_WIDTH, CANVAS_HEIGHT,
  MAX_PROJECTILES, PROJECTILE_SPEED, PROJECTILE_LIFETIME, PROJECTILE_RADIUS,
  DRIVER_DAMAGE_BUFF, XP_PER_KILL, MAX_RICOCHET_BOLTS, MAX_DAMAGE_NUMBERS,
  UNMANNED_EFFECTIVENESS
} from './constants.js';
import { playShoot, playEnemyHit, playEnemyKill, playTrainDamage } from './audio.js';
import { spawnDamageNumber as spawnAttribution } from './damageAttribution.js';

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
    this.source = 'crew';
    this.color = '#ffeeaa';
  }

  spawn(x, y, angle, damage, source = 'crew', color = '#ffeeaa') {
    this.active = true;
    this.x = x;
    this.y = y;
    this.vx = Math.cos(angle) * PROJECTILE_SPEED;
    this.vy = Math.sin(angle) * PROJECTILE_SPEED;
    this.damage = damage;
    this.lifetime = PROJECTILE_LIFETIME;
    this.source = source;
    this.color = color;
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
    this.lifetime = 4; // seconds before expiring if no hits
    this.hitEnemies.clear();
  }

  update(dt) {
    if (!this.active) return;
    this.prevX = this.x;
    this.prevY = this.y;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.lifetime -= dt;
    if (this.lifetime <= 0) { this.active = false; return; }

    // Bounce off screen edges (free, doesn't cost a bounce)
    if (this.x < 0) { this.x = 0; this.vx = Math.abs(this.vx); }
    else if (this.x > CANVAS_WIDTH) { this.x = CANVAS_WIDTH; this.vx = -Math.abs(this.vx); }
    if (this.y < 0) { this.y = 0; this.vy = Math.abs(this.vy); }
    else if (this.y > CANVAS_HEIGHT) { this.y = CANVAS_HEIGHT; this.vy = -Math.abs(this.vy); }
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
    // Kill effects: consumed each frame by the renderer
    this.killEffects = []; // { x, y, color }
    // Muzzle flashes: queued when a crew (manual) weapon fires, consumed each frame
    this.muzzleFlashes = []; // { x, y }
    // Hit sparks: queued when a projectile deals non-lethal damage, consumed each frame
    this.hitSparks = []; // { x, y }
  }

  handleEnemyDamageResult(e, train, ex = 0, ey = 0, ecolor = '#2d6a2e') {
    if (!e.active) {
      playEnemyKill();
      const leveled = train.addXP(XP_PER_KILL);
      if (leveled) this.pendingLevelUp = true;
      // Queue a kill effect at the enemy's last position
      this.killEffects.push({ x: ex, y: ey, color: ecolor });
    } else {
      playEnemyHit();
    }
  }

  spawnDamageNumber(x, y, damage) {
    const d = this.damageNumbers.find(n => !n.active);
    if (d) d.spawn(x, y, damage);
  }

  leadAngle(mount, target) {
    const dx = target.x - mount.worldX;
    const dy = target.y - mount.worldY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const t = dist / PROJECTILE_SPEED;
    const lx = target.x + (target.vx || 0) * t;
    const ly = target.y + (target.vy || 0) * t;
    return Math.atan2(ly - mount.worldY, lx - mount.worldX);
  }

  update(dt, train, enemies, selectedCrew = null) {
    // Update existing projectiles
    for (const p of this.projectiles) p.update(dt);
    // Update damage numbers
    for (const d of this.damageNumbers) d.update(dt);

    // Manned weapons — selected crew aims manually, unselected crew auto-targets
    const hasDriver = train.hasDriver;
    const areaMult = train.totalAreaMultiplier;

    // Unmanned crew mounts: fire at reduced effectiveness (30% damage, 40% fire rate)
    const UNMANNED_DAMAGE_MULT = 0.30;
    const UNMANNED_RATE_MULT = 0.40;

    // Phase 1: rotate cones — manned crew, auto-weapons, AND unmanned crew mounts
    for (const mount of train.allMounts) {
      if (mount.crew === selectedCrew) continue; // selected crew aims via mouse
      const isAutoWeapon = mount.hasAutoWeapon && !mount.isManned;
      const isCrew = mount.isManned && !mount.hasAutoWeapon;
      const isUnmanned = !mount.isManned && !mount.hasAutoWeapon;
      if (!isAutoWeapon && !isCrew && !isUnmanned) continue;
      const nearest = this.findClosestEnemy(mount, enemies, areaMult);
      if (nearest) {
        const desiredAngle = mount.clampAngle(
          Math.atan2(nearest.y - mount.worldY, nearest.x - mount.worldX)
        );
        const diff = normalizeAngle(desiredAngle - mount.coneDirection);
        // Unmanned rotates slower (sloppy aim without crew)
        const rotSpeed = isAutoWeapon ? 1.5 : (isCrew ? 2.0 : 0.8);
        const maxRot = rotSpeed * dt;
        if (Math.abs(diff) < maxRot) {
          mount.coneDirection = desiredAngle;
        } else {
          mount.coneDirection += Math.sign(diff) * maxRot;
        }
      }
    }

    // Phase 2: fire crew weapons (manned at full power, unmanned at reduced)
    for (const mount of train.allMounts) {
      if (mount.hasAutoWeapon) continue; // auto-weapons handled separately
      const manned = mount.isManned;

      // Bandit suppression: weakens over time instead of instant hard-lock
      let banditMult = 1.0;
      if (mount._bandit) {
        // state 2 = ON_TRAIN; anything else (FIGHTING) = crew is busy, fully suppressed
        if (mount._bandit.state !== 2) { banditMult = 0; }
        else {
          const dwell = mount._bandit.dwellTime;
          if (dwell < 4)       banditMult = 0.8;  // barely interfering yet
          else if (dwell < 9)  banditMult = 0.3;  // actively disrupting
          else                 banditMult = 0;     // fully jammed
        }
      }
      if (banditMult <= 0) continue;

      mount.cooldownTimer -= dt;
      if (mount.cooldownTimer > 0) continue;

      if (manned) {
        // --- Manned: full power, crew bonuses apply (rare — crew triggers fight) ---
        const target = this.findTarget(mount, enemies, areaMult);
        if (!target) continue;
        const angle = this.leadAngle(mount, target);

        let damage = mount.damage * train.totalDamageMultiplier * banditMult;
        if (hasDriver) damage *= DRIVER_DAMAGE_BUFF;
        if (mount.crew.role === 'Gunner') damage *= 2.0;
        if (train.hasBuddyBonus(mount)) damage *= 1.15;

        this.fireProjectile(mount.worldX, mount.worldY, angle, damage, 'crew', mount.crew.color);
        mount.cooldownTimer = (1 / (mount.fireRate * banditMult)) * train.totalCooldownMultiplier;
        if (mount.screenX !== undefined && mount.screenY !== undefined) {
          this.muzzleFlashes.push({ x: mount.screenX, y: mount.screenY });
        }
        playShoot();
      } else {
        // --- Unmanned: degraded auto-fire, stacks with bandit suppression ---
        const target = this.findTarget(mount, enemies, areaMult);
        if (!target) continue;
        const angle = this.leadAngle(mount, target);

        const baseDmg = mount.damage;
        const damage = baseDmg * train.totalDamageMultiplier * UNMANNED_DAMAGE_MULT * banditMult;

        this.fireProjectile(mount.worldX, mount.worldY, angle, damage, 'unmanned', '#888888');
        const effectiveRate = mount.fireRate * UNMANNED_RATE_MULT * banditMult;
        mount.cooldownTimer = (1 / effectiveRate) * train.totalCooldownMultiplier;
      }
    }

    // Projectile-enemy collision
    this.checkProjectileHits(enemies, train);

    // Auto-weapons (VS-style)
    this.updateAutoWeapons(dt, train, enemies);

    // Enemy-train collision
    this.checkEnemyTrainCollision(enemies, train);
  }

  // Find nearest enemy in range, no cone restriction (for auto-aiming crew)
  findClosestEnemy(mount, enemies, areaMult = 1) {
    let closest = null;
    const range = mount.range * areaMult;
    let closestDist = range * range;

    for (const e of enemies) {
      if (!e.active) continue;
      const dx = e.x - mount.worldX;
      const dy = e.y - mount.worldY;
      const distSq = dx * dx + dy * dy;
      if (distSq < closestDist) {
        closest = e;
        closestDist = distSq;
      }
    }
    return closest;
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

  fireProjectile(x, y, angle, damage, source = 'crew', color = '#ffeeaa') {
    const proj = this.projectiles.find(p => !p.active);
    if (proj) proj.spawn(x, y, angle, damage, source, color);
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
          const ex = e.x, ey = e.y, ecolor = e.color;
          const hitX = p.x, hitY = p.y;
          e.takeDamage(p.damage, p.vx, p.vy);
          p.active = false;
          this.handleEnemyDamageResult(e, train, ex, ey, ecolor);
          // Queue hit spark when enemy survives (non-lethal hit)
          if (e.active) this.hitSparks.push({ x: hitX, y: hitY });
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
          const actualDmg = e.damage * train.lastStandDamageMultiplier;
          train.hp -= actualDmg;
          train.damageFlash = 0.25;
          train.shakeTimer = 0.2;
          train.hpFlashTimer = 0.4;
          playTrainDamage();
          // Floating damage attribution (red — enemy contact)
          spawnAttribution(`-${Math.round(actualDmg)}`, e.x, e.y, '#ff4444');
          e.active = false;
          break;
        }
      }
    }
  }

  // === AUTO-WEAPONS (fire from their mount position) ===
  updateAutoWeapons(dt, train, enemies) {
    const dmgMult = train.totalDamageMultiplier;
    let cdMult = train.totalCooldownMultiplier;
    const areaMult = train.totalAreaMultiplier;

    // --- TURRET ---
    if (train.hasAutoWeapon('turret')) {
      const w = train.autoWeapons.turret;
      const m = w.mount;
      const tbm = this._banditMult(m);
      if (tbm > 0) {
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
            if (d >= closestDist) continue;
            const angleToE = Math.atan2(dy, dx);
            const diff = Math.abs(normalizeAngle(angleToE - m.coneDirection));
            if (diff > m.coneHalfAngle) continue;
            closest = e; closestDist = d;
          }
          if (closest) {
            const dmg = stats.damage * dmgMult * tbm;
            for (let s = 0; s < stats.shotsPerBurst; s++) {
              const dist = Math.sqrt(closestDist);
              const t = dist / PROJECTILE_SPEED;
              const lx = closest.x + (closest.vx || 0) * t;
              const ly = closest.y + (closest.vy || 0) * t;
              const angle = Math.atan2(ly - my, lx - mx) + (s - (stats.shotsPerBurst - 1) / 2) * 0.08;
              this.fireProjectile(mx, my, angle, dmg, 'auto', '#ff8800');
            }
            m.coneDirection = m.clampAngle(Math.atan2(closest.y - my, closest.x - mx));
            playShoot();
            w.cooldownTimer = stats.fireInterval * cdMult / tbm;
          }
        }
      }
    }

    // --- STEAM BLAST ---
    if (train.hasAutoWeapon('steamBlast')) {
      const w = train.autoWeapons.steamBlast;
      const m = w.mount;
      const sbm = this._banditMult(m);
      if (sbm > 0) {
        const mx = m.worldX, my = m.worldY;
        const stats = train.getAutoWeaponStats('steamBlast');
        w.tickTimer -= dt;
        if (w.tickTimer <= 0) {
          w.tickTimer = stats.tickRate * cdMult / sbm;
          const r = stats.radius * areaMult;
          const r2 = r * r;
          const dmg = stats.damage * dmgMult * sbm;
          for (const e of enemies) {
            if (!e.active) continue;
            const dx = e.x - mx, dy = e.y - my;
            if (dx * dx + dy * dy <= r2) {
              this.spawnDamageNumber(e.x, e.y, dmg);
              const ex = e.x, ey = e.y, ecolor = e.color;
              e.takeDamage(dmg);
              this.handleEnemyDamageResult(e, train, ex, ey, ecolor);
            }
          }
        }
      }
    }

    // --- RICOCHET SHOT ---
    if (train.hasAutoWeapon('ricochetShot')) {
      const w = train.autoWeapons.ricochetShot;
      const m = w.mount;
      const rbm = this._banditMult(m);
      if (rbm > 0) {
        const mx = m.worldX, my = m.worldY;
        const stats = train.getAutoWeaponStats('ricochetShot');
        w.cooldownTimer -= dt;
        if (w.cooldownTimer <= 0) {
          w.cooldownTimer = stats.fireInterval * cdMult / rbm;
          const angle = Math.random() * Math.PI * 2;
          const bolt = this.ricochetBolts.find(b => !b.active);
          if (bolt) bolt.spawn(mx, my, angle, stats.damage * dmgMult * rbm, stats.bounces, stats.speed);
        }
      }
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
          const ex = e.x, ey = e.y, ecolor = e.color;
          e.takeDamage(bolt.damage, bolt.vx, bolt.vy);
          bolt.hitEnemies.add(e);
          this.handleEnemyDamageResult(e, train, ex, ey, ecolor);
          bolt.bouncesLeft--;
          if (bolt.bouncesLeft <= 0) {
            bolt.active = false;
          } else {
            // Find nearest un-hit enemy to bounce toward
            let nextTarget = null;
            let nextDist = 500 * 500;
            for (const e2 of enemies) {
              if (!e2.active || bolt.hitEnemies.has(e2)) continue;
              const d2 = (bolt.x - e2.x) ** 2 + (bolt.y - e2.y) ** 2;
              if (d2 < nextDist) { nextTarget = e2; nextDist = d2; }
            }
            if (nextTarget) {
              bolt.redirectToward(nextTarget.x, nextTarget.y);
            }
            // No nearby target: bolt keeps flying in current direction
            // and can still bounce off screen edges or hit enemies later
          }
          break;
        }
      }
    }
  }

  // Returns 1.0 (no bandit) down to 0.0 (fully jammed) based on bandit dwell time
  _banditMult(mount) {
    if (!mount._bandit) return 1.0;
    if (mount._bandit.state !== 2) return 0.0; // FIGHTING = fully occupied
    const dwell = mount._bandit.dwellTime;
    if (dwell < 4)  return 0.8;  // barely interfering
    if (dwell < 9)  return 0.3;  // actively disrupting
    return 0.0;                   // fully jammed
  }

  reset() {
    for (const p of this.projectiles) p.active = false;
    for (const b of this.ricochetBolts) b.active = false;
    for (const d of this.damageNumbers) d.active = false;
    this.pendingLevelUp = false;
    this.killEffects.length = 0;
    this.muzzleFlashes.length = 0;
    this.hitSparks.length = 0;
  }
}
