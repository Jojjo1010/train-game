import {
  CAR_WIDTH, CAR_HEIGHT, CAR_GAP, TRAIN_MAX_HP,
  MOUNT_RADIUS, WEAPON_CONE_HALF_ANGLE, AUTO_WEAPON_CONE_HALF_ANGLE, WEAPON_RANGE,
  WEAPON_FIRE_RATE, WEAPON_DAMAGE, CREW_COLORS,
  XP_PER_LEVEL, CARGO_BOXES_START, CARGO_MULTIPLIER_PER_BOX,
  AUTO_WEAPONS, MAX_AUTO_WEAPON_LEVEL, SHOP_TUNING,
  MANUAL_GUN
} from './constants.js';

const CREW_MOVE_SPEED = 85; // px/sec (was 120 — slowed for meaningful transit cost)
const DOOR_PAUSE = 0.55;    // seconds to pass through a door (was 0.35)

export class WeaponMount {
  constructor(localX, localY, baseDirection) {
    this.localX = localX;
    this.localY = localY;
    this.baseDirection = baseDirection; // fixed outward angle, never changes
    this.coneDirection = baseDirection; // current aim within allowed arc
    this.coneHalfAngle = WEAPON_CONE_HALF_ANGLE;
    this.cooldownTimer = 0;
    this.crew = null;
    this.worldX = 0;
    this.worldY = 0;
    this.autoWeaponId = null;
  }

  // Clamp an angle to within the allowed arc (baseDirection ± coneHalfAngle)
  clampAngle(angle) {
    let diff = angle - this.baseDirection;
    // Normalize to [-PI, PI]
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    if (Math.abs(diff) <= this.coneHalfAngle) return angle;
    // Clamp to nearest edge
    return this.baseDirection + Math.sign(diff) * this.coneHalfAngle;
  }

  get isManned() {
    return this.crew !== null;
  }

  get hasAutoWeapon() {
    return this.autoWeaponId !== null;
  }

  get isOccupied() {
    return this.crew !== null || this.autoWeaponId !== null;
  }

  get damage() {
    const lvl = this.crew ? this.crew.gunLevel : 1;
    const stats = MANUAL_GUN.levels[lvl - 1];
    return stats ? stats.damage : WEAPON_DAMAGE;
  }

  get fireRate() {
    const lvl = this.crew ? this.crew.gunLevel : 1;
    const stats = MANUAL_GUN.levels[lvl - 1];
    return stats ? stats.fireRate : WEAPON_FIRE_RATE;
  }

  get range() {
    const lvl = this.crew ? this.crew.gunLevel : 1;
    const stats = MANUAL_GUN.levels[lvl - 1];
    return stats ? stats.range : WEAPON_RANGE;
  }
}

export class DriverSeat {
  constructor(localX, localY) {
    this.localX = localX;
    this.localY = localY;
    this.crew = null;
    this.isDriverSeat = true;
    this.worldX = 0;
    this.worldY = 0;
  }
}

export class Door {
  constructor() {
    this.openAmount = 0; // 0 = closed, 1 = open
    this.isOpening = false;
  }

  update(dt) {
    if (this.isOpening) {
      this.openAmount = Math.min(1, this.openAmount + dt / (DOOR_PAUSE * 0.5));
    } else {
      this.openAmount = Math.max(0, this.openAmount - dt / (DOOR_PAUSE * 0.5));
    }
  }
}

export class TrainCar {
  constructor(type, index) {
    this.type = type;
    this.index = index;
    this.width = CAR_WIDTH;
    this.height = CAR_HEIGHT;
    this.localX = index * (CAR_WIDTH + CAR_GAP);
    this.mounts = [];
    this.driverSeat = null;
    this.worldX = 0;
    this.worldY = 0;
    // Door on the RIGHT side of this car (connecting to next car)
    this.doorRight = new Door();

    if (type === 'weapon') {
      const m = MOUNT_RADIUS + 2;
      // Base directions face outward from train center
      this.mounts.push(new WeaponMount(m, m, -Math.PI * 3 / 4));                // top-left → up-left
      this.mounts.push(new WeaponMount(CAR_WIDTH - m, m, -Math.PI / 4));         // top-right → up-right
      this.mounts.push(new WeaponMount(m, CAR_HEIGHT - m, Math.PI * 3 / 4));     // bottom-left → down-left
      this.mounts.push(new WeaponMount(CAR_WIDTH - m, CAR_HEIGHT - m, Math.PI / 4)); // bottom-right → down-right
    } else if (type === 'locomotive') {
      this.driverSeat = new DriverSeat(CAR_WIDTH / 2, CAR_HEIGHT / 2);
    }
  }

