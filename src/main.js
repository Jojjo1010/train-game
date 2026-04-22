import {
  CANVAS_WIDTH, CANVAS_HEIGHT, CAMERA_TRAIN_X,
  CAR_WIDTH, CAR_HEIGHT, CAR_GAP, TRAIN_SPEED,
  TARGET_DISTANCE, AUTO_WEAPONS, MAX_AUTO_WEAPON_LEVEL, MOUNT_RADIUS, MANUAL_GUN,
  ZONES_PER_WORLD, ZONE_DIFFICULTY_SCALE, GOLD_PER_STATION, COAL_PER_WIN, SHOP_TUNING,
  TRAIN_MAX_HP, COAL_SHOP_COST, COAL_SHOP_AMOUNT, AUTO_WEAPON_CONE_HALF_ANGLE,
  BRAWLER_KICK_DAMAGE, BRAWLER_KICK_RADIUS
} from './constants.js';
import { Train } from './train.js';
import { Renderer3D } from './renderer3d.js';
import { InputManager } from './input.js';
import { Spawner } from './enemies.js';
import { CombatSystem } from './combat.js';
import { CoinSystem } from './coins.js';
import { BanditSystem, BANDIT_STATES } from './bandits.js';
import { updateDamageAttribution, drawDamageAttribution, resetDamageAttribution } from './damageAttribution.js';
import { Zone, STATION_TYPES } from './zone.js';
import { playPowerup, startMusic, stopMusic, getMusicVolume, getSfxVolume, setMusicVolume, setSfxVolume, playLevelUpMp3, playZoneCompleteMp3, playWinWorldMp3, playDefeatMp3, preloadSfx, playWeaponAcquire, playWaveClear, updateLowHPWarning, stopLowHPWarning } from './audio.js';

const STATES = {
  ZONE_MAP: 0, SETUP: 1, RUNNING: 2, LEVELUP: 3, PLACE_WEAPON: 4,
  GAMEOVER: 5, PAUSED: 6, SHOP: 7, SETTINGS: 8,
  START_SCREEN: 9, WORLD_SELECT: 10, WORLD_MAP: 11,
  RUN_PAUSE: 12,
};

// World definitions — each sets a base difficulty multiplier and theme
const WORLDS = [
  { id: 1, name: 'The Dustlands',  subtitle: 'Arid plains crossing',       difficulty: 1.0, color: '#c8a96e', accent: '#f5a623', stars: 1 },
  { id: 2, name: 'Iron Wastes',    subtitle: 'Ruined industrial badlands',  difficulty: 1.5, color: '#8ab5c8', accent: '#5ab4db', stars: 2 },
  { id: 3, name: 'The Inferno',    subtitle: 'Volcanic hellscape',          difficulty: 2.0, color: '#e87050', accent: '#e74c3c', stars: 3 },
];

const threeCanvas = document.getElementById('game3d');
const uiCanvas = document.getElementById('gameUI');
const ctx = uiCanvas.getContext('2d');

function resizeCanvas() {
  // UI canvas internal resolution
  uiCanvas.width = CANVAS_WIDTH;
  uiCanvas.height = CANVAS_HEIGHT;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

const renderer = new Renderer3D(threeCanvas, ctx);
const input = new InputManager(uiCanvas); // input on top canvas
const spawner = new Spawner();
const combat = new CombatSystem();
const coinSystem = new CoinSystem();
const banditSystem = new BanditSystem();

let state = STATES.START_SCREEN;
let selectedWorld = WORLDS[0];
let hoveredWorldIndex = -1;
let train = null;
let zone = null;
let lastTime = performance.now();
let won = false;
let debugMode = false;

// Selection state
let selectedCrew = null; // currently selected crew member
let rolesChosen = false; // blocks setup until both crew pick Gunner/Brawler
let rolePickButtons = []; // cached hit areas from renderer
let hoveredRoleBtn = null; // key like "0_Gunner"
let garlicSelected = false; // true when player clicked the garlic mount to move it

const ROTATE_SPEED = 2.5; // radians/sec for keyboard rotation

let levelUpChoices = [];
let hoveredPowerup = -1;
let pendingWeaponId = null; // weapon waiting to be placed on a mount

// Slot machine state for level-up
let slotMachinePhase = 'none'; // 'spinning' | 'landed' | 'choose' | 'none'
let slotMachineTimer = 0;
let slotMachineCrewIdx = 0; // which crew member was chosen
let slotMachineSpeed = 0; // ticks per second (slows down)
let slotMachineTick = 0;
let slotMachineDisplayIdx = 0; // currently displayed crew index

// === PERSISTENT UPGRADES (shop, kept across worlds — costs/levels from tuner) ===
const ST = SHOP_TUNING;
const STARTING_COAL = 4;
const MAX_COAL = 8;

const save = {
  gold: 0,
  coal: STARTING_COAL,
  maxCoal: MAX_COAL,
  upgrades: {
    damage:    { level: 0, maxLevel: ST.damage.maxLevel,   cost: ST.damage.cost,    icon: '💥', color: '#ff5722', name: 'Damage',     desc: `+${ST.damage.perLevel}% weapon damage` },
    shield:    { level: 0, maxLevel: ST.shield.maxLevel,   cost: ST.shield.cost,    icon: '🛡', color: '#3498db', name: 'Shield',     desc: `-${ST.shield.perLevel} damage per hit` },
    coolOff:   { level: 0, maxLevel: ST.coolOff.maxLevel,  cost: ST.coolOff.cost,   icon: '❄', color: '#00bcd4', name: 'Cool-off',   desc: `-${ST.coolOff.perLevel}% cooldown` },
    maxHp:     { level: 0, maxLevel: ST.maxHp.maxLevel,    cost: ST.maxHp.cost,     icon: '❤', color: '#e74c3c', name: 'Max HP',     desc: `+${ST.maxHp.perLevel} max HP` },
    baseArea:  { level: 0, maxLevel: ST.baseArea.maxLevel,  cost: ST.baseArea.cost,  icon: '🎯', color: '#9b59b6', name: 'Range',      desc: `+${ST.baseArea.perLevel}% weapon range` },
    greed:     { level: 0, maxLevel: ST.greed.maxLevel,    cost: ST.greed.cost,     icon: '💰', color: '#f5a623', name: 'Greed',      desc: `+${ST.greed.perLevel}% gold from coins` },
    crewSlots: { level: 0, maxLevel: ST.crewSlots.maxLevel, cost: ST.crewSlots.cost, icon: '👤', color: '#2ecc71', name: 'Crew Slots', desc: 'Unlock crew member' },
  },
};
const UPGRADE_KEYS = Object.keys(save.upgrades);
let hoveredShopItem = -1;

const trainTotalWidth = 4 * CAR_WIDTH + 3 * CAR_GAP;
const TRAIN_3D_OFFSET = -15; // align 2D hitboxes with 3D model position
const trainScreenX = CANVAS_WIDTH / 2 - trainTotalWidth / 2 + TRAIN_3D_OFFSET;
const trainScreenY = CANVAS_HEIGHT / 2 - CAR_HEIGHT / 2;
const crewPanelY = trainScreenY + CAR_HEIGHT + 80;
const departBtn = { x: CANVAS_WIDTH / 2 - 70, y: CANVAS_HEIGHT - 80, w: 140, h: 48 };
const shopMapBtn = { x: CANVAS_WIDTH / 2 - 150, y: CANVAS_HEIGHT - 80, w: 140, h: 48 };
const shopNextBtn = { x: CANVAS_WIDTH / 2 + 10, y: CANVAS_HEIGHT - 80, w: 140, h: 48 };

let stateBeforePause = STATES.SETUP; // remember where we came from
let pauseAimMount = null; // mount being aimed during RUN_PAUSE
const pauseButtons = {
  resume:  { x: CANVAS_WIDTH / 2 - 100, y: 260, w: 200, h: 50 },
  restart: { x: CANVAS_WIDTH / 2 - 100, y: 330, w: 200, h: 50 },
  quit:    { x: CANVAS_WIDTH / 2 - 100, y: 400, w: 200, h: 50 },
};

let zoneNumber = 1;
let combatDifficulty = 1;

// --- FEATURE 2: first-boarding tooltip state ---
let banditBoardingTooltipShown = false; // resets each new run/world
let banditBoardingTooltipTimer = 0;     // counts down from 3 seconds

// --- Wave phase tracking (for surge shake) ---
let prevWavePhase = -1; // -1 = uninitialized; compared each frame in updateRun

// --- Weapon fanfare state ---
let fanfareTimer = 0;   // seconds remaining in fanfare freeze
let fanfareText = '';   // e.g. "TURRET ACQUIRED!"
let fanfareColor = '#f5a623';

// --- Hitstop (micro-freeze on kills) ---
let hitStopTimer = 0;

function newZone() {
  zoneNumber++;
  if (zoneNumber > ZONES_PER_WORLD) {
    enterWorldComplete();
    return;
  }
  zone = new Zone(zoneNumber, save);
  state = STATES.ZONE_MAP;
}

function leaveShop() {
  state = STATES.START_SCREEN;
}

function applyShopUpgrades() {
  const u = save.upgrades;
  // Prototype: hard-cap at 2 crew, no additional recruitment
  while (train.crew.length < 2) train.recruitCrew();
  if (train.crew.length > 2) train.crew.length = 2;
  train.passives.damage = u.damage.level;
  train.passives.shield = u.shield.level;
  train.passives.coolOff = u.coolOff.level;
  train.passives.baseArea = u.baseArea.level;
  train.passives.maxHp = u.maxHp.level;
  train.maxHp = TRAIN_MAX_HP + u.maxHp.level * ST.maxHp.perLevel;
  train.greedMultiplier = 1 + u.greed.level * (ST.greed.perLevel / 100);
}

let garlicPlaced = false; // player must place garlic on a mount during setup

function startNewWorld() {
  zoneNumber = 1;
  save.coal = STARTING_COAL;
  save.maxCoal = MAX_COAL;
  zone = new Zone(zoneNumber, save);
  combatDifficulty = 1;
  train = new Train();
  selectedCrew = null;
  applyShopUpgrades();
  garlicPlaced = train.hasAutoWeapon('steamBlast');
  for (const c of train.crew) c.role = null;
  rolesChosen = false;
  train.hp = train.maxHp;
}

function prepareForCombat(isBossStation = false, modifier = null) {
  state = STATES.SETUP;
  train.combatDifficulty = combatDifficulty;
  train.distance = 0;
  train.runGold = 0;
  train.damageFlash = 0;
  train.shakeTimer = 0;
  train.hpFlashTimer = 0;
  train.lastStandTimer = 0;
  train.hpGreenFlashTimer = 0;
  selectedCrew = null;
  spawner.reset();
  spawner.isBossStation = isBossStation;
  spawner.modifier = modifier || null;
  if (modifier && modifier.id === 'ambush') spawner.applyAmbush();
  coinSystem.reset();
  coinSystem.modifier = modifier || null;
  combat.reset();
  banditSystem.reset();
  resetDamageAttribution();
  banditBoardingTooltipShown = false;
  banditBoardingTooltipTimer = 0;
  prevWavePhase = -1;
  fanfareTimer = 0;
  won = false;
  applyShopUpgrades();
  // Don't reset roles/garlic here — they persist across stations in a world
  train.hp = Math.min(train.hp, train.maxHp);
}

function generateLevelUpCards(train, crewIdx) {
  const c = train.crew[crewIdx];
  const crewId = c.id;
  const roleEmoji = c.role === 'Gunner' ? '\uD83D\uDC31' : c.role === 'Brawler' ? '\u26C4\uFE0F' : '\uD83D\uDC31';
  const cards = [];

  // Get current stats
  const curStats = MANUAL_GUN.levels[Math.max(0, c.gunLevel - 1)];
  const curDmg = curStats.damage + (c._dmgBonus || 0);
  const curRate = curStats.fireRate + (c._rateBonus || 0);

  if (c.role === 'Brawler') {
    // KICK POWER: +15 AOE damage on bandit kick
    const curKickDmg = BRAWLER_KICK_DAMAGE + (c._kickDmgBonus || 0);
    cards.push({
      type: 'upgradeManual', name: 'KICK POWER',
      icon: '\uD83E\uDD1C' + roleEmoji, color: '#e57373',
      crewColor: c.color, roleLabel: c.role,
      desc: `Kick DMG ${curKickDmg} \u2192 ${curKickDmg + 15}`,
      apply(t) {
        t.crew[crewId]._kickDmgBonus = (t.crew[crewId]._kickDmgBonus || 0) + 15;
      },
    });

    // KICK RADIUS: +40 AOE radius
    const curKickR = BRAWLER_KICK_RADIUS + (c._kickRadiusBonus || 0);
    cards.push({
      type: 'upgradeManual', name: 'KICK RADIUS',
      icon: '\uD83D\uDCA5' + roleEmoji, color: '#81c784',
      crewColor: c.color, roleLabel: c.role,
      desc: `Kick Range ${curKickR} \u2192 ${curKickR + 40}`,
      apply(t) {
        t.crew[crewId]._kickRadiusBonus = (t.crew[crewId]._kickRadiusBonus || 0) + 40;
      },
    });
  } else {
    // Gunner: POWER (+7 damage)
    cards.push({
      type: 'upgradeManual', name: 'POWER',
      icon: '\u2694\uFE0F' + roleEmoji, color: '#e57373',
      crewColor: c.color, roleLabel: c.role || '',
      desc: `DMG ${curDmg} \u2192 ${curDmg + 7}`,
      apply(t) {
        t.crew[crewId].gunLevel = Math.min(MANUAL_GUN.maxLevel, t.crew[crewId].gunLevel + 1);
        t.crew[crewId]._dmgBonus = (t.crew[crewId]._dmgBonus || 0) + 7;
      },
    });

    // Gunner: SPEED (+0.8 rate)
    cards.push({
      type: 'upgradeManual', name: 'SPEED',
      icon: '\u26A1' + roleEmoji, color: '#64b5f6',
      crewColor: c.color, roleLabel: c.role || '',
      desc: `Rate ${curRate.toFixed(1)} \u2192 ${(curRate + 0.8).toFixed(1)}/s`,
      apply(t) {
        t.crew[crewId].gunLevel = Math.min(MANUAL_GUN.maxLevel, t.crew[crewId].gunLevel + 1);
        t.crew[crewId]._rateBonus = (t.crew[crewId]._rateBonus || 0) + 0.8;
      },
    });
  }

  // Defense option: Regen
  const regenLvl = train.getDefenseLevel('regen');
  if (regenLvl === 0 && train.canAddDefense) {
    cards.push({
      type: 'defence', name: 'Regen — New!', icon: '\u2764', color: '#e74c3c',
      desc: '+3 HP/sec',
      apply(t) {
        const def = { id: 'regen', maxLevel: 5 };
        t.addOrUpgradeDefense(def);
        t._regenRate = 3;
      },
    });
  } else if (regenLvl > 0 && regenLvl < 5) {
    const nextLvl = regenLvl + 1;
    cards.push({
      type: 'defence', name: `Regen Lv${nextLvl}`, icon: '\u2764', color: '#e74c3c',
      desc: `+${nextLvl * 3} HP/sec`,
      apply(t) {
        const def = { id: 'regen', maxLevel: 5 };
        t.addOrUpgradeDefense(def);
        t._regenRate = nextLvl * 3;
      },
    });
  } else {
    // Regen maxed — offer range boost instead
    cards.push({
      type: 'upgradeManual', name: 'RANGE', icon: '\uD83C\uDFAF' + roleEmoji,
      color: '#81c784', crewColor: c.color, roleLabel: c.role || '',
      desc: `Range +30`,
      apply(t) {
        t.crew[crewId]._rangeBonus = (t.crew[crewId]._rangeBonus || 0) + 30;
      },
    });
  }

  return cards;
}

// Get the mount the selected crew is currently assigned to (if any)
function getSelectedMount() {
  if (!selectedCrew || !selectedCrew.assignment) return null;
  if (selectedCrew.assignment.isDriverSeat) return null;
  return selectedCrew.assignment;
}

// Keyboard rotation for selected crew's weapon
function handleKeyboardRotation(dt) {
  const mount = getSelectedMount();
  if (!mount) return;

  let rotate = 0;
  if (input.keyDown('KeyA') || input.keyDown('ArrowLeft')) rotate -= ROTATE_SPEED * dt;
  if (input.keyDown('KeyD') || input.keyDown('ArrowRight')) rotate += ROTATE_SPEED * dt;
  if (input.keyDown('KeyW') || input.keyDown('ArrowUp')) {
    mount.coneDirection = mount.clampAngle(-Math.PI / 2);
    return;
  }
  if (input.keyDown('KeyS') || input.keyDown('ArrowDown')) {
    mount.coneDirection = mount.clampAngle(Math.PI / 2);
    return;
  }

  if (rotate !== 0) {
    mount.coneDirection = mount.clampAngle(mount.coneDirection + rotate);
  }
}

// Screen position of a slot (uses projected coords if available)
function slotScreenX(s) { return s.screenX !== undefined ? s.screenX : s.worldX; }
function slotScreenY(s) { return s.screenY !== undefined ? s.screenY : s.worldY; }

function findCrewAtMouse() {
  for (const slot of train.allSlots) {
    if (slot.crew && !slot.crew.isMoving && input.hitCircle(slotScreenX(slot), slotScreenY(slot), 22)) {
      return slot.crew;
    }
  }
  // Check panel
  return input.findCrewInPanel(train.crew);
}

// Find any slot at mouse (empty or occupied)
function findSlotAtMouse() {
  return input.findSlotAtMouse(train);
}

function updateCrewWalk(dt) {
  const CREW_WALK_SPEED = 85;
  for (const c of train.crew) {
    if (!c.isMoving || c.moveScreenX === undefined) continue;
    const dx = c.moveTargetX - c.moveScreenX;
    const dy = c.moveTargetY - c.moveScreenY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 3) {
      c.isMoving = false;
      if (c.moveTargetSlot) {
        train.assignCrew(c, c.moveTargetSlot);
        c.moveTargetSlot = null;
      }
      c.moveScreenX = undefined;
    } else {
      const step = CREW_WALK_SPEED * dt;
      c.moveScreenX += (dx / dist) * Math.min(step, dist);
      c.moveScreenY += (dy / dist) * Math.min(step, dist);
    }
  }
}

