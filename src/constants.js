// Game tuning — loaded synchronously from tuning.json on module init
let _t = {};
try {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', '/tuning.json', false); // synchronous
  xhr.send();
  if (xhr.status === 200) _t = JSON.parse(xhr.responseText);
} catch (e) {
  console.warn('Could not load tuning.json, using defaults');
}
const T = (key, fallback) => _t[key] ?? fallback;

// Canvas
export const CANVAS_WIDTH = 960;
export const CANVAS_HEIGHT = 640;

// Train
export const CAR_WIDTH = T('CAR_WIDTH', 32);
export const CAR_HEIGHT = T('CAR_HEIGHT', 14);
export const CAR_GAP = T('CAR_GAP', 6);
export const TRAIN_MAX_HP = T('TRAIN_MAX_HP', 100);
export const TRAIN_SPEED = T('TRAIN_SPEED', 167);
export const CARGO_BOXES_START = T('CARGO_BOXES_START', 4);
export const CARGO_MULTIPLIER_PER_BOX = T('CARGO_MULTIPLIER_PER_BOX', 0.25);

// Camera: train sits at 30% from left
export const CAMERA_TRAIN_X = CANVAS_WIDTH * 0.3;

// Weapon mounts
export const MOUNT_RADIUS = 8;
export const WEAPON_CONE_HALF_ANGLE = Math.PI / 4;
export const WEAPON_RANGE = T('WEAPON_RANGE', 220);
export const WEAPON_FIRE_RATE = T('WEAPON_FIRE_RATE', 5);
export const WEAPON_DAMAGE = T('WEAPON_DAMAGE', 12);
export const PROJECTILE_SPEED = T('PROJECTILE_SPEED', 350);
export const PROJECTILE_LIFETIME = T('PROJECTILE_LIFETIME', 2);
export const PROJECTILE_RADIUS = T('PROJECTILE_RADIUS', 3);

// Driver buff
export const DRIVER_DAMAGE_BUFF = T('DRIVER_DAMAGE_BUFF', 1.5);

// Crew
export const CREW_REASSIGN_COOLDOWN = 1;
export const CREW_RADIUS = 8;
export const CREW_COLORS = ['#e74c3c', '#3498db', '#2ecc71'];

// Enemies
export const ENEMY_BASE_HP = T('ENEMY_BASE_HP', 20);
export const ENEMY_BASE_SPEED = T('ENEMY_BASE_SPEED', 50);
export const ENEMY_RADIUS = T('ENEMY_RADIUS', 6);
export const ENEMY_CONTACT_DAMAGE = T('ENEMY_CONTACT_DAMAGE', 6);
export const ENEMY_SPAWN_INTERVAL_START = T('ENEMY_SPAWN_INTERVAL_START', 1.5);
export const ENEMY_SPAWN_INTERVAL_MIN = T('ENEMY_SPAWN_INTERVAL_MIN', 0.25);

// Enemy tier multipliers (read by enemies.js)
export const ENEMY_RADIUS_MULT = [
  T('ENEMY_PURPLE_RADIUS_MULT', 1.5),
  T('ENEMY_RED_RADIUS_MULT', 5),
  T('ENEMY_RED_RADIUS_MULT', 5),
];
export const ENEMY_HP_MULT = [
  T('ENEMY_PURPLE_HP_MULT', 1),
  T('ENEMY_RED1_HP_MULT', 4),
  T('ENEMY_RED2_HP_MULT', 6),
];

// XP / Levels
export const XP_PER_KILL = T('XP_PER_KILL', 12);
export const XP_PER_LEVEL = T('XP_PER_LEVEL', 80);

// World structure
export const ZONES_PER_WORLD = T('ZONES_PER_WORLD', 3);
export const GOLD_PER_STATION = T('GOLD_PER_STATION', 25);
export const COAL_PER_WIN = T('COAL_PER_WIN', 2);

// Coins
export const COIN_RADIUS = 8;
export const COIN_SPAWN_INTERVAL = T('COIN_SPAWN_INTERVAL', 3);
export const COIN_VALUE = T('COIN_VALUE', 10);
export const MAX_COINS = 30;
export const MAX_FLYING_COINS = 30;
export const COIN_FLY_SPEED = 400;