  // Door world positions (right side of car)
  get doorRightX() { return this.worldX + this.width + CAR_GAP / 2; }
  get doorRightY() { return this.worldY + this.height / 2; }
}

const CREW_ROLES = ['Gunner', 'Engineer', 'Medic'];
const CREW_NAMES = ['Rex', 'Kit', 'Rosa'];

export class CrewMember {
  constructor(id) {
    this.id = id;
    this.color = CREW_COLORS[id];
    this.name = CREW_NAMES[id] || null;
    this.role = CREW_ROLES[id] || null; // Gunner, Engineer, Medic
    this.assignment = null;
    this.reassignCooldown = 0;
    this.panelX = 0;
    this.panelY = 0;

    this.gunLevel = 1; // personal manual gun level (1-5)
    this.weaponId = null;
    this.weaponLevel = 0;

    // Movement state
    this.isMoving = false;
    this.moveX = 0;
    this.moveY = 0;
    this.movePath = [];      // array of {x, y, pause} waypoints
    this.moveTargetSlot = null;
    this.pauseTimer = 0;

    // Medic stationary tracking — regen only after 3+ seconds stationary
    this.stationaryTime = 0;
  }

  startMove(fromX, fromY, targetSlot, path) {
    this.isMoving = true;
    this.moveX = fromX;
    this.moveY = fromY;
    this.movePath = path;
    this.moveTargetSlot = targetSlot;
    this.pauseTimer = 0;
    this.stationaryTime = 0; // reset Medic regen timer on movement
  }

  updateMove(dt) {
    if (!this.isMoving) return false;

    // Pausing at a door
    if (this.pauseTimer > 0) {
      this.pauseTimer -= dt;
      return false;
    }

    // No more waypoints → arrived
    if (this.movePath.length === 0) {
      this.isMoving = false;
      return true; // signal: arrived
    }

    const wp = this.movePath[0];
    const dx = wp.x - this.moveX;
    const dy = wp.y - this.moveY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 2) {
      // Reached waypoint
      this.moveX = wp.x;
      this.moveY = wp.y;
      if (wp.pause) {
        this.pauseTimer = wp.pause;
      }
      this.movePath.shift();
      return false;
    }

    // Move toward waypoint
    const step = CREW_MOVE_SPEED * dt;
    this.moveX += (dx / dist) * Math.min(step, dist);
    this.moveY += (dy / dist) * Math.min(step, dist);
    return false;
  }
}

export class Train {
  constructor() {
    this.cars = [
      new TrainCar('weapon', 0),
      new TrainCar('cargo', 1),
      new TrainCar('weapon', 2),
      new TrainCar('locomotive', 3),
    ];
    this.hp = TRAIN_MAX_HP;
    this.maxHp = TRAIN_MAX_HP;
    this.distance = 0;
    this.xp = 0;
    this.level = 1;
    this.runGold = 0; // gold collected during this run
    this.cargoBoxes = CARGO_BOXES_START;
    this.damageFlash = 0;
    this.shakeTimer = 0;
    this.hpFlashTimer = 0;
    this.armorReduction = 0;
    this.greedMultiplier = 1;
    this._regenRate = 0;

    // Hidden last-stand forgiveness (invisible to player)
    this.lastStandTimer = 0;

    // Auto-weapons (VS-style) — max 2
    this.autoWeapons = {};
    this.maxAutoWeapons = 2;

    // Defense slots — max 2 equipped defenses (level-up choices)
    this.defenseSlots = []; // array of { id, name, icon, color, level }
    this.maxDefenseSlots = 2;

    // In-run passives (defence + modifiers, gained via level-up)
    this.passives = {
      shield:   0, // level 0-5, each = -2 damage taken
      maxHp:    0, // level 0-5, each = +15 max HP
      coolOff:  0, // level 0-5, each = -10% cooldown
      baseArea: 0, // level 0-5, each = +15% range/radius
      damage:   0, // level 0-5, each = +15% damage
    };

    // Start with 2 crew — third recruited via level-up or shop
    this.crew = [
      new CrewMember(0),
      new CrewMember(1),
    ];
    this.maxCrew = 3;
  }

  get allMounts() {
    if (!this._mounts) this._mounts = this.cars.flatMap(c => c.mounts);
    return this._mounts;
  }

  get allSlots() {
    if (!this._slots) this._slots = this.cars.flatMap(c => [...c.mounts, ...(c.driverSeat ? [c.driverSeat] : [])]);
    return this._slots;
  }

  // Hidden last-stand forgiveness: reduce incoming damage by 30% for 3s when HP < 15%
  updateLastStand(dt) {
    if (this.lastStandTimer > 0) {
      this.lastStandTimer -= dt;
    }
    if (this.hp < this.maxHp * 0.15 && this.lastStandTimer <= 0) {
      this.lastStandTimer = 3.0;
    }
  }