// --- SETUP PHASE ---
function updateSetup(dt) {
  train.updateWorldPositions(trainScreenX, trainScreenY);

  train.updateCrewMovement(dt);
  handleKeyboardRotation(dt);

  // Left click: select crew, place garlic, or UI buttons
  if (input.leftClicked) {
    const crewPlaced = train.crew.some(c => c.assignment && !c.assignment.isDriverSeat);
    if (crewPlaced && input.hitRect(departBtn.x, departBtn.y, departBtn.w, departBtn.h)) {
      state = STATES.RUNNING;
      lastTime = performance.now();
      selectedCrew = null;
      garlicSelected = false;
      // Auto-pause for debugging gun/cone alignment
      if (window.__mountDebug && window.__mountDebug.enabled) {
        state = STATES.RUN_PAUSE;
      }
      return;
    }

    // If garlic selected, left-click deselects
    if (garlicSelected) {
      garlicSelected = false;
      // fall through to normal click handling
    }

    // Check if clicked the garlic mount (use helper that falls back to worldX)
    const garlicMount = train.getAutoWeaponMount('steamBlast');
    if (garlicMount) {
      const gsx = slotScreenX(garlicMount);
      const gsy = slotScreenY(garlicMount);
      if (input.hitCircle(gsx, gsy, MOUNT_RADIUS + 10)) {
        garlicSelected = true;
        selectedCrew = null;
        return;
      }
    }

    const clickedCrew = findCrewAtMouse();
    if (clickedCrew) {
      selectedCrew = clickedCrew === selectedCrew ? null : clickedCrew;
      garlicSelected = false;
      return;
    }

    selectedCrew = null;
    garlicSelected = false;
  }

  // Right click: place selected crew or move garlic to slot
  if (input.rightClicked) {
    if (garlicSelected) {
      // Find empty mount under cursor (check all mounts directly)
      let targetMount = null;
      for (const m of train.allMounts) {
        if (m.autoWeaponId || m.crew) continue;
        const sx = m.screenX !== undefined ? m.screenX : m.worldX;
        const sy = m.screenY !== undefined ? m.screenY : m.worldY;
        if (input.hitCircle(sx, sy, MOUNT_RADIUS + 8)) { targetMount = m; break; }
      }
      if (targetMount) {
        const oldMount = train.getAutoWeaponMount('steamBlast');
        if (oldMount) oldMount.autoWeaponId = null;
        targetMount.autoWeaponId = 'steamBlast';
        targetMount.coneHalfAngle = AUTO_WEAPON_CONE_HALF_ANGLE;
        train.autoWeapons.steamBlast.mount = targetMount;
        garlicSelected = false;
      }
    } else if (selectedCrew && !selectedCrew.isMoving) {
      const slot = findSlotAtMouse();
      if (slot && (!slot.autoWeaponId || slot._bandit)) {
        const fromSlot = selectedCrew.assignment;
        if (fromSlot) {
          const fromX = fromSlot.worldX;
          const fromY = fromSlot.worldY;
          const fromCar = train.findCarForSlot(fromSlot);
          train.unassignCrew(selectedCrew);
          selectedCrew.moveScreenX = undefined;
          train.startCrewMove(selectedCrew, fromX, fromY, fromCar, slot);
        } else {
          train.assignCrew(selectedCrew, slot);
        }
      }
    }
  }

  // Hold right click: aim selected crew's weapon
  if (selectedCrew && input.rightDown && !input.rightClicked) {
    const mount = getSelectedMount();
    if (mount) {
      const mouseWorld = renderer.screenToPixel
        ? renderer.screenToPixel(input.mouseX, input.mouseY, 16)
        : { x: input.mouseX, y: input.mouseY };
      mount.coneDirection = mount.clampAngle(Math.atan2(
        mouseWorld.y - mount.worldY,
        mouseWorld.x - mount.worldX
      ));
    }
  }
}

