// Game tuning — loaded by index.html before modules init
const _t = window.__tuning || {};
const T = (key, fallback) => _t[key] ?? fallback;

// Canvas
export const CANVAS_WIDTH = 960;
export const CANVAS_HEIGHT = 640;

// Train
export const CAR_WIDTH = T('CAR_WIDTH', 32);
export const CAR_HEIGHT = T('CAR_HEIGHT', 14);
export const CAR_GAP = T('CAR_GAP', 6);
export const TRAIN_MAX_HP = T('TRAIN_MAX_HP', 150);
export const TRAIN_SPEED = T('TRAIN_SPEED', 167);
export const CARGO_BOXES_START = T('CARGO_BOXES_START', 4);
export const CARGO_MULTIPLIER_PER_BOX = T('CARGO_MULTIPLIER_PER_BOX', 0.25);

// Camera: train sits at 30% from left
export const CAMERA_TRAIN_X = CANVAS_WIDTH * 0.3;

// Weapon mounts
export const MOUNT_RADIUS = 8;
export const WEAPON_CONE_HALF_ANGLE = Math.PI / 2;      // manual crew: 180° total
export const AUTO_WEAPON_CONE_HALF_ANGLE = Math.PI / 4; // auto-weapons: 90° total
export const WEAPON_RANGE = T('WEAPON_RANGE', 220);
export const WEAPON_FIRE_RATE = T('WEAPON_FIRE_RATE', 5);
export const WEAPON_DAMAGE = T('WEAPON_DAMAGE', 12);
export const PROJECTILE_SPEED = T('PROJECTILE_SPEED', 350);
export const PROJECTILE_LIFETIME = T('PROJECTILE_LIFETIME', 2);
export const PROJECTILE_RADIUS = T('PROJECTILE_RADIUS', 3);

// Driver buff
export const DRIVER_DAMAGE_BUFF = T('DRIVER_DAMAGE_BUFF', 1.0);

// Crew
export const CREW_REASSIGN_COOLDOWN = 1;
export const CREW_RADIUS = 8;
export const CREW_COLORS = ['#e74c3c', '#3498db'];

// Enemies
export const ENEMY_BASE_HP = T('ENEMY_BASE_HP', 20);
export const ENEMY_BASE_SPEED = T('ENEMY_BASE_SPEED', 50);
export const ENEMY_RADIUS = T('ENEMY_RADIUS', 6);
export const ENEMY_CONTACT_DAMAGE = T('ENEMY_CONTACT_DAMAGE', 8);
export const ENEMY_SPAWN_INTERVAL_START = T('ENEMY_SPAWN_INTERVAL_START', 2.0);
export const ENEMY_SPAWN_INTERVAL_MIN = T('ENEMY_SPAWN_INTERVAL_MIN', 0.5);

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
export const ZONE_DIFFICULTY_SCALE = T('ZONE_DIFFICULTY_SCALE', 0.2);
export const GOLD_PER_STATION = T('GOLD_PER_STATION', 25);
export const COAL_PER_WIN = T('COAL_PER_WIN', 2);

// Coins
export const COIN_RADIUS = 8;
export const COIN_SPAWN_INTERVAL = T('COIN_SPAWN_INTERVAL', 3);
export const COIN_VALUE = T('COIN_VALUE', 10);
export const MAX_COINS = 30;
export const MAX_FLYING_COINS = 30;
export const COIN_FLY_SPEED = 400;

// Manual gun (crew weapon) — level scaling
export const MANUAL_GUN = {
  id: 'manualGun', name: 'Crew Gun', icon: '\uD83D\uDD2B', color: '#e74c3c',
  desc: 'Upgrade crew weapon damage and fire rate',
  maxLevel: 5,
  levels: [0,1,2,3,4].map(i => ({
    damage: T('MANUAL_LV1_DAMAGE', 12) + i * T('MANUAL_DAMAGE_GROWTH', 5),
    fireRate: T('MANUAL_LV1_FIRE_RATE', 2) + i * T('MANUAL_FIRE_RATE_GROWTH', 0.6),
    range: T('MANUAL_LV1_RANGE', 220) + i * T('MANUAL_RANGE_GROWTH', 15),
  })),
};