// Auto-Weapons (VS-style, gained via level-up) — levels read from tuning
export const MAX_AUTO_WEAPON_LEVEL = 5;
export const AUTO_WEAPONS = {
  turret: {
    id: 'turret', name: 'Turret', icon: '\uD83D\uDD2B', color: '#ffb74d',
    desc: 'Auto-targets nearest enemy',
    levels: [1,2,3,4,5].map(lv => ({
      shotsPerBurst: T(`TURRET_LV${lv}_SHOTS`, [1,2,3,4,5][lv-1]),
      damage: T(`TURRET_LV${lv}_DAMAGE`, [10,12,14,16,18][lv-1]),
      fireInterval: T(`TURRET_LV${lv}_FIRE_INTERVAL`, [1.2,1.1,1.0,0.9,0.8][lv-1]),
      range: T(`TURRET_LV${lv}_RANGE`, [250,270,290,310,340][lv-1]),
    })),
  },
  steamBlast: {
    id: 'steamBlast', name: 'Steam Blast', icon: '\uD83D\uDCA8', color: '#8ecae6',
    desc: 'Aura that damages nearby enemies',
    levels: [1,2,3,4,5].map(lv => ({
      radius: T(`STEAM_LV${lv}_RADIUS`, [80,100,125,155,190][lv-1]),
      damage: T(`STEAM_LV${lv}_DAMAGE`, [4,6,9,13,18][lv-1]),
      tickRate: T(`STEAM_LV${lv}_TICK_RATE`, [0.5,0.45,0.4,0.35,0.3][lv-1]),
    })),
  },
  ricochetShot: {
    id: 'ricochetShot', name: 'Laser', icon: '\u26A1', color: '#b388ff',
    desc: 'Laser that bounces between enemies',
    levels: [1,2,3,4,5].map(lv => ({
      bounces: T(`LASER_LV${lv}_BOUNCES`, [2,3,4,5,7][lv-1]),
      damage: T(`LASER_LV${lv}_DAMAGE`, [8,10,13,16,20][lv-1]),
      fireInterval: T(`LASER_LV${lv}_FIRE_INTERVAL`, [2.5,2.2,1.9,1.6,1.3][lv-1]),
      speed: T(`LASER_LV${lv}_SPEED`, [300,320,340,360,400][lv-1]),
    })),
  },
};

// Shop upgrade tuning
export const SHOP_TUNING = {
  damage:   { cost: T('SHOP_DAMAGE_COST', 40),   maxLevel: T('SHOP_DAMAGE_MAX_LEVEL', 5),   perLevel: T('SHOP_DAMAGE_PER_LEVEL', 15) },
  shield:   { cost: T('SHOP_SHIELD_COST', 35),   maxLevel: T('SHOP_SHIELD_MAX_LEVEL', 5),   perLevel: T('SHOP_SHIELD_PER_LEVEL', 2) },
  coolOff:  { cost: T('SHOP_COOLOFF_COST', 45),  maxLevel: T('SHOP_COOLOFF_MAX_LEVEL', 5),  perLevel: T('SHOP_COOLOFF_PER_LEVEL', 10) },
  maxHp:    { cost: T('SHOP_MAXHP_COST', 30),    maxLevel: T('SHOP_MAXHP_MAX_LEVEL', 5),    perLevel: T('SHOP_MAXHP_PER_LEVEL', 15) },
  baseArea: { cost: T('SHOP_RANGE_COST', 40),    maxLevel: T('SHOP_RANGE_MAX_LEVEL', 5),    perLevel: T('SHOP_RANGE_PER_LEVEL', 15) },
  greed:    { cost: T('SHOP_GREED_COST', 60),    maxLevel: T('SHOP_GREED_MAX_LEVEL', 3),    perLevel: T('SHOP_GREED_PER_LEVEL', 20) },
  crewSlots:{ cost: T('SHOP_CREW_COST', 100),    maxLevel: T('SHOP_CREW_MAX_LEVEL', 2) },
};

// Run
export const TARGET_DISTANCE = T('TARGET_DISTANCE', 10000);

// Pools
export const MAX_ENEMIES = 150;
export const MAX_PROJECTILES = 300;
export const MAX_RICOCHET_BOLTS = 10;
export const MAX_DAMAGE_NUMBERS = 80;
