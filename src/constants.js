// Canvas
export const CANVAS_WIDTH = 960;
export const CANVAS_HEIGHT = 640;

// Train
export const CAR_WIDTH = 32;
export const CAR_HEIGHT = 14;
export const CAR_GAP = 6;
export const TRAIN_MAX_HP = 100;
export const TRAIN_SPEED = 167; // px/sec (~60s to cover 10000)
export const CARGO_BOXES_START = 4; // starting cargo boxes
export const CARGO_MULTIPLIER_PER_BOX = 0.25; // each box = +0.25x multiplier

// Camera: train sits at 30% from left
export const CAMERA_TRAIN_X = CANVAS_WIDTH * 0.3;

// Weapon mounts
export const MOUNT_RADIUS = 8;
export const WEAPON_CONE_HALF_ANGLE = Math.PI / 4;
export const WEAPON_RANGE = 220;
export const WEAPON_FIRE_RATE = 5;
export const WEAPON_DAMAGE = 12;
export const PROJECTILE_SPEED = 350;
export const PROJECTILE_LIFETIME = 2;
export const PROJECTILE_RADIUS = 3;

// Driver buff
export const DRIVER_DAMAGE_BUFF = 1.5;

// Crew
export const CREW_REASSIGN_COOLDOWN = 1;
export const CREW_RADIUS = 8;
export const CREW_COLORS = ['#e74c3c', '#3498db', '#2ecc71'];

// Enemies
export const ENEMY_BASE_HP = 20;
export const ENEMY_BASE_SPEED = 50;
export const ENEMY_RADIUS = 6;
export const ENEMY_CONTACT_DAMAGE = 6;
export const ENEMY_SPAWN_INTERVAL_START = 1.5;
export const ENEMY_SPAWN_INTERVAL_MIN = 0.25;

// XP / Levels
export const XP_PER_KILL = 12;
export const XP_PER_LEVEL = 30;

// Coins
export const COIN_RADIUS = 8;
export const COIN_SPAWN_INTERVAL = 3;
export const COIN_VALUE = 10; // each coin = 10 gold
export const MAX_COINS = 30;
export const MAX_FLYING_COINS = 30;
export const COIN_FLY_SPEED = 400;

// Auto-Weapons (VS-style, gained via level-up)
export const MAX_AUTO_WEAPON_LEVEL = 5;
export const AUTO_WEAPONS = {
  turret: {
    id: 'turret', name: 'Turret', icon: '🔫', color: '#ffb74d',
    desc: 'Auto-targets nearest enemy',
    levels: [
      { shotsPerBurst: 1, damage: 10, fireInterval: 1.2, range: 250 },
      { shotsPerBurst: 2, damage: 12, fireInterval: 1.1, range: 270 },
      { shotsPerBurst: 3, damage: 14, fireInterval: 1.0, range: 290 },
      { shotsPerBurst: 4, damage: 16, fireInterval: 0.9, range: 310 },
      { shotsPerBurst: 5, damage: 18, fireInterval: 0.8, range: 340 },
    ],
  },
  steamBlast: {
    id: 'steamBlast', name: 'Steam Blast', icon: '💨', color: '#8ecae6',
    desc: 'Aura that damages nearby enemies',
    levels: [
      { radius: 80,  damage: 4,  tickRate: 0.5 },
      { radius: 100, damage: 6,  tickRate: 0.45 },
      { radius: 125, damage: 9,  tickRate: 0.4 },
      { radius: 155, damage: 13, tickRate: 0.35 },
      { radius: 190, damage: 18, tickRate: 0.3 },
    ],
  },
  ricochetShot: {
    id: 'ricochetShot', name: 'Laser', icon: '⚡', color: '#b388ff',
    desc: 'Laser that bounces between enemies',
    levels: [
      { bounces: 2, damage: 8,  fireInterval: 2.5, speed: 300 },
      { bounces: 3, damage: 10, fireInterval: 2.2, speed: 320 },
      { bounces: 4, damage: 13, fireInterval: 1.9, speed: 340 },
      { bounces: 5, damage: 16, fireInterval: 1.6, speed: 360 },
      { bounces: 7, damage: 20, fireInterval: 1.3, speed: 400 },
    ],
  },
};

// Run
export const TARGET_DISTANCE = 10000;

// Pools
export const MAX_ENEMIES = 150; // big for late-game swarms
export const MAX_PROJECTILES = 300;
export const MAX_RICOCHET_BOLTS = 10;
export const MAX_DAMAGE_NUMBERS = 80;