// Auto-Weapons (VS-style, gained via level-up) — levels read from tuning
export const MAX_AUTO_WEAPON_LEVEL = 5;
// Auto-Weapons — levels generated from base + per-level scaling
export const AUTO_WEAPONS = {
  turret: {
    id: 'turret', name: 'Turret', icon: '\uD83D\uDD2B', color: '#ffb74d',
    desc: 'Auto-targets nearest enemy',
    levels: [0,1,2,3,4].map(i => ({
      shotsPerBurst: T('TURRET_LV1_SHOTS', 1) + i * T('TURRET_SHOT_GROWTH', 1),
      damage: T('TURRET_LV1_DAMAGE', 10) + i * T('TURRET_DAMAGE_GROWTH', 2),
      fireInterval: Math.max(0.2, T('TURRET_LV1_FIRE_INTERVAL', 1.2) - i * T('TURRET_INTERVAL_REDUCTION', 0.1)),
      range: T('TURRET_LV1_RANGE', 250) + i * T('TURRET_RANGE_GROWTH', 20),
    })),
  },
  autoLaser: {
    id: 'autoLaser', name: 'Auto Laser', icon: '\uD83D\uDD2B', color: '#8ecae6',
    desc: 'Auto-targets nearest enemy',
    levels: [0,1,2,3,4].map(i => ({
      damage: T('AUTOLASER_LV1_DAMAGE', 10) + i * T('AUTOLASER_DAMAGE_GROWTH', 3),
      fireInterval: Math.max(0.3, T('AUTOLASER_LV1_FIRE_INTERVAL', 1.4) - i * T('AUTOLASER_INTERVAL_REDUCTION', 0.15)),
      range: T('AUTOLASER_LV1_RANGE', 240) + i * T('AUTOLASER_RANGE_GROWTH', 20),
    })),
  },
  ricochetShot: {
    id: 'ricochetShot', name: 'Laser', icon: '\u26A1', color: '#b388ff',
    desc: 'Laser that bounces between enemies',
    levels: [0,1,2,3,4].map(i => ({
      bounces: T('LASER_LV1_BOUNCES', 2) + i * T('LASER_BOUNCE_GROWTH', 1),
      damage: T('LASER_LV1_DAMAGE', 8) + i * T('LASER_DAMAGE_GROWTH', 3),
      fireInterval: Math.max(0.3, T('LASER_LV1_FIRE_INTERVAL', 2.5) - i * T('LASER_INTERVAL_REDUCTION', 0.3)),
      speed: T('LASER_LV1_SPEED', 300) + i * T('LASER_SPEED_GROWTH', 25),
    })),
  },
};

// Coal shop
export const COAL_SHOP_COST = T('COAL_SHOP_COST', 30);
export const COAL_SHOP_AMOUNT = T('COAL_SHOP_AMOUNT', 2);

// Shop upgrade tuning
export const SHOP_TUNING = {
  damage:    { cost: T('SHOP_DAMAGE_COST', 40),    maxLevel: T('SHOP_DAMAGE_MAX_LEVEL', 5),    perLevel: T('SHOP_DAMAGE_PER_LEVEL', 15) },
  kickForce: { cost: T('SHOP_KICK_COST', 40),      maxLevel: T('SHOP_KICK_MAX_LEVEL', 5),      perLevel: T('SHOP_KICK_PER_LEVEL', 1) },
  maxHp:     { cost: T('SHOP_MAXHP_COST', 30),     maxLevel: T('SHOP_MAXHP_MAX_LEVEL', 5),     perLevel: T('SHOP_MAXHP_PER_LEVEL', 25) },
};

// Run
export const TARGET_DISTANCE = T('TARGET_DISTANCE', 10000);

