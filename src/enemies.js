import {
  CANVAS_WIDTH, CANVAS_HEIGHT, MAX_ENEMIES,
  ENEMY_BASE_HP, ENEMY_BASE_SPEED, ENEMY_RADIUS,
  ENEMY_CONTACT_DAMAGE, ENEMY_SPAWN_INTERVAL_START, ENEMY_SPAWN_INTERVAL_MIN,
  TARGET_DISTANCE
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
    this.color = '#8e44ad';
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

export class Spawner {
  constructor() {
    this.pool = [];
    for (let i = 0; i < MAX_ENEMIES; i++) {
      this.pool.push(new Enemy());
    }
    this.spawnTimer = 1; // start with a brief delay
  }

  get activeEnemies() {
    return this.pool.filter(e => e.active);
  }

  update(dt, distance, carBounds, stationDifficulty = 1) {
    // Difficulty scales with distance AND station depth
    const distDiff = 1 + (distance / TARGET_DISTANCE) * 4;
    const difficulty = distDiff * stationDifficulty;
    const interval = Math.max(
      ENEMY_SPAWN_INTERVAL_MIN / stationDifficulty,
      ENEMY_SPAWN_INTERVAL_START / stationDifficulty - difficulty * 0.2
    );

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      // Spawn more enemies per tick at higher difficulty
      const spawnCount = Math.min(4, Math.floor(stationDifficulty));
      for (let i = 0; i < spawnCount; i++) this.spawnEnemy(difficulty, carBounds);
      this.spawnTimer = interval;
    }
  }

  static COLORS = ['#8e44ad', '#c0392b', '#e74c3c'];
  static RADIUS_MULT = [1.5, 5, 5];
  static HP_MULT = [1, 4, 6];

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
    enemy.radius = ENEMY_RADIUS * Spawner.RADIUS_MULT[colorIdx];
    enemy.hp = hp * Spawner.HP_MULT[colorIdx];
    enemy.maxHp = enemy.hp;

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
  }
}