function renderSetup() {
  train.updateWorldPositions(trainScreenX, trainScreenY);
  renderer.drawTerrain(0);
  renderer.drawSteamBlastAura(train);
  renderer.drawTrain(train);
  renderer.drawWeaponMounts(train, getSelectedMount(), true);

  renderer.drawMovingCrew(train.crew);
  renderer.drawCrewPanel(train.crew, crewPanelY);
  const crewReady = train.crew.some(c => c.assignment && !c.assignment.isDriverSeat);
  if (!crewReady) {
    renderer.drawSetupOverlay();
  } else {
    renderer.drawMissionBrief();
  }
  renderer.drawDepartButton(departBtn.x, departBtn.y, departBtn.w, departBtn.h,
    crewReady && input.hitRect(departBtn.x, departBtn.y, departBtn.w, departBtn.h), !crewReady);
  if (selectedCrew) renderer.drawSelectedIndicator(selectedCrew);
  // Garlic selected indicator
  if (garlicSelected) {
    const gMount = train.getAutoWeaponMount('steamBlast');
    if (gMount && gMount.screenX !== undefined) {
      const ctx = renderer.ctx;
      const pulse = 0.6 + Math.sin(performance.now() * 0.008) * 0.4;
      ctx.strokeStyle = `rgba(142, 202, 230, ${pulse})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(slotScreenX(gMount), slotScreenY(gMount), MOUNT_RADIUS + 8, 0, Math.PI * 2);
      ctx.stroke();
      // Hint text
      ctx.fillStyle = '#8ecae6';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('GARLIC SELECTED', slotScreenX(gMount), slotScreenY(gMount) - MOUNT_RADIUS - 14);
      ctx.fillStyle = '#aaa';
      ctx.font = '10px monospace';
      ctx.fillText('Right-click a mount to move', slotScreenX(gMount), slotScreenY(gMount) - MOUNT_RADIUS - 2);
    }
  }
  renderer.drawMountDebug();
  renderer.flush();
}

// --- RUN PHASE ---
const debugBtnRun = { x: CANVAS_WIDTH - 70, y: CANVAS_HEIGHT - 80, w: 60, h: 26 };

function updateRun(dt) {
  // Debug toggle button
  if (input.clicked && input.hitRect(debugBtnRun.x, debugBtnRun.y, debugBtnRun.w, debugBtnRun.h)) {
    debugMode = !debugMode;
  }

  // Hitstop: skip simulation but still allow rendering/effects
  if (hitStopTimer > 0) {
    hitStopTimer -= dt;
    return;
  }

  train.distance += TRAIN_SPEED * dt;
  // Hidden last-stand forgiveness timer
  train.updateLastStand(dt);
  // Regen: defense regen + Medic role bonus (2 HP/s when stationary 3+ seconds)
  let regenRate = train._regenRate;
  if (regenRate > 0) {
    train.hp = Math.min(train.hp + regenRate * dt, train.maxHp);
  }
  // Low-HP heartbeat warning
  updateLowHPWarning(train.hp / train.maxHp);

  if (train.distance >= TARGET_DISTANCE) { won = true; enterGameOver(); return; }
  if (train.hp <= 0) { train.hp = 0; won = false; enterGameOver(); return; }

  for (const c of train.crew) if (c.reassignCooldown > 0) c.reassignCooldown -= dt;

  train.updateCrewMovement(dt);

  updateCrewWalk(dt);
  handleKeyboardRotation(dt);

  // Left click: select crew
  if (input.leftClicked) {
    const clickedCrew = findCrewAtMouse();
    if (clickedCrew) {
      selectedCrew = clickedCrew === selectedCrew ? null : clickedCrew;
      return;
    }
    selectedCrew = null;
  }

  // Right click: move selected crew to slot
  if (input.rightClicked && selectedCrew && !selectedCrew.isMoving) {
    const slot = findSlotAtMouse();
    if (slot && (!slot.autoWeaponId || slot._bandit)) {
      const fromSlot = selectedCrew.assignment;
      if (fromSlot) {
        const fromX = fromSlot.worldX;
        const fromY = fromSlot.worldY;
        const fromCar = train.findCarForSlot(fromSlot);
        train.unassignCrew(selectedCrew);
        selectedCrew.moveScreenX = undefined;
        train.startCrewMove(selectedCrew, fromX, fromY, fromCar, slot);
      } else {
        train.assignCrew(selectedCrew, slot);
      }
    }
  }

  // Aim selected crew's weapon — follows mouse
  // Clear aim state for all mounts first
  for (const m of train.allMounts) { m._aimRotY = undefined; m.screenAimAngle = undefined; m._fireAngle2D = undefined; }
  if (selectedCrew) {
    const mount = getSelectedMount();
    if (mount && mount.screenX !== undefined && renderer.screenToPixel) {
      // Screen-space angle for cone visual clamping
      const MD = window.__mountDebug;
      const isUpper = mount._offset_z < 0;
      const centerRad = (isUpper ? MD.upperConeAngle : MD.lowerConeAngle) * Math.PI / 180;
      const halfRad = MD.coneHalf * Math.PI / 180;
      const mouseAngle = Math.atan2(input.mouseY - mount.screenY, input.mouseX - mount.screenX);
      let diff = mouseAngle - centerRad;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) > halfRad) diff = Math.sign(diff) * halfRad;
      mount.screenAimAngle = centerRad + diff;

      // 3D gun rotation: use CLAMPED screen angle → project to 3D → atan2
      const aimDist = 100;
      const targetSx = mount.screenX + Math.cos(mount.screenAimAngle) * aimDist;
      const targetSy = mount.screenY + Math.sin(mount.screenAimAngle) * aimDist;
      const targetWorld = renderer.screenToPixel(targetSx, targetSy, 16);
      const twx = targetWorld.x - CANVAS_WIDTH / 2;
      const twz = targetWorld.y - CANVAS_HEIGHT / 2;
      const mountWx = mount.worldX - CANVAS_WIDTH / 2;
      const mountWz = mount.worldY - CANVAS_HEIGHT / 2;
      mount._aimRotY = Math.atan2(twx - mountWx, twz - mountWz);
      // 2D pixel-space firing angle (for projectiles in combat.js)
      mount._fireAngle2D = Math.atan2(targetWorld.y - mount.worldY, targetWorld.x - mount.worldX);
    }
  }

  // Enemies
  const carBounds = {
    rearWeapon:  { x: train.cars[0].worldX, y: train.cars[0].worldY, w: CAR_WIDTH, h: CAR_HEIGHT },
    cargo:       { x: train.cars[1].worldX, y: train.cars[1].worldY, w: CAR_WIDTH, h: CAR_HEIGHT },
    frontWeapon: { x: train.cars[2].worldX, y: train.cars[2].worldY, w: CAR_WIDTH, h: CAR_HEIGHT },
  };
  spawner.update(dt, train.distance, carBounds, train.combatDifficulty || 1);

  // Wave phase transition detection → screen shake
  const currentPhase = spawner.waveInfo.phase;
  if (prevWavePhase !== -1 && currentPhase !== prevWavePhase) {
    if (currentPhase === 2 /* SURGE */) {
      // Surge start — strong shake
      train.shakeTimer = 0.3;
      train.shakeIntensity = 1.5; // slightly larger multiplier for surge
    } else if (currentPhase === 1 /* WARNING */) {
      train.shakeTimer = 0.15;
      train.shakeIntensity = 1.0;
    } else if (currentPhase === 0 /* CALM */ && prevWavePhase === 2 /* was SURGE */) {
      playWaveClear();
      // Guarantee a bandit-free recovery window after each wave
      banditSystem.spawnTimer = Math.max(banditSystem.spawnTimer, 1.5); // PROTOTYPE: shorter
      // Green flash on HP bar — "survived" visual beat
      train.hpGreenFlashTimer = 0.5;
    }
  }
  prevWavePhase = currentPhase;

  for (const e of spawner.pool) e.update(dt);
  combat.update(dt, train, spawner.pool, selectedCrew);

  // Bandits
  banditSystem.update(dt, train, train.combatDifficulty || 1, currentPhase);

  // Brawler kick AOE — check for kicks this frame
  for (const b of banditSystem.pool) {
    if (!b._brawlerKick) continue;
    b._brawlerKick = false;
    const kx = b._kickWorldX, ky = b._kickWorldY;
    const crew = b._kickCrew;
    const kickDmg = BRAWLER_KICK_DAMAGE + (crew._kickDmgBonus || 0);
    const kickR = BRAWLER_KICK_RADIUS + (crew._kickRadiusBonus || 0);
    const r2 = kickR * kickR;
    // Damage all enemies in radius
    for (const e of spawner.pool) {
      if (!e.active) continue;
      const dx = e.x - kx, dy = e.y - ky;
      if (dx * dx + dy * dy <= r2) {
        combat.spawnDamageNumber(e.x, e.y, kickDmg);
        const ex = e.x, ey = e.y, ec = e.color;
        e.takeDamage(kickDmg);
        combat.handleEnemyDamageResult(e, train, ex, ey, ec);
      }
    }
    // Big visual punch — this should feel like a moment
    train.shakeTimer = Math.max(train.shakeTimer, 0.35);
    train.shakeIntensity = 2.5;
    hitStopTimer = 0.1; // brief freeze for impact
    // Shockwave ring expanding to kick radius
    renderer.spawnBrawlerKick(kx, ky, kickR);
    // Green flash on HP bar
    train.hpGreenFlashTimer = 0.4;
  }

  // Floating damage attribution numbers
  updateDamageAttribution(dt);

  // FEATURE 2: detect first boarding and start tooltip timer
  if (!banditBoardingTooltipShown) {
    const anyOnTrain = banditSystem.pool.some(b => b.active && b.state === BANDIT_STATES.ON_TRAIN);
    if (anyOnTrain) {
      banditBoardingTooltipShown = true;
      banditBoardingTooltipTimer = 3;
    }
  }
  if (banditBoardingTooltipTimer > 0) banditBoardingTooltipTimer -= dt;

  // Coins — fly to gold HUD (top-right)
  const goldHudPos = { x: CANVAS_WIDTH - 50, y: 24 };
  coinSystem.update(dt, train.distance, goldHudPos);
  coinSystem.checkProjectileHits(combat.projectiles, goldHudPos);
  if (coinSystem.goldCollected > 0) {
    train.runGold += Math.floor(coinSystem.goldCollected * train.greedMultiplier);
    coinSystem.goldCollected = 0;
  }

  if (combat.pendingLevelUp) {
    combat.pendingLevelUp = false;
    // Start slot machine — pick a random crew member (or garlic)
    const candidates = [...train.crew.map((_, i) => i)];
    if (train.hasAutoWeapon('steamBlast')) candidates.push(-1); // -1 = garlic
    slotMachineCrewIdx = candidates[Math.floor(Math.random() * candidates.length)];
    slotMachinePhase = 'spinning';
    slotMachineTimer = 1.8;
    slotMachineSpeed = 15; // ticks/sec
    slotMachineTick = 0;
    slotMachineDisplayIdx = 0;
    state = STATES.LEVELUP;
    kbPowerupIndex = 0;
    hoveredPowerup = 0;
    playLevelUpMp3();
    renderer.spawnConfetti();
  }
}

function renderRun() {
  train.updateWorldPositions(trainScreenX, trainScreenY);
  renderer.applyShake(train, 0.016);
  renderer.drawTerrain(train.distance);
  renderer.drawSteamBlastAura(train);
  renderer.drawWorldCoins(coinSystem.coins);
  renderer.drawMagnets(coinSystem.magnets);
  renderer.drawEnemies(spawner.pool);
  renderer.drawDamageNumbers(combat.damageNumbers);
  renderer.drawProjectiles(combat.projectiles);
  renderer.drawRicochetBolts(combat.ricochetBolts);
  // Spawn + draw kill effects (consume pending kills from combat this frame)
  if (combat.killEffects.length > 0) {
    hitStopTimer = 0.033; // 2-frame micro-freeze on kills
    train.shakeTimer = Math.max(train.shakeTimer, 0.06);
    train.shakeIntensity = Math.max(train.shakeIntensity || 0, 0.5);
  }
  for (const ke of combat.killEffects) renderer.spawnKillEffect(ke.x, ke.y, ke.color);
  combat.killEffects.length = 0;
  renderer.updateAndDrawKillEffects(0.016);
  renderer.updateAndDrawKickShockwaves(0.016);
  // Muzzle flashes — queued by combat when a crew weapon fires
  for (const mf of combat.muzzleFlashes) renderer.spawnMuzzleFlash(mf.x, mf.y);
  combat.muzzleFlashes.length = 0;
  renderer.updateAndDrawMuzzleFlashes(0.016);
  // Hit sparks — queued by combat on non-lethal enemy hits
  for (const hs of combat.hitSparks) renderer.spawnHitSpark(hs.x, hs.y);
  combat.hitSparks.length = 0;
  renderer.updateAndDrawHitSparks(0.016);
  renderer.drawTrain(train);
  // FEATURE 1: passive buff pips
  renderer.drawTrainPassivePips(train);
  renderer.drawWeaponMounts(train, getSelectedMount(), selectedCrew !== null);
  renderer.drawMovingCrew(train.crew);
  renderer.drawBandits(banditSystem.pool, train.allMounts);
  // FEATURE 2: bandit telegraphing overlays
  renderer.drawBanditTelegraphing(banditSystem.pool, train.crew);
  renderer.drawBanditBoardingTooltip(banditBoardingTooltipTimer);
  renderer.drawFlyingCoins(coinSystem.flyingCoins);
  renderer.drawDamageFlash(train);
  renderer.drawMagnetFlash(coinSystem);
  // Floating damage attribution numbers (train damage/gold loss)
  drawDamageAttribution(renderer.ctx);
  // Show crew panel if any crew is unassigned (at bottom of screen, away from train)
  if (train.crew.some(c => !c.assignment && !c.isMoving)) {
    renderer.drawCrewPanel(train.crew, CANVAS_HEIGHT - 70);
  }
  renderer.drawHUD(train);
  renderer.drawWaveHUD(spawner.waveInfo);
  renderer.drawAutoWeaponHUD(train);
  // Bandit alert banner — escalates visually with dwell time
  let banditCount = 0;
  let maxDwell = 0;
  for (const b of banditSystem.pool) {
    if (b.active && (b.state === BANDIT_STATES.ON_TRAIN || b.state === BANDIT_STATES.FIGHTING)) {
      banditCount++;
      if (b.dwellTime > maxDwell) maxDwell = b.dwellTime;
    }
  }
  if (banditCount > 0) {
    const dctx2 = renderer.ctx;
    // Pulse speed ramps with dwell time
    const pulseSpeed = maxDwell >= 10 ? 0.016 : (maxDwell >= 2.5 ? 0.010 : 0.006);
    const pulse = 0.5 + Math.sin(performance.now() * pulseSpeed) * 0.5;
    const bannerW = 340;
    const bannerH = 38;
    const bannerX = CANVAS_WIDTH / 2 - bannerW / 2;
    const bannerY = 44;
    // Color shifts: amber (minor) → orange (strong) → red (disabled)
    let bgR = 180, bgG = 30, bgB = 20;
    let msg;
    if (maxDwell < 2) {
      bgR = 180; bgG = 130; bgB = 20;
      msg = banditCount === 1 ? '⚠ Bandit boarding!' : `⚠ ${banditCount} bandits boarding!`;
    } else if (maxDwell < 5) {
      bgR = 190; bgG = 60; bgB = 20;
      msg = banditCount === 1 ? '⚠ WEAPON DISRUPTED!' : `⚠ ${banditCount} WEAPONS DISRUPTED!`;
    } else {
      bgR = 220; bgG = 20; bgB = 20;
      msg = banditCount === 1 ? '⚠ WEAPON DISABLED!' : `⚠ ${banditCount} WEAPONS DISABLED!`;
    }
    dctx2.fillStyle = `rgba(${bgR}, ${bgG}, ${bgB}, ${0.85 * pulse})`;
    dctx2.fillRect(bannerX, bannerY, bannerW, bannerH);
    dctx2.strokeStyle = `rgba(255, 80, 60, ${pulse})`;
    dctx2.lineWidth = 2;
    dctx2.strokeRect(bannerX, bannerY, bannerW, bannerH);
    dctx2.fillStyle = '#fff';
    dctx2.font = 'bold 16px monospace';
    dctx2.textAlign = 'center';
    dctx2.fillText(msg, CANVAS_WIDTH / 2, bannerY + 25);
  }
  // Crew idle on auto-weapon slot hint (after bandit defeated)
  if (banditCount === 0) {
    const hasIdleCrew = train.crew.some(c => c.assignment && !c.assignment.isDriverSeat && c.assignment.hasAutoWeapon && !c.isMoving);
    if (hasIdleCrew) {
      const dctx3 = renderer.ctx;
      const bannerW = 360;
      const bannerH = 32;
      const bannerX = CANVAS_WIDTH / 2 - bannerW / 2;
      const bannerY = 44;
      dctx3.fillStyle = 'rgba(40, 60, 120, 0.8)';
      dctx3.fillRect(bannerX, bannerY, bannerW, bannerH);
      dctx3.strokeStyle = '#5a8adb';
      dctx3.lineWidth = 1;
      dctx3.strokeRect(bannerX, bannerY, bannerW, bannerH);
      dctx3.fillStyle = '#fff';
      dctx3.font = 'bold 13px monospace';
      dctx3.textAlign = 'center';
      dctx3.fillText('Crew idle! Move to an empty slot to resume firing.', CANVAS_WIDTH / 2, bannerY + 21);
    }
  }
  if (selectedCrew) renderer.drawSelectedIndicator(selectedCrew);
  if (debugMode) {
    drawDebugHitboxes();
    // Debug button only visible when debug mode active
    const dctx = renderer.ctx;
    dctx.fillStyle = 'rgba(40,90,30,0.7)';
    dctx.beginPath();
    renderer.roundRect(debugBtnRun.x, debugBtnRun.y, debugBtnRun.w, debugBtnRun.h, 4);
    dctx.fill();
    dctx.fillStyle = '#4f4';
    dctx.font = '10px monospace';
    dctx.textAlign = 'center';
    dctx.fillText('DEBUG', debugBtnRun.x + debugBtnRun.w / 2, debugBtnRun.y + 15);
  }
  renderer.flush();
}

function drawDebugHitboxes() {
  const ctx = renderer.ctx;
  ctx.save();
  ctx.globalAlpha = 0.5;

  // Project helpers at correct 3D Y heights
  const projAt = (px, py, y3d) => renderer._project(px - CANVAS_WIDTH / 2, py - CANVAS_HEIGHT / 2, y3d);

  // Train car hitboxes — project at y=0 (ground level where model sits)
  ctx.strokeStyle = '#0f0';
  ctx.lineWidth = 2;
  for (const car of train.cars) {
    const tl = projAt(car.worldX, car.worldY, 0);
    const tr = projAt(car.worldX + car.width, car.worldY, 0);
    const br = projAt(car.worldX + car.width, car.worldY + car.height, 0);
    const bl = projAt(car.worldX, car.worldY + car.height, 0);
    // Also draw top face at model height (~18)
    const tl2 = projAt(car.worldX, car.worldY, 18);
    const tr2 = projAt(car.worldX + car.width, car.worldY, 18);
    const br2 = projAt(car.worldX + car.width, car.worldY + car.height, 18);
    const bl2 = projAt(car.worldX, car.worldY + car.height, 18);
    // Bottom face
    ctx.beginPath();
    ctx.moveTo(tl.x, tl.y); ctx.lineTo(tr.x, tr.y);
    ctx.lineTo(br.x, br.y); ctx.lineTo(bl.x, bl.y);
    ctx.closePath(); ctx.stroke();
    // Top face
    ctx.beginPath();
    ctx.moveTo(tl2.x, tl2.y); ctx.lineTo(tr2.x, tr2.y);
    ctx.lineTo(br2.x, br2.y); ctx.lineTo(bl2.x, bl2.y);
    ctx.closePath(); ctx.stroke();
    // Vertical edges
    ctx.beginPath();
    ctx.moveTo(tl.x, tl.y); ctx.lineTo(tl2.x, tl2.y);
    ctx.moveTo(tr.x, tr.y); ctx.lineTo(tr2.x, tr2.y);
    ctx.moveTo(br.x, br.y); ctx.lineTo(br2.x, br2.y);
    ctx.moveTo(bl.x, bl.y); ctx.lineTo(bl2.x, bl2.y);
    ctx.stroke();
  }

  // Enemy hitboxes — project at y=4 (enemy mesh height)
  ctx.strokeStyle = '#f00';
  ctx.lineWidth = 1.5;
  for (const e of spawner.pool) {
    if (!e.active) continue;
    const center = projAt(e.x, e.y, 4);
    const right = projAt(e.x + e.radius, e.y, 4);
    const screenR = Math.sqrt((right.x - center.x) ** 2 + (right.y - center.y) ** 2);
    ctx.beginPath();
    ctx.arc(center.x, center.y, Math.max(screenR, 3), 0, Math.PI * 2);
    ctx.stroke();
  }

  // Projectile hitboxes — project at y=5 (projectile mesh height)
  ctx.strokeStyle = '#ff0';
  ctx.lineWidth = 1;
  for (const p of combat.projectiles) {
    if (!p.active) continue;
    const center = projAt(p.x, p.y, 5);
    ctx.beginPath();
    ctx.arc(center.x, center.y, 4, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Weapon range and firing cones
  ctx.globalAlpha = 0.25;
  for (const mount of train.allMounts) {
    if (!mount.isManned && !mount.hasAutoWeapon) continue;
    const center = projAt(mount.worldX, mount.worldY, 16);
    const range = mount.range || 220;
    const edgePt = projAt(mount.worldX + range, mount.worldY, 16);
    const screenRange = Math.sqrt((edgePt.x - center.x) ** 2 + (edgePt.y - center.y) ** 2);

    // Range circle
    ctx.strokeStyle = mount.hasAutoWeapon ? '#f5a623' : '#0ff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(center.x, center.y, screenRange, 0, Math.PI * 2);
    ctx.stroke();

    // Firing cone is drawn by renderer3d.js in isometric space
  }

  // Ricochet bolts
  ctx.strokeStyle = '#b388ff';
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.6;
  for (const b of combat.ricochetBolts) {
    if (!b.active) continue;
    const head = projAt(b.x, b.y, 5);
    ctx.beginPath();
    ctx.arc(head.x, head.y, 5, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Debug label
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#0f0';
  ctx.font = '12px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('DEBUG: hitboxes ON', 10, CANVAS_HEIGHT - 50);
  ctx.restore();
}

// --- LEVEL UP ---
let kbPowerupIndex = 0; // keyboard selection index

function generateGarlicCards(train) {
  const w = train.autoWeapons.steamBlast;
  if (!w) return [];
  const stats = train.getAutoWeaponStats('steamBlast');
  const cards = [];

  // Radius upgrade
  cards.push({
    type: 'garlic', name: 'WIDER AURA',
    icon: '\uD83D\uDCA8\uD83D\uDFE2', color: '#64b5f6',
    crewColor: '#8ecae6', roleLabel: 'GARLIC',
    desc: `Radius ${stats.radius} \u2192 ${stats.radius + 20}`,
    apply(t) { t.autoWeapons.steamBlast._radiusBonus = (t.autoWeapons.steamBlast._radiusBonus || 0) + 20; },
  });

  // Damage upgrade
  cards.push({
    type: 'garlic', name: 'STRONGER AURA',
    icon: '\uD83D\uDCA8\uD83D\uDD25', color: '#e57373',
    crewColor: '#8ecae6', roleLabel: 'GARLIC',
    desc: `DMG ${stats.damage} \u2192 ${stats.damage + 3}/tick`,
    apply(t) { t.autoWeapons.steamBlast._dmgBonus = (t.autoWeapons.steamBlast._dmgBonus || 0) + 3; },
  });

  // Regen as third option
  const regenLvl = train.getDefenseLevel('regen');
  if (regenLvl < 5) {
    const nextLvl = regenLvl + 1;
    cards.push({
      type: 'defence', name: regenLvl === 0 ? 'Regen — New!' : `Regen Lv${nextLvl}`,
      icon: '\u2764', color: '#e74c3c',
      desc: `+${nextLvl * 3} HP/sec`,
      apply(t) {
        if (regenLvl === 0) t.addOrUpgradeDefense({ id: 'regen', maxLevel: 5 });
        else t.addOrUpgradeDefense({ id: 'regen', maxLevel: 5 });
        t._regenRate = nextLvl * 3;
      },
    });
  }

  return cards;
}

function updateLevelUp() {
  const dt = 0.016; // approximate

  // Slot machine phase
  if (slotMachinePhase === 'spinning') {
    slotMachineTimer -= dt;
    slotMachineTick += slotMachineSpeed * dt;

    // Cycle display index
    if (slotMachineTick >= 1) {
      slotMachineTick -= 1;
      const totalCandidates = train.crew.length + (train.hasAutoWeapon('steamBlast') ? 1 : 0);
      slotMachineDisplayIdx = (slotMachineDisplayIdx + 1) % totalCandidates;
    }

    // Slow down over time
    slotMachineSpeed = Math.max(2, 15 * (slotMachineTimer / 1.8));

    if (slotMachineTimer <= 0) {
      // Land on the chosen crew member
      slotMachineDisplayIdx = slotMachineCrewIdx === -1 ? train.crew.length : slotMachineCrewIdx;
      slotMachinePhase = 'landed';
      slotMachineTimer = 0.8; // pause before showing cards
    }
    return;
  }

  if (slotMachinePhase === 'landed') {
    slotMachineTimer -= dt;
    if (slotMachineTimer <= 0) {
      // Generate cards for the chosen crew/weapon
      if (slotMachineCrewIdx === -1) {
        levelUpChoices = generateGarlicCards(train);
      } else {
        levelUpChoices = generateLevelUpCards(train, slotMachineCrewIdx);
      }
      slotMachinePhase = 'choose';
      hoveredPowerup = 0;
      kbPowerupIndex = 0;
    }
    return;
  }

  // Choose phase — normal card selection
  let mouseHover = -1;
  for (let i = 0; i < levelUpChoices.length; i++) {
    const p = levelUpChoices[i];
    if (p._x !== undefined && input.hitRect(p._x, p._y, p._w, p._h)) mouseHover = i;
  }
  if (mouseHover >= 0) hoveredPowerup = mouseHover;

  if (input.keyPressed('ArrowRight') || input.keyPressed('KeyD')) {
    kbPowerupIndex = Math.min(levelUpChoices.length - 1, kbPowerupIndex + 1);
    hoveredPowerup = kbPowerupIndex;
  }
  if (input.keyPressed('ArrowLeft') || input.keyPressed('KeyA')) {
    kbPowerupIndex = Math.max(0, kbPowerupIndex - 1);
    hoveredPowerup = kbPowerupIndex;
  }

  const confirmKey = input.keyPressed('Space') || input.keyPressed('Enter');
  if ((input.clicked && mouseHover >= 0) || (confirmKey && hoveredPowerup >= 0)) {
    const chosenCard = levelUpChoices[hoveredPowerup];
    chosenCard.apply(train);
    playPowerup();
    slotMachinePhase = 'none';
    state = STATES.RUNNING;
    lastTime = performance.now();
  }
}

function renderLevelUp() {
  train.updateWorldPositions(trainScreenX, trainScreenY);
  renderer.drawTerrain(train.distance);
  renderer.drawEnemies(spawner.pool);
  renderer.drawDamageNumbers(combat.damageNumbers);
  renderer.drawProjectiles(combat.projectiles);
  renderer.drawTrain(train);
  renderer.drawWeaponMounts(train, null);
  renderer.drawMovingCrew(train.crew);
  renderer.drawHUD(train);

  // Ensure globalAlpha is reset before drawing overlays — earlier draw calls
  // (damage numbers, moving crew, etc.) may leave it below 1.0.
  renderer.ctx.globalAlpha = 1;

  if (slotMachinePhase === 'spinning' || slotMachinePhase === 'landed') {
    // Slot machine overlay
    const ctx = renderer.ctx;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.fillStyle = '#f5a623';
    ctx.font = 'bold 28px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`LEVEL ${train.level}!`, CANVAS_WIDTH / 2, 140);

    // Slot machine box
    const boxW = 200;
    const boxH = 160;
    const boxX = CANVAS_WIDTH / 2 - boxW / 2;
    const boxY = 170;

    ctx.fillStyle = 'rgba(20, 22, 35, 0.95)';
    ctx.beginPath();
    renderer.roundRect(boxX, boxY, boxW, boxH, 12);
    ctx.fill();
    ctx.strokeStyle = '#f5a623';
    ctx.lineWidth = 2;
    ctx.beginPath();
    renderer.roundRect(boxX, boxY, boxW, boxH, 12);
    ctx.stroke();

    // Determine what to show
    const allCandidates = [];
    for (const c of train.crew) allCandidates.push({ emoji: c.role === 'Gunner' ? '\uD83D\uDC31' : '\u26C4\uFE0F', name: c.name, color: c.color, role: c.role });
    if (train.hasAutoWeapon('steamBlast')) allCandidates.push({ emoji: '\uD83D\uDCA8', name: 'Garlic', color: '#8ecae6', role: 'WEAPON' });

    const displayItem = allCandidates[slotMachineDisplayIdx % allCandidates.length];
    const isLanded = slotMachinePhase === 'landed';

    // Big emoji
    const scale = isLanded ? 1.2 : 1.0;
    ctx.font = `${Math.round(60 * scale)}px serif`;
    ctx.textAlign = 'center';
    ctx.fillText(displayItem.emoji, CANVAS_WIDTH / 2, boxY + 80);

    // Name
    ctx.fillStyle = isLanded ? displayItem.color : '#aaa';
    ctx.font = `bold ${isLanded ? 18 : 14}px monospace`;
    ctx.fillText(displayItem.name, CANVAS_WIDTH / 2, boxY + 110);

    // Role
    const roleColor = displayItem.role === 'Gunner' ? '#ffb74d' : displayItem.role === 'Brawler' ? '#66bb6a' : '#8ecae6';
    ctx.fillStyle = roleColor;
    ctx.font = 'bold 11px monospace';
    ctx.fillText(displayItem.role || '', CANVAS_WIDTH / 2, boxY + 130);

    if (isLanded) {
      ctx.fillStyle = '#888';
      ctx.font = '12px monospace';
      ctx.fillText('Upgrading...', CANVAS_WIDTH / 2, boxY + boxH + 20);
    }
  } else {
    // Card selection phase
    // Pass the chosen crew/garlic info for the identity banner
    const chosenInfo = slotMachineCrewIdx === -1
      ? { emoji: '\uD83D\uDCA8', name: 'Garlic', color: '#8ecae6', role: 'WEAPON' }
      : { emoji: train.crew[slotMachineCrewIdx].role === 'Gunner' ? '\uD83D\uDC31' : '\u26C4\uFE0F',
          name: train.crew[slotMachineCrewIdx].name,
          color: train.crew[slotMachineCrewIdx].color,
          role: train.crew[slotMachineCrewIdx].role };
    renderer.drawLevelUpMenu(train.level, levelUpChoices, hoveredPowerup, train, chosenInfo);
  }

  renderer.drawAutoWeaponHUD(train);
  renderer.updateAndDrawConfetti(0.016);
  renderer.flush();
}

// --- PLACE WEAPON ---
function updatePlaceWeapon() {
  if (!pendingWeaponId) { state = STATES.RUNNING; lastTime = performance.now(); return; }

  // During fanfare freeze, block placement input
  if (fanfareTimer > 0) return;

  if (input.clicked) {
    // Find which empty mount was clicked (not bandit-occupied)
    for (const mount of train.allMounts) {
      if (mount.isOccupied || mount._bandit) continue;
      if (input.hitCircle(slotScreenX(mount), slotScreenY(mount), 22)) {
        // Place the weapon here
        mount.autoWeaponId = pendingWeaponId;
        train.autoWeapons[pendingWeaponId] = { level: 1, cooldownTimer: 0, tickTimer: 0, mount };
        pendingWeaponId = null;
        state = STATES.RUNNING;
        lastTime = performance.now();
        return;
      }
    }
  }
}

function renderPlaceWeapon() {
  train.updateWorldPositions(trainScreenX, trainScreenY);
  renderer.drawTerrain(train.distance);
  renderer.drawEnemies(spawner.pool);
  renderer.drawTrain(train);
  renderer.drawWeaponMounts(train, null, true);
  renderer.drawMovingCrew(train.crew);

  // Tick fanfare timer here (during the freeze, update is skipped so we tick in render)
  if (fanfareTimer > 0) {
    fanfareTimer -= 0.016; // approximate per-frame decrement (~60fps)
    // Draw fanfare overlay
    const rctx = renderer.ctx;
    const fadeStart = 0.2; // start fading at 0.2s remaining
    let alpha = 1;
    if (fanfareTimer < fadeStart) {
      alpha = Math.max(0, fanfareTimer / fadeStart);
    }
    rctx.save();
    rctx.globalAlpha = alpha;
    // Dark backdrop strip
    rctx.fillStyle = 'rgba(0,0,0,0.55)';
    rctx.fillRect(0, CANVAS_HEIGHT / 2 - 50, CANVAS_WIDTH, 80);
    // Glow / shadow
    rctx.shadowColor = fanfareColor;
    rctx.shadowBlur = 24;
    rctx.fillStyle = fanfareColor;
    rctx.font = 'bold 28px monospace';
    rctx.textAlign = 'center';
    rctx.textBaseline = 'middle';
    rctx.fillText(fanfareText, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 10);
    rctx.shadowBlur = 0;
    rctx.restore();
  }

  // Highlight empty mounts (not bandit-occupied)
  const ctx = renderer.ctx;
  const def = pendingWeaponId ? AUTO_WEAPONS[pendingWeaponId] : null;
  for (const mount of train.allMounts) {
    if (mount.isOccupied) continue;
    if (mount._bandit) {
      // Show as blocked
      const sx = slotScreenX(mount), sy = slotScreenY(mount);
      ctx.beginPath();
      ctx.arc(sx, sy, MOUNT_RADIUS + 6, 0, Math.PI * 2);
      ctx.strokeStyle = '#e74c3c';
      ctx.lineWidth = 2;
      ctx.stroke();
      // X mark
      ctx.strokeStyle = '#e74c3c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx - 5, sy - 5); ctx.lineTo(sx + 5, sy + 5);
      ctx.moveTo(sx + 5, sy - 5); ctx.lineTo(sx - 5, sy + 5);
      ctx.stroke();
      continue;
    }
    const hovered = input.hitCircle(slotScreenX(mount), slotScreenY(mount), 22);
    ctx.beginPath();
    ctx.arc(slotScreenX(mount), slotScreenY(mount), MOUNT_RADIUS + 6, 0, Math.PI * 2);
    ctx.strokeStyle = hovered ? '#fff' : '#f5a623';
    ctx.lineWidth = hovered ? 3 : 2;
    ctx.stroke();
  }

  // Overlay text
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, CANVAS_WIDTH, 50);
  ctx.fillStyle = def ? def.color : '#f5a623';
  ctx.font = 'bold 20px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`Place ${def ? def.name : 'weapon'} — click an empty mount`, CANVAS_WIDTH / 2, 34);
  renderer.flush();
}

// --- GAMEOVER ---
let goldEarned = 0;
let gameOverType = 'death'; // 'death' | 'combat' | 'zone' | 'world'

function enterGameOver() {
  stopLowHPWarning();
  const cargoMultiplier = train.cargoMultiplier;
  const modGoldMult = spawner.modifier ? spawner.modifier.goldMult : 1;
  if (won) {
    goldEarned = Math.floor(train.runGold * cargoMultiplier * modGoldMult);
  } else {
    goldEarned = train.runGold;
  }
  save.gold += goldEarned;
  state = STATES.GAMEOVER;
  gameOverType = won ? 'combat' : 'death';
  if (won) {
    zone.addCoal(COAL_PER_WIN);
    playPowerup();
    for (let i = 0; i < 6; i++) {
      setTimeout(() => renderer.spawnConfetti(), i * 150);
    }
  } else {
    playDefeatMp3();
  }
}

function enterZoneComplete() {
  won = true;
  goldEarned = zone.stationsVisited * GOLD_PER_STATION;
  gameOverType = 'zone';
  state = STATES.GAMEOVER;
  playZoneCompleteMp3();
  for (let i = 0; i < 6; i++) {
    setTimeout(() => renderer.spawnConfetti(), i * 150);
  }
}

function enterWorldComplete() {
  won = true;
  // World completion bonus gold
  goldEarned = 200 + Math.floor(train.runGold * 0.5);
  save.gold += goldEarned;
  gameOverType = 'world';
  state = STATES.GAMEOVER;
  playWinWorldMp3();
  // Massive confetti + fireworks bursts
  for (let i = 0; i < 15; i++) {
    setTimeout(() => renderer.spawnConfetti(), i * 150);
  }
  // Staggered firework bursts
  for (let i = 0; i < 8; i++) {
    setTimeout(() => renderer.spawnFirework(), 300 + i * 400);
  }
}

const gameOverBtns = {
  continue: { x: CANVAS_WIDTH / 2 - 70, y: CANVAS_HEIGHT / 2 + 70, w: 140, h: 44 },
  shop:     { x: CANVAS_WIDTH / 2 - 150, y: CANVAS_HEIGHT / 2 + 70, w: 130, h: 44 },
  nextZone: { x: CANVAS_WIDTH / 2 + 20, y: CANVAS_HEIGHT / 2 + 70, w: 130, h: 44 },
};

function updateGameOver() {
  const confirmKey = input.keyPressed('Space') || input.keyPressed('Enter');

  if (gameOverType === 'zone') {
    if (confirmKey || (input.clicked && input.hitRect(gameOverBtns.nextZone.x, gameOverBtns.nextZone.y, gameOverBtns.nextZone.w, gameOverBtns.nextZone.h))) {
      newZone();
      state = STATES.WORLD_MAP;
      return;
    }
  } else {
    if (confirmKey || (input.clicked && input.hitRect(gameOverBtns.continue.x, gameOverBtns.continue.y, gameOverBtns.continue.w, gameOverBtns.continue.h))) {
      if (gameOverType === 'combat') {
        state = STATES.ZONE_MAP;
      } else {
        afterGameOver();
      }
      return;
    }
  }
}

function afterGameOver() {
  if (won) {
    state = STATES.ZONE_MAP;
  } else {
    // Death returns to the start screen so the player picks a world again
    state = STATES.START_SCREEN;
  }
}

function renderGameOver() {
  train.updateWorldPositions(trainScreenX, trainScreenY);
  renderer.drawTerrain(train.distance);
  renderer.drawEnemies(spawner.pool);
  renderer.drawDamageNumbers(combat.damageNumbers);
  renderer.drawTrain(train);
  renderer.drawWeaponMounts(train, null);
  renderer.drawMovingCrew(train.crew);
  renderer.drawGameOver(won, train, goldEarned, gameOverBtns, input, gameOverType, save.gold);
  renderer.updateAndDrawConfetti(0.016);
  renderer.flush();
}

// --- SHOP (tiered upgrades) ---
let kbShopIndex = 0;
let kbShopOnDepart = false;

const shopCloseBtn = { x: CANVAS_WIDTH / 2 - 80, y: CANVAS_HEIGHT - 68, w: 160, h: 44 };

function updateShop() {
  // Mouse hover on upgrade rows
  let mouseHover = -1;
  for (let i = 0; i < UPGRADE_KEYS.length; i++) {
    const u = save.upgrades[UPGRADE_KEYS[i]];
    if (u._y !== undefined && input.hitRect(60, u._y, CANVAS_WIDTH - 120, 44)) {
      mouseHover = i;
    }
  }
  if (mouseHover >= 0) { hoveredShopItem = mouseHover; kbShopOnDepart = false; }

  // Keyboard nav
  if (input.keyPressed('ArrowDown') || input.keyPressed('KeyS')) {
    if (!kbShopOnDepart) {
      kbShopIndex++;
      if (kbShopIndex >= UPGRADE_KEYS.length) { kbShopOnDepart = true; hoveredShopItem = -1; }
      else hoveredShopItem = kbShopIndex;
    }
  }
  if (input.keyPressed('ArrowUp') || input.keyPressed('KeyW')) {
    if (kbShopOnDepart) { kbShopOnDepart = false; kbShopIndex = UPGRADE_KEYS.length - 1; hoveredShopItem = kbShopIndex; }
    else { kbShopIndex = Math.max(0, kbShopIndex - 1); hoveredShopItem = kbShopIndex; }
  }

  const confirmKey = input.keyPressed('Space') || input.keyPressed('Enter');

  // Buy upgrade
  if (input.clicked || confirmKey) {
    const idx = confirmKey ? kbShopIndex : hoveredShopItem;
    if (idx >= 0 && idx < UPGRADE_KEYS.length) {
      const key = UPGRADE_KEYS[idx];
      const u = save.upgrades[key];
      const cost = u.cost * (u.level + 1);
      if (u.level < u.maxLevel && save.gold >= cost) {
        save.gold -= cost;
        u.level++;
        playPowerup();
      }
    }
  }

  // Close button
  if ((input.clicked && input.hitRect(shopCloseBtn.x, shopCloseBtn.y, shopCloseBtn.w, shopCloseBtn.h))
      || (confirmKey && kbShopOnDepart)
      || input.keyPressed('Escape')) {
    state = STATES.START_SCREEN;
  }
}

function renderShop() {
  renderer.drawArmory(save, UPGRADE_KEYS, hoveredShopItem, shopCloseBtn, input, kbShopOnDepart);
  renderer.flush();
}

// --- VOLUME SLIDER LOGIC (shared between settings & pause) ---
let activeSliderDrag = null; // 'music' | 'sfx' | null
const SLIDER_X = CANVAS_WIDTH / 2 - 100;
const SLIDER_W = 200;

function updateVolumeSliders(musicY, sfxY) {
  if (input.clicked) {
    if (input.hitRect(SLIDER_X - 10, musicY - 10, SLIDER_W + 20, 20)) activeSliderDrag = 'music';
    else if (input.hitRect(SLIDER_X - 10, sfxY - 10, SLIDER_W + 20, 20)) activeSliderDrag = 'sfx';
  }
  if (!input.mouseDown) activeSliderDrag = null;
  if (activeSliderDrag) {
    const val = Math.max(0, Math.min(1, (input.mouseX - SLIDER_X) / SLIDER_W));
    if (activeSliderDrag === 'music') setMusicVolume(val);
    else setSfxVolume(val);
    return true; // dragging
  }
  return false;
}

// --- SETTINGS ---
const settingsDebugBtn = { x: CANVAS_WIDTH / 2 - 80, y: 390, w: 160, h: 36 };
const settingsBackBtn = { x: CANVAS_WIDTH / 2 - 60, y: 440, w: 120, h: 40 };

function updateSettings() {
  if (input.keyPressed('Escape')
      || (input.clicked && input.hitRect(settingsBackBtn.x, settingsBackBtn.y, settingsBackBtn.w, settingsBackBtn.h))) {
    state = STATES.START_SCREEN;
    activeSliderDrag = null;
    return;
  }

  if (input.clicked && input.hitRect(settingsDebugBtn.x, settingsDebugBtn.y, settingsDebugBtn.w, settingsDebugBtn.h)) {
    debugMode = !debugMode;
  }

  updateVolumeSliders(260, 330);
}

function renderSettings() {
  renderer.drawTerrain(0);
  const ctx = renderer.ctx;

  // Dim overlay
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // Title
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 28px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('SETTINGS', CANVAS_WIDTH / 2, 200);

  drawSlider(ctx, 'Music', SLIDER_X, 260, SLIDER_W, getMusicVolume());
  drawSlider(ctx, 'SFX', SLIDER_X, 330, SLIDER_W, getSfxVolume());

  // Debug toggle button
  const db = settingsDebugBtn;
  const debugHovered = input.hitRect(db.x, db.y, db.w, db.h);
  ctx.fillStyle = debugMode ? '#2a5e1e' : (debugHovered ? '#555' : '#333');
  ctx.beginPath();
  renderer.roundRect(db.x, db.y, db.w, db.h, 6);
  ctx.fill();
  ctx.strokeStyle = debugMode ? '#4a4' : '#555';
  ctx.lineWidth = 1;
  ctx.beginPath();
  renderer.roundRect(db.x, db.y, db.w, db.h, 6);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 14px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(debugMode ? 'Hitboxes: ON' : 'Hitboxes: OFF', CANVAS_WIDTH / 2, db.y + 23);

  const bb = settingsBackBtn;
  const hovered = input.hitRect(bb.x, bb.y, bb.w, bb.h);
  ctx.fillStyle = hovered ? '#555' : '#333';
  ctx.beginPath();
  renderer.roundRect(bb.x, bb.y, bb.w, bb.h, 6);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 16px monospace';
  ctx.fillText('Back', CANVAS_WIDTH / 2, bb.y + 26);

  renderer.flush();
}

function drawSlider(ctx, label, x, y, w, value) {
  // Label
  ctx.fillStyle = '#aaa';
  ctx.font = '16px monospace';
  ctx.textAlign = 'right';
  ctx.fillText(label, x - 16, y + 5);

  // Track
  ctx.fillStyle = '#444';
  ctx.fillRect(x, y - 3, w, 6);

  // Filled portion
  ctx.fillStyle = '#f5a623';
  ctx.fillRect(x, y - 3, w * value, 6);

  // Handle
  const hx = x + w * value;
  ctx.beginPath();
  ctx.arc(hx, y, 10, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.strokeStyle = '#f5a623';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Percentage
  ctx.fillStyle = '#ccc';
  ctx.font = '12px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`${Math.round(value * 100)}%`, x + w + 16, y + 5);
}

// --- RUN_PAUSE (tactical pause during run — Space to toggle) ---
function updateRunPause() {
  // Resume on Space or Escape
  if (input.keyPressed('Space') || input.keyPressed('Escape')) {
    pauseAimMount = null;
    state = STATES.RUNNING;
    lastTime = performance.now();
    return;
  }

  // Aim selected mount / auto-weapon in real-time as mouse moves
  if (pauseAimMount) {
    const mouseWorld = renderer.screenToPixel(input.mouseX, input.mouseY, 16);
    pauseAimMount.coneDirection = pauseAimMount.clampAngle(Math.atan2(
      mouseWorld.y - pauseAimMount.worldY,
      mouseWorld.x - pauseAimMount.worldX
    ));
    if (pauseAimMount.hasAutoWeapon) pauseAimMount.directionLocked = true;
  }

  if (input.leftClicked) {
    // Try selecting crew first
    const clickedCrew = findCrewAtMouse();
    if (clickedCrew) {
      selectedCrew = clickedCrew === selectedCrew ? null : clickedCrew;
      pauseAimMount = null;
      return;
    }
    // Try selecting a mount to aim
    const slot = findSlotAtMouse();
    if (slot && (slot.isManned || slot.hasAutoWeapon)) {
      pauseAimMount = pauseAimMount === slot ? null : slot;
      selectedCrew = null;
      return;
    }
    // Click on empty — deselect all
    selectedCrew = null;
    pauseAimMount = null;
  }

  // Right-click with selected crew: queue crew to a slot (walks when unpaused)
  if (input.rightClicked && selectedCrew) {
    const slot = findSlotAtMouse();
    if (slot && (!slot.autoWeaponId || slot._bandit)) {
      const fromSlot = selectedCrew.assignment;
      if (fromSlot) {
        const fromX = fromSlot.worldX;
        const fromY = fromSlot.worldY;
        const fromCar = train.findCarForSlot(fromSlot);
        train.unassignCrew(selectedCrew);
        selectedCrew.moveScreenX = undefined;
        train.startCrewMove(selectedCrew, fromX, fromY, fromCar, slot);
      } else {
        train.assignCrew(selectedCrew, slot);
      }
    }
  }
}

function renderRunPause() {
  train.updateWorldPositions(trainScreenX, trainScreenY);
  renderer.drawTerrain(train.distance);
  renderer.drawEnemies(spawner.pool);
  renderer.drawTrain(train);
  renderer.drawWeaponMounts(train, getSelectedMount(), selectedCrew !== null);
  renderer.drawMovingCrew(train.crew);
  renderer.drawBandits(banditSystem.pool, train.allMounts);
  renderer.drawFlyingCoins(coinSystem.flyingCoins);
  renderer.drawHUD(train);
  renderer.drawWaveHUD(spawner.waveInfo);
  renderer.drawAutoWeaponHUD(train);
  if (train.crew.some(c => !c.assignment && !c.isMoving)) {
    renderer.drawCrewPanel(train.crew, CANVAS_HEIGHT - 70);
  }
  if (selectedCrew) renderer.drawSelectedIndicator(selectedCrew);

  // Highlight the mount being aimed
  if (pauseAimMount && pauseAimMount.screenX !== undefined) {
    const ctx = renderer.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.arc(pauseAimMount.screenX, pauseAimMount.screenY, MOUNT_RADIUS + 6, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.8 + Math.sin(performance.now() * 0.01) * 0.2;
    ctx.stroke();
    ctx.restore();
  }

  // Banner
  const ctx = renderer.ctx;
  ctx.save();
  ctx.fillStyle = 'rgba(10,20,50,0.85)';
  ctx.fillRect(0, 0, CANVAS_WIDTH, 36);
  ctx.strokeStyle = '#4488ff';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, CANVAS_WIDTH, 36);
  ctx.fillStyle = '#88aaff';
  ctx.font = 'bold 15px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('TACTICAL PAUSE', CANVAS_WIDTH / 2, 23);
  ctx.restore();

  // Instructions
  ctx.save();
  ctx.fillStyle = 'rgba(10,20,50,0.75)';
  ctx.fillRect(0, CANVAS_HEIGHT - 30, CANVAS_WIDTH, 30);
  ctx.fillStyle = '#aabbcc';
  ctx.font = '11px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('Left-click crew to select  •  Right-click slot to assign  •  Left-click gun to aim  •  SPACE / ESC to resume', CANVAS_WIDTH / 2, CANVAS_HEIGHT - 11);
  ctx.restore();

  renderer.flush();
}

// --- PAUSED ---
let kbPauseIndex = 0;
const pauseKeys = ['resume', 'restart', 'quit'];

function updatePaused() {
  if (input.keyPressed('Escape')) {
    state = stateBeforePause;
    lastTime = performance.now();
    activeSliderDrag = null;
    return;
  }

  if (updateVolumeSliders(460, 500)) return;

  if (input.keyPressed('ArrowDown') || input.keyPressed('KeyS')) {
    kbPauseIndex = Math.min(pauseKeys.length - 1, kbPauseIndex + 1);
  }
  if (input.keyPressed('ArrowUp') || input.keyPressed('KeyW')) {
    kbPauseIndex = Math.max(0, kbPauseIndex - 1);
  }

  const confirmKey = input.keyPressed('Space') || input.keyPressed('Enter');
  const clickedBtn = (key) => {
    const b = pauseButtons[key];
    return input.clicked && input.hitRect(b.x, b.y, b.w, b.h);
  };

  if (clickedBtn('resume') || (confirmKey && kbPauseIndex === 0)) {
    state = stateBeforePause;
    lastTime = performance.now();
  } else if (clickedBtn('restart') || (confirmKey && kbPauseIndex === 1)) {
    startNewWorld();
    state = STATES.ZONE_MAP;
  } else if (clickedBtn('quit') || (confirmKey && kbPauseIndex === 2)) {
    state = STATES.ZONE_MAP;
  }
}

function renderPaused() {
  // Draw game state behind
  train.updateWorldPositions(trainScreenX, trainScreenY);
  renderer.drawTerrain(train.distance);
  renderer.drawEnemies(spawner.pool);
  renderer.drawTrain(train);
  renderer.drawWeaponMounts(train, null);
  renderer.drawMovingCrew(train.crew);
  renderer.drawHUD(train);

  // Overlay
  renderer.drawPauseMenu(pauseButtons, input, kbPauseIndex);

  // Volume sliders below pause buttons
  const ctx = renderer.ctx;
  drawSlider(ctx, 'Music', SLIDER_X, 460, SLIDER_W, getMusicVolume());
  drawSlider(ctx, 'SFX', SLIDER_X, 500, SLIDER_W, getSfxVolume());

  renderer.flush();
}

// --- ZONE MAP ---
let kbZoneIndex = -1; // keyboard-selected reachable station index

function getReachableStations() {
  return zone.stations.filter(s => zone.canTravelTo(s.id));
}

let musicStarted = false;
function updateZoneMap() {
  renderer.setZoneGold(save.gold);

  // Check if stranded (no coal, no reachable stations)
  if (zone.failed) {
    won = false;
    goldEarned = 0;
    gameOverType = 'death';
    state = STATES.GAMEOVER;
    playDefeatMp3();
    return;
  }

  // Start music on first interaction
  if (!musicStarted && input.clicked) {
    startMusic();
    preloadSfx();
    musicStarted = true;
  }

  // Station arrival overlay
  if (stationArrival) {
    const dt = 0.016; // approximate frame dt
    updateStationArrival(dt);
    return; // block input during arrival
  }

  const reachable = getReachableStations();

  // Keyboard navigation through reachable stations
  if (input.keyPressed('ArrowRight') || input.keyPressed('KeyD') || input.keyPressed('Tab')) {
    kbZoneIndex = Math.min(reachable.length - 1, kbZoneIndex + 1);
  }
  if (input.keyPressed('ArrowLeft') || input.keyPressed('KeyA')) {
    kbZoneIndex = Math.max(0, kbZoneIndex - 1);
  }
  if (input.keyPressed('ArrowDown') || input.keyPressed('KeyS')) {
    // Find next reachable station below current
    if (kbZoneIndex >= 0 && kbZoneIndex < reachable.length) {
      const cur = reachable[kbZoneIndex];
      let bestIdx = kbZoneIndex;
      let bestDist = Infinity;
      reachable.forEach((s, i) => {
        if (s.y > cur.y && Math.abs(s.y - cur.y) < bestDist) {
          bestDist = Math.abs(s.y - cur.y);
          bestIdx = i;
        }
      });
      kbZoneIndex = bestIdx;
    }
  }
  if (input.keyPressed('ArrowUp') || input.keyPressed('KeyW')) {
    if (kbZoneIndex >= 0 && kbZoneIndex < reachable.length) {
      const cur = reachable[kbZoneIndex];
      let bestIdx = kbZoneIndex;
      let bestDist = Infinity;
      reachable.forEach((s, i) => {
        if (s.y < cur.y && Math.abs(s.y - cur.y) < bestDist) {
          bestDist = Math.abs(s.y - cur.y);
          bestIdx = i;
        }
      });
      kbZoneIndex = bestIdx;
    }
  }

  // Clamp
  if (reachable.length > 0) {
    kbZoneIndex = Math.max(0, Math.min(reachable.length - 1, kbZoneIndex));
    // Pass to renderer for highlighting
    renderer._kbHighlightStation = reachable[kbZoneIndex]?.id ?? -1;
  } else {
    renderer._kbHighlightStation = -1;
  }

  // Confirm with space/enter
  if ((input.keyPressed('Space') || input.keyPressed('Enter')) && kbZoneIndex >= 0 && kbZoneIndex < reachable.length) {
    const s = reachable[kbZoneIndex];
    zone.travelTo(s.id);
    kbZoneIndex = 0;
    enterStation(s);
    return;
  }

  // Settings button (top-right area)
  const settingsBtn = { x: CANVAS_WIDTH - 110, y: 44, w: 90, h: 30 };
  if (input.clicked && input.hitRect(settingsBtn.x, settingsBtn.y, settingsBtn.w, settingsBtn.h)) {
    state = STATES.SETTINGS;
    return;
  }

  // Mouse click on stations
  if (input.clicked) {
    for (const s of zone.stations) {
      if (!zone.canTravelTo(s.id)) continue;
      const pad = 60;
      const mapW = CANVAS_WIDTH - pad * 2;
      const mapH = CANVAS_HEIGHT - 100;
      const mapY = 55;
      const stX = pad + s.x * mapW;
      const stY = mapY + s.y * mapH;
      const dx = input.mouseX - stX;
      const dy = input.mouseY - stY;
      if (dx * dx + dy * dy <= 20 * 20) {
        zone.travelTo(s.id);
        kbZoneIndex = 0;
        enterStation(s);
        return;
      }
    }
  }
}

let stationArrival = null; // { type, timer } — brief overlay showing what you found

function enterStation(station) {
  if (station.type === STATION_TYPES.START) return;

  const isPreBoss = station.type === STATION_TYPES.COMBAT &&
    station.connections.some(id => zone.stations[id].type === STATION_TYPES.EXIT);

  const typeLabels = {
    combat: isPreBoss ? '💀 FINAL BATTLE! 💀' : '⚔ ZOMBIES AHEAD! ⚔',
    empty: '— Quiet Stop —',
    start: '',
    exit: '★ ZONE COMPLETE! ★',
  };

  stationArrival = {
    type: station.type,
    label: typeLabels[station.type] || '',
    timer: station.type === STATION_TYPES.EMPTY ? 1.0 : 1.5,
    station,
    acted: false,
    isPreBoss,
  };
}

function updateStationArrival(dt) {
  if (!stationArrival) return false;
  stationArrival.timer -= dt;

  if (stationArrival.timer <= 0 && !stationArrival.acted) {
    stationArrival.acted = true;
    const s = stationArrival.station;
    switch (s.type) {
      case STATION_TYPES.COMBAT: {
        combatDifficulty = 1 + (zoneNumber - 1) * ZONE_DIFFICULTY_SCALE;
        const isBoss = stationArrival?.isPreBoss || false;
        if (isBoss) combatDifficulty *= 1.6;
        prepareForCombat(isBoss, s.modifier || null);
        break;
      }
      case STATION_TYPES.EXIT:
        save.gold += zone.stationsVisited * GOLD_PER_STATION;
        if (zoneNumber >= ZONES_PER_WORLD) {
          enterWorldComplete();
        } else {
          enterZoneComplete();
        }
        break;
      case STATION_TYPES.EMPTY:
        // Stay on zone map
        break;
    }
    stationArrival = null;
  }
  return true; // still showing
}

function renderZoneMap() {
  renderer.drawZoneMap(zone, input, save);
  if (stationArrival) {
    renderer.drawStationArrival(stationArrival);
  }
  renderer.flush();
}

// --- START SCREEN ---
const startScreenBtns = {
  start:    { x: CANVAS_WIDTH / 2 - 120, y: CANVAS_HEIGHT / 2 + 20,  w: 240, h: 50 },
  powerups: { x: CANVAS_WIDTH / 2 - 120, y: CANVAS_HEIGHT / 2 + 82,  w: 240, h: 50 },
  settings: { x: CANVAS_WIDTH / 2 - 120, y: CANVAS_HEIGHT / 2 + 144, w: 240, h: 50 },
};

function updateStartScreen() {
  if (!input.clicked) return;
  if (input.hitRect(startScreenBtns.start.x, startScreenBtns.start.y, startScreenBtns.start.w, startScreenBtns.start.h)) {
    selectedWorld = WORLDS[0];
    startNewWorld();
    combatDifficulty = selectedWorld.difficulty;
    state = STATES.WORLD_MAP;
  } else if (input.hitRect(startScreenBtns.powerups.x, startScreenBtns.powerups.y, startScreenBtns.powerups.w, startScreenBtns.powerups.h)) {
    hoveredShopItem = -1;
    kbShopIndex = 0;
    state = STATES.SHOP;
  } else if (input.hitRect(startScreenBtns.settings.x, startScreenBtns.settings.y, startScreenBtns.settings.w, startScreenBtns.settings.h)) {
    state = STATES.SETTINGS;
  }
}

function renderStartScreen() {
  renderer.drawStartScreen(startScreenBtns, input);
  renderer.flush();
}

// --- WORLD SELECT ---
const WORLD_CARD = { w: 210, h: 270, gap: 28 };

function getWorldCardX(i) {
  const total = WORLDS.length * WORLD_CARD.w + (WORLDS.length - 1) * WORLD_CARD.gap;
  return CANVAS_WIDTH / 2 - total / 2 + i * (WORLD_CARD.w + WORLD_CARD.gap);
}

function updateWorldSelect() {
  hoveredWorldIndex = -1;
  const cardY = CANVAS_HEIGHT / 2 - WORLD_CARD.h / 2;
  for (let i = 0; i < WORLDS.length; i++) {
    const cx = getWorldCardX(i);
    if (input.hitRect(cx, cardY, WORLD_CARD.w, WORLD_CARD.h)) {
      hoveredWorldIndex = i;
      if (input.clicked) {
        selectedWorld = WORLDS[i];
        startNewWorld();
        // Apply world difficulty on top of the reset done by startNewWorld
        combatDifficulty = selectedWorld.difficulty;
        state = STATES.WORLD_MAP;
      }
    }
  }
  if (input.keyPressed('Escape')) state = STATES.START_SCREEN;
}

function renderWorldSelect() {
  renderer.drawWorldSelect(WORLDS, WORLD_CARD, getWorldCardX, hoveredWorldIndex, input);
  renderer.flush();
}

// --- WORLD MAP ---
function getWorldMapZones() {
  const nodeR = 48;
  const gap = 120;
  const total = ZONES_PER_WORLD * nodeR * 2 + (ZONES_PER_WORLD - 1) * gap;
  const startX = CANVAS_WIDTH / 2 - total / 2 + nodeR;
  const cy = CANVAS_HEIGHT / 2 - 10;
  return Array.from({ length: ZONES_PER_WORLD }, (_, i) => ({
    index: i,
    number: i + 1,
    cx: startX + i * (nodeR * 2 + gap),
    cy,
    r: nodeR,
    completed: zoneNumber > i + 1,
    isCurrent: zoneNumber === i + 1,
    isLocked: zoneNumber < i + 1,
  }));
}

function autoPlaceGarlic() {
  if (train.hasAutoWeapon('steamBlast')) return;
  const mount = train.allMounts.find(m => !m.isOccupied && !m.crew);
  if (!mount) return;
  mount.autoWeaponId = 'steamBlast';
  mount.coneHalfAngle = AUTO_WEAPON_CONE_HALF_ANGLE;
  train.autoWeapons.steamBlast = { level: 1, cooldownTimer: 0, tickTimer: 0, mount };
  garlicPlaced = true;
}

function updateWorldMap() {
  // Loadout pick (once per world) — crew roles + weapon
  if (!rolesChosen) {
    hoveredRoleBtn = null;
    for (const btn of rolePickButtons) {
      if (input.hitRect(btn.x, btn.y, btn.w, btn.h)) {
        hoveredRoleBtn = btn.key;
      }
    }
    if (input.leftClicked) {
      for (const btn of rolePickButtons) {
        if (!input.hitRect(btn.x, btn.y, btn.w, btn.h)) continue;
        if (btn.type === 'roster') {
          const emptyIdx = train.crew.findIndex(c => c.role === null);
          if (emptyIdx >= 0) train.crew[emptyIdx].role = btn.roleId;
        } else if (btn.type === 'roster_weapon') {
          if (!garlicPlaced) garlicPlaced = true; // assign garlic to weapon slot
        } else if (btn.type === 'slot') {
          train.crew[btn.crewIdx].role = null;
        } else if (btn.type === 'slot_weapon') {
          garlicPlaced = false; // remove garlic from weapon slot
        } else if (btn.type === 'confirm') {
          rolesChosen = true;
          // Auto-place garlic on a mount when confirming
          autoPlaceGarlic();
        }
      }
    }
    return;
  }

  // Normal world map
  const zones = getWorldMapZones();
  for (const z of zones) {
    if (!z.isCurrent) continue;
    if (input.clicked) {
      const dx = input.mouseX - z.cx, dy = input.mouseY - z.cy;
      if (dx * dx + dy * dy <= z.r * z.r) {
        state = STATES.ZONE_MAP;
      }
    }
  }
  if (input.keyPressed('Escape')) state = STATES.START_SCREEN;
}

function renderWorldMap() {
  // Loadout pick
  if (!rolesChosen) {
    renderer.drawTerrain(0);
    rolePickButtons = renderer.drawRolePickUI(train.crew, hoveredRoleBtn, garlicPlaced);
    renderer.flush();
    return;
  }

  // Normal world map
  renderer.drawWorldMap(getWorldMapZones(), selectedWorld, zoneNumber, input);
  renderer.flush();
}

// --- MAIN LOOP ---
function loop(timestamp) {
  const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
  lastTime = timestamp;
  renderer.clear();

  // F3 toggles debug hitboxes
  if (input.keyPressed('F3')) debugMode = !debugMode;

  // Space enters tactical pause from RUNNING
  if (state === STATES.RUNNING && input.keyPressed('Space')) {
    pauseAimMount = null;
    state = STATES.RUN_PAUSE;
    input.endFrame();
    renderRunPause();
    requestAnimationFrame(loop);
    return;
  }

  // Esc toggles pause (from running, setup, or levelup) — not from RUN_PAUSE (handled there)
  if (state !== STATES.PAUSED && state !== STATES.RUN_PAUSE && state !== STATES.GAMEOVER && state !== STATES.SHOP && state !== STATES.ZONE_MAP && state !== STATES.START_SCREEN && state !== STATES.WORLD_SELECT && state !== STATES.WORLD_MAP && input.keyPressed('Escape')) {
    stateBeforePause = state;
    state = STATES.PAUSED;
    // Consume the frame so updatePaused doesn't see the same Esc
    input.endFrame();
    renderPaused();
    requestAnimationFrame(loop);
    return;
  }

  switch (state) {
    case STATES.START_SCREEN:  updateStartScreen();  renderStartScreen();  break;
    case STATES.WORLD_SELECT:  updateWorldSelect();  renderWorldSelect();  break;
    case STATES.WORLD_MAP:     updateWorldMap();     renderWorldMap();     break;
    case STATES.ZONE_MAP:      updateZoneMap();      renderZoneMap();      break;
    case STATES.SETUP:         updateSetup(dt);      renderSetup();        break;
    case STATES.RUNNING:       updateRun(dt);        renderRun();          break;
    case STATES.LEVELUP:       updateLevelUp();      renderLevelUp();      break;
    case STATES.PLACE_WEAPON:  updatePlaceWeapon();  renderPlaceWeapon();  break;
    case STATES.GAMEOVER:      updateGameOver();     renderGameOver();     break;
    case STATES.PAUSED:        updatePaused();       renderPaused();       break;
    case STATES.SHOP:          updateShop();         renderShop();         break;
    case STATES.SETTINGS:      updateSettings();     renderSettings();     break;
    case STATES.RUN_PAUSE:     updateRunPause();     renderRunPause();     break;
  }
  input.endFrame();
  requestAnimationFrame(loop);
}

// Initialize game data so train/zone exist, but start on the title screen
startNewWorld();
state = STATES.START_SCREEN;
requestAnimationFrame(loop);