// Bandits
export const BANDIT_SPEED = T('BANDIT_SPEED', 110);
export const BANDIT_SPAWN_INTERVAL = T('BANDIT_SPAWN_INTERVAL', 12); // breathing room between bandits
export const BANDIT_JUMP_DURATION = T('BANDIT_JUMP_DURATION', 0.4);
export const BANDIT_STEAL_RATE = T('BANDIT_STEAL_RATE', 0); // gold per second
export const BANDIT_FIGHT_DURATION = T('BANDIT_FIGHT_DURATION', 0.5);
export const MAX_BANDITS = 10;

// Crew roles
export const GUNNER_DAMAGE_MULT = T('GUNNER_DAMAGE_MULT', 1.6);          // +60% gun damage
export const BRAWLER_DAMAGE_MULT = T('BRAWLER_DAMAGE_MULT', 0.6);        // -40% gun damage
export const GUNNER_FIGHT_DURATION_MULT = T('GUNNER_FIGHT_DURATION_MULT', 2.0); // 2x bandit fight time
export const BRAWLER_KICK_DAMAGE = T('BRAWLER_KICK_DAMAGE', 60);   // AOE damage on bandit kick — big moment
export const BRAWLER_KICK_RADIUS = T('BRAWLER_KICK_RADIUS', 160);  // AOE radius on bandit kick

// Brawler garlic AOE weapon (smaller than old auto-weapon, strong early game)
export const BRAWLER_GARLIC = {
  radius: T('BRAWLER_GARLIC_RADIUS', 50),
  damage: T('BRAWLER_GARLIC_DAMAGE', 14),
  tickRate: T('BRAWLER_GARLIC_TICK_RATE', 0.4),
};

// Wave system
export const WAVE_CYCLE_DURATION = T('WAVE_CYCLE_DURATION', 12);       // seconds between surge starts
export const WAVE_SURGE_DURATION = T('WAVE_SURGE_DURATION', 5);        // seconds a surge lasts
export const WAVE_CALM_DURATION = T('WAVE_CALM_DURATION', 5);          // real breathing room
export const WAVE_SURGE_SPAWN_MULT = T('WAVE_SURGE_SPAWN_MULT', 2.0);  // noticeable but manageable
export const WAVE_CALM_SPAWN_MULT = T('WAVE_CALM_SPAWN_MULT', 0.5);    // light pressure, clear contrast with surge
export const WAVE_ESCALATION = T('WAVE_ESCALATION', 0.10);             // per-wave difficulty increase
export const WAVE_WARNING_DURATION = T('WAVE_WARNING_DURATION', 3);    // seconds of warning before surge
export const WAVE_BOSS_SURGE_MULT = T('WAVE_BOSS_SURGE_MULT', 3.5);   // extra intense boss wave multiplier
export const UNMANNED_EFFECTIVENESS = T('UNMANNED_EFFECTIVENESS', 0.10); // near-useless without crew

// Station combat modifiers
export const STATION_MODIFIERS = {
  swarm:    { id: 'swarm',    name: 'Swarm',    spawnMult: 2.0, hpMult: 0.5, coinMult: 1,   goldMult: 1,   color: '#e74c3c' },
  armored:  { id: 'armored',  name: 'Armored',  spawnMult: 0.5, hpMult: 2.5, coinMult: 1,   goldMult: 1,   color: '#3498db' },
  ambush:   { id: 'ambush',   name: 'Ambush',   spawnMult: 1.5, hpMult: 1,   coinMult: 1,   goldMult: 1,   color: '#e67e22' },
  bounty:   { id: 'bounty',   name: 'Bounty',   spawnMult: 1,   hpMult: 1,   coinMult: 2,   goldMult: 1,   color: '#f5a623' },
  gauntlet: { id: 'gauntlet', name: 'Gauntlet', spawnMult: 1.5, hpMult: 1.5, coinMult: 1,   goldMult: 1.5, color: '#9b59b6' },
};
export const MODIFIER_KEYS = Object.keys(STATION_MODIFIERS);

// Pools
export const MAX_ENEMIES = 150;
export const MAX_PROJECTILES = 300;
export const MAX_RICOCHET_BOLTS = 10;
export const MAX_DAMAGE_NUMBERS = 80;