  get lastStandDamageMultiplier() {
    return this.lastStandTimer > 0 ? 0.7 : 1.0;
  }

  // Buddy bonus: check if a crew member on a given mount has an adjacent crewed mount
  hasBuddyBonus(mount) {
    if (!mount.crew) return false;
    const mounts = this.allMounts;
    const idx = mounts.indexOf(mount);
    if (idx < 0) return false;
    // Check mount at index-1 and index+1
    if (idx > 0 && mounts[idx - 1].crew) return true;
    if (idx < mounts.length - 1 && mounts[idx + 1].crew) return true;
    return false;
  }

  get cargoMultiplier() {
    return 1.0 + this.cargoBoxes * CARGO_MULTIPLIER_PER_BOX;
  }

  get xpToNextLevel() {
    return this.level * XP_PER_LEVEL;
  }

  addXP(amount) {
    this.xp += amount;
    if (this.xp >= this.xpToNextLevel) {
      this.xp -= this.xpToNextLevel;
      this.level++;
      return true;
    }
    return false;
  }

  acquireAutoWeapon(weaponId) {
    if (this.autoWeapons[weaponId]) return false;
    // Find first empty mount (no crew, no auto-weapon)
    const mount = this.allMounts.find(m => !m.isOccupied);
    if (!mount) return false;
    mount.autoWeaponId = weaponId;
    mount.coneHalfAngle = AUTO_WEAPON_CONE_HALF_ANGLE;
    this.autoWeapons[weaponId] = { level: 1, cooldownTimer: 0, tickTimer: 0, mount };
    return true;
  }

  upgradeAutoWeapon(weaponId) {
    const w = this.autoWeapons[weaponId];
    if (!w || w.level >= MAX_AUTO_WEAPON_LEVEL) return;
    w.level++;
  }

  get autoWeaponCount() { return Object.keys(this.autoWeapons).length; }
  get canAddAutoWeapon() { return this.autoWeaponCount < this.maxAutoWeapons && this.hasEmptyMount; }

  hasAutoWeapon(weaponId) { return !!this.autoWeapons[weaponId]; }

  // Defense slot helpers
  hasDefense(defId) { return this.defenseSlots.some(d => d.id === defId); }
  getDefenseLevel(defId) { return this.defenseSlots.find(d => d.id === defId)?.level || 0; }
  get canAddDefense() { return this.defenseSlots.length < this.maxDefenseSlots; }

  addOrUpgradeDefense(def) {
    const existing = this.defenseSlots.find(d => d.id === def.id);
    if (existing) {
      existing.level++;
      return;
    }
    if (this.defenseSlots.length >= this.maxDefenseSlots) return;
    this.defenseSlots.push({ id: def.id, name: def.name, icon: def.icon, color: def.color, level: 1 });
  }

  autoWeaponLevel(weaponId) {
    return this.autoWeapons[weaponId]?.level || 0;
  }

  getAutoWeaponStats(weaponId) {
    const w = this.autoWeapons[weaponId];
    if (!w) return null;
    return AUTO_WEAPONS[weaponId].levels[w.level - 1];
  }

  getAutoWeaponMount(weaponId) {
    return this.autoWeapons[weaponId]?.mount || null;
  }

  get hasEmptyMount() {
    return this.allMounts.some(m => !m.isOccupied);
  }

  // Train center (cargo car)
  get centerX() { return this.cars[1].worldX + CAR_WIDTH / 2; }
  get centerY() { return this.cars[1].worldY + CAR_HEIGHT / 2; }

  // Passive modifier multipliers (stack with shop upgrades)
  get totalDamageMultiplier() { return 1 + this.passives.damage * (SHOP_TUNING.damage.perLevel / 100); }
  get totalCooldownMultiplier() { return 1 - this.passives.coolOff * (SHOP_TUNING.coolOff.perLevel / 100); }
  get totalAreaMultiplier() { return 1 + this.passives.baseArea * (SHOP_TUNING.baseArea.perLevel / 100); }
  get totalShieldReduction() { return this.armorReduction + this.passives.shield * SHOP_TUNING.shield.perLevel; }

  recruitCrew() {
    if (this.crew.length >= this.maxCrew) return;
    const newCrew = new CrewMember(this.crew.length);
    this.crew.push(newCrew);
  }

  get canRecruit() {
    return this.crew.length < this.maxCrew;
  }

  get hasDriver() {
    const loco = this.cars.find(c => c.type === 'locomotive');
    return loco && loco.driverSeat && loco.driverSeat.crew !== null;
  }

  // Role helpers — true when the crew member exists, is assigned, and not walking
  isRoleStationed(role) {
    const c = this.crew.find(m => m.role === role);
    return c && c.assignment && !c.isMoving;
  }

  get engineerStationed() { return this.isRoleStationed('Engineer'); }
  get medicStationed() { return this.isRoleStationed('Medic'); }

  updateWorldPositions(screenX, screenY) {
    for (const car of this.cars) {
      car.worldX = screenX + car.localX;
      car.worldY = screenY;
      for (const m of car.mounts) {
        m.worldX = car.worldX + m.localX;
        m.worldY = car.worldY + m.localY;
      }
      if (car.driverSeat) {
        car.driverSeat.worldX = car.worldX + car.driverSeat.localX;
        car.driverSeat.worldY = car.worldY + car.driverSeat.localY;
      }
    }
  }

  // Find which car a slot belongs to
  findCarForSlot(slot) {
    for (const car of this.cars) {
      if (car.mounts.includes(slot)) return car;
      if (car.driverSeat === slot) return car;
    }
    return null;
  }

  // Build a path of waypoints from (startX, startY) on startCar to targetSlot
  // Route: center of start car → doors between cars → center of target car → slot position
  buildCrewPath(startX, startY, startCar, targetSlot) {
    const targetCar = this.findCarForSlot(targetSlot);
    if (!targetCar) return [];

    const path = [];
    const cy = startCar.worldY + CAR_HEIGHT / 2; // corridor Y (center of cars)

    if (startCar === targetCar) {
      // Same car: move directly to slot
      path.push({ x: targetSlot.worldX, y: targetSlot.worldY, pause: 0 });
      return path;
    }

    // Move to center corridor height first
    path.push({ x: startX, y: cy, pause: 0 });

    // Traverse through cars via doors
    const startIdx = startCar.index;
    const endIdx = targetCar.index;
    const dir = endIdx > startIdx ? 1 : -1;

    for (let i = startIdx; i !== endIdx; i += dir) {
      const fromCar = this.cars[i];
      const toCar = this.cars[i + dir];
      const doorCar = dir > 0 ? fromCar : toCar;

      // Move to door
      const doorX = doorCar.doorRightX;
      const doorY = doorCar.doorRightY;
      path.push({ x: doorX, y: doorY, pause: DOOR_PAUSE, doorCar: doorCar });

      // Move into next car center
      const nextCenterX = toCar.worldX + CAR_WIDTH / 2;
      path.push({ x: nextCenterX, y: cy, pause: 0 });
    }

    // Final: move to target slot
    path.push({ x: targetSlot.worldX, y: targetSlot.worldY, pause: 0 });

    return path;
  }

  // Start animated crew movement (run phase only)
  startCrewMove(crew, fromX, fromY, fromCar, targetSlot) {
    // Reserve the target slot
    if (targetSlot.crew) {
      targetSlot.crew.assignment = null;
    }
    const path = this.buildCrewPath(fromX, fromY, fromCar, targetSlot);
    crew.startMove(fromX, fromY, targetSlot, path);
  }

  // Instant assign (setup phase)
  assignCrew(crew, slot) {
    // Can't place crew on a mount with an auto-weapon (unless bandit is there)
    if (slot.autoWeaponId && !slot._bandit) return false;
    if (crew.assignment) {
      crew.assignment.crew = null;
    }
    if (slot.crew) {
      slot.crew.assignment = null;
    }
    crew.assignment = slot;
    slot.crew = crew;
    crew.isMoving = false;
    crew.movePath = [];
    return true;
  }

  unassignCrew(crew) {
    if (crew.assignment) {
      crew.assignment.crew = null;
      crew.assignment = null;
    }
  }

  // Update moving crew and doors each frame
  updateCrewMovement(dt) {
    // Update doors
    for (const car of this.cars) {
      car.doorRight.isOpening = false;
    }

    // Check which doors need to be open (crew passing through)
    for (const c of this.crew) {
      if (!c.isMoving || c.movePath.length === 0) continue;
      const wp = c.movePath[0];
      if (wp.doorCar) {
        wp.doorCar.doorRight.isOpening = true;
      }
    }

    for (const car of this.cars) {
      car.doorRight.update(dt);
    }

    // Update crew positions
    for (const c of this.crew) {
      if (c.isMoving) {
        c.stationaryTime = 0; // reset while moving
        const arrived = c.updateMove(dt);
        if (arrived && c.moveTargetSlot) {
          // Assign to target
          this.assignCrew(c, c.moveTargetSlot);
          c.moveTargetSlot = null;
        }
      } else if (c.assignment) {
        // Accumulate stationary time when assigned and not moving
        c.stationaryTime += dt;
      }
    }
  }
}
