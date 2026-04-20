import {
  CANVAS_WIDTH, CANVAS_HEIGHT, CAMERA_TRAIN_X,
  CAR_WIDTH, CAR_HEIGHT, CAR_GAP, TRAIN_SPEED,
  TARGET_DISTANCE, AUTO_WEAPONS, MAX_AUTO_WEAPON_LEVEL, MOUNT_RADIUS,
  ZONES_PER_WORLD, ZONE_DIFFICULTY_SCALE, GOLD_PER_STATION, COAL_PER_WIN, SHOP_TUNING
} from './constants.js';
import { Train } from './train.js';
import { Renderer3D } from './renderer3d.js';
import { InputManager } from './input.js';
import { Spawner } from './enemies.js';
import { CombatSystem } from './combat.js';
import { CoinSystem } from './coins.js';
import { Zone, STATION_TYPES } from './zone.js';
import { playLevelUp, playPowerup, playVictory, playDefeat, startMusic, stopMusic, getMusicVolume, getSfxVolume, setMusicVolume, setSfxVolume } from './audio.js';

const STATES = { ZONE_MAP: 0, SETUP: 1, RUNNING: 2, LEVELUP: 3, PLACE_WEAPON: 4, GAMEOVER: 5, PAUSED: 6, SHOP: 7, SETTINGS: 8 };

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

let state = STATES.ZONE_MAP;
let train = null;
let zone = null;
let lastTime = performance.now();
let won = false;
let debugMode = false;

// Selection state
let selectedCrew = null; // currently selected crew member

const ROTATE_SPEED = 2.5; // radians/sec for keyboard rotation

let levelUpChoices = [];
let hoveredPowerup = -1;
let pendingWeaponId = null; // weapon waiting to be placed on a mount

// === PERSISTENT UPGRADES (shop, kept across worlds — costs/levels from tuner) ===
const ST = SHOP_TUNING;
const save = {
  gold: 0,
  upgrades: {
    damage:    { level: 0, maxLevel: ST.damage.maxLevel,   cost: ST.damage.cost,    icon: '💥', color: '#ff5722', name: 'Damage',     desc: `+${ST.damage.perLevel}% weapon damage` },
    shield:    { level: 0, maxLevel: ST.shield.maxLevel,   cost: ST.shield.cost,    icon: '🛡', color: '#3498db', name: 'Shield',     desc: `-${ST.shield.perLevel} damage per hit` },
    coolOff:   { level: 0, maxLevel: ST.coolOff.maxLevel,  cost: ST.coolOff.cost,   icon: '❄', color: '#00bcd4', name: 'Cool-off',   desc: `-${ST.coolOff.perLevel}% cooldown` },
    maxHp:     { level: 0, maxLevel: ST.maxHp.maxLevel,    cost: ST.maxHp.cost,     icon: '❤', color: '#e74c3c', name: 'Max Hull',   desc: `+${ST.maxHp.perLevel} max HP` },
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

let stateBeforePause = STATES.SETUP; // remember where we came from
const pauseButtons = {
  resume:  { x: CANVAS_WIDTH / 2 - 100, y: 260, w: 200, h: 50 },
  restart: { x: CANVAS_WIDTH / 2 - 100, y: 330, w: 200, h: 50 },
  quit:    { x: CANVAS_WIDTH / 2 - 100, y: 400, w: 200, h: 50 },
};

let zoneNumber = 1;
let combatDifficulty = 1;

function newZone() {
  zoneNumber++;
  if (zoneNumber > ZONES_PER_WORLD) {
    // World complete!
    won = true;
    goldEarned = 0;
    state = STATES.GAMEOVER;
    playVictory();
    return;
  }
  zone = new Zone(zoneNumber);
  state = STATES.ZONE_MAP;
}

function leaveShop() {
  if (zone.completed) {
    newZone();
  } else {
    state = STATES.ZONE_MAP;
  }
}

// Full world reset — new train with shop upgrades applied
function startNewWorld() {
  zoneNumber = 1;
  zone = new Zone(zoneNumber);
  combatDifficulty = 1;
  train = new Train();
  selectedCrew = null;

  // Apply persistent shop upgrades to fresh train
  const u = save.upgrades;
  const crewCount = 1 + u.crewSlots.level;
  while (train.crew.length < crewCount) train.recruitCrew();
  // Passives from shop (tuned per-level values)
  train.passives.damage = u.damage.level;
  train.passives.shield = u.shield.level;
  train.passives.coolOff = u.coolOff.level;
  train.passives.baseArea = u.baseArea.level;
  train.passives.maxHp = u.maxHp.level;
  train.maxHp += u.maxHp.level * ST.maxHp.perLevel;
  train.hp = train.maxHp;
  train.greedMultiplier = 1 + u.greed.level * (ST.greed.perLevel / 100);
}

// Prepare for a combat station — keep train, reset enemies
function prepareForCombat() {
  state = STATES.SETUP;
  train.combatDifficulty = combatDifficulty;
  train.distance = 0;
  train.runGold = 0;
  train.damageFlash = 0;
  train.shakeTimer = 0;
  spawner.reset();
  combat.reset();
  coinSystem.reset();
  won = false;
}

function generateLevelUpCards(train) {
  const cards = [];

  // Weapon cards: new or upgrade (only in-run upgrades now)
  for (const [id, def] of Object.entries(AUTO_WEAPONS)) {
    if (!train.hasAutoWeapon(id) && train.hasEmptyMount) {
      const wid = id;
      cards.push({
        type: 'newWeapon', weaponId: wid,
        name: `${def.name} — New!`, icon: def.icon, color: def.color,
        desc: `${def.desc} (pick a slot)`,
        apply(t) { pendingWeaponId = wid; },
      });
    } else if (train.autoWeaponLevel(id) < MAX_AUTO_WEAPON_LEVEL) {
      const nextLv = train.autoWeaponLevel(id) + 1;
      cards.push({
        type: 'upgradeWeapon', weaponId: id,
        name: `${def.name} Lv${nextLv}`, icon: def.icon, color: def.color,
        desc: def.desc,
        apply(t) { t.upgradeAutoWeapon(id); },
      });
    }
  }

  // Repair is always available
  cards.push({ type: 'defence', name: 'Repair', icon: '🔧', color: '#1abc9c',
    desc: 'Restore 30 hull points',
    apply(t) { t.hp = Math.min(t.hp + 30, t.maxHp); } });

  // Shuffle and pick 3
  const shuffled = cards.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 3);
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
    // Snap toward up
    mount.coneDirection = -Math.PI / 2;
    return;
  }
  if (input.keyDown('KeyS') || input.keyDown('ArrowDown')) {
    mount.coneDirection = Math.PI / 2;
    return;
  }

  if (rotate !== 0) {
    mount.coneDirection += rotate;
    // Normalize
    while (mount.coneDirection > Math.PI) mount.coneDirection -= Math.PI * 2;
    while (mount.coneDirection < -Math.PI) mount.coneDirection += Math.PI * 2;
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

// --- SETUP PHASE ---
function updateSetup(dt) {
  handleKeyboardRotation(dt);

  if (input.clicked) {
    // Depart button — only if at least one crew is placed on a weapon
    const crewPlaced = train.crew.some(c => c.assignment && !c.assignment.isDriverSeat);
    if (crewPlaced && input.hitRect(departBtn.x, departBtn.y, departBtn.w, departBtn.h)) {
      state = STATES.RUNNING;
      lastTime = performance.now();
      selectedCrew = null;
      return;
    }

    // Check if clicking on a crew member
    const clickedCrew = findCrewAtMouse();
    if (clickedCrew) {
      if (clickedCrew === selectedCrew) {
        // Clicking selected crew again: deselect
        selectedCrew = null;
      } else {
        // Select this crew
        selectedCrew = clickedCrew;
      }
      return;
    }

    // If crew is selected and we click a slot: move them there
    if (selectedCrew) {
      const slot = findSlotAtMouse();
      if (slot) {
        if (slot.autoWeaponId) return;
        train.assignCrew(selectedCrew, slot);
        return;
      }
      selectedCrew = null;
      return;
    }
  }

  // Mouse aim: if crew is selected and on a mount, holding mouse rotates toward cursor
  if (selectedCrew && input.mouseDown && !input.clicked) {
    const mount = getSelectedMount();
    if (mount) {
      mount.coneDirection = Math.atan2(
        input.mouseY - mount.worldY,
        input.mouseX - mount.worldX
      );
    }
  }
}

function renderSetup() {
  train.updateWorldPositions(trainScreenX, trainScreenY);
  renderer.drawTerrain(0);
  renderer.drawTrain(train);
  renderer.drawWeaponMounts(train, getSelectedMount(), true);
  renderer.drawCrewPanel(train.crew, crewPanelY);
  renderer.drawSetupOverlay();
  const crewReady = train.crew.some(c => c.assignment && !c.assignment.isDriverSeat);
  renderer.drawDepartButton(departBtn.x, departBtn.y, departBtn.w, departBtn.h,
    crewReady && input.hitRect(departBtn.x, departBtn.y, departBtn.w, departBtn.h), !crewReady);
  if (selectedCrew) renderer.drawSelectedIndicator(selectedCrew);
  renderer.flush();
}

// --- RUN PHASE ---
const debugBtnRun = { x: CANVAS_WIDTH - 70, y: CANVAS_HEIGHT - 80, w: 60, h: 26 };

function updateRun(dt) {
  // Debug toggle button
  if (input.clicked && input.hitRect(debugBtnRun.x, debugBtnRun.y, debugBtnRun.w, debugBtnRun.h)) {
    debugMode = !debugMode;
  }

  train.distance += TRAIN_SPEED * dt;
  if (train.distance >= TARGET_DISTANCE) { won = true; enterGameOver(); return; }
  if (train.hp <= 0) { train.hp = 0; won = false; enterGameOver(); return; }

  for (const c of train.crew) if (c.reassignCooldown > 0) c.reassignCooldown -= dt;

  train.updateCrewMovement(dt);

  // Screen-space crew walk animation (3D mode)
  const CREW_WALK_SPEED = 250; // pixels/sec in screen space
  for (const c of train.crew) {
    if (!c.isMoving || c.moveScreenX === undefined) continue;
    const dx = c.moveTargetX - c.moveScreenX;
    const dy = c.moveTargetY - c.moveScreenY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 3) {
      // Arrived
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
  handleKeyboardRotation(dt);

  if (input.clicked) {
    // Click on crew to select
    const clickedCrew = findCrewAtMouse();
    if (clickedCrew) {
      selectedCrew = clickedCrew === selectedCrew ? null : clickedCrew;
      return;
    }

    // If crew selected, click slot to send them there
    if (selectedCrew && !selectedCrew.isMoving) {
      const slot = findSlotAtMouse();
      if (slot) {
        // Can't move to a slot with an auto-weapon
        if (slot.autoWeaponId) return;
        // Animated walk: unassign, set up screen-space movement, assign on arrival
        const fromSlot = selectedCrew.assignment;
        if (fromSlot) {
          const fromSX = slotScreenX(fromSlot);
          const fromSY = slotScreenY(fromSlot);
          const toSX = slotScreenX(slot);
          const toSY = slotScreenY(slot);
          train.unassignCrew(selectedCrew);
          selectedCrew.isMoving = true;
          selectedCrew.moveScreenX = fromSX;
          selectedCrew.moveScreenY = fromSY;
          selectedCrew.moveTargetX = toSX;
          selectedCrew.moveTargetY = toSY;
          selectedCrew.moveTargetSlot = slot;
        } else {
          // From panel — instant
          train.assignCrew(selectedCrew, slot);
        }
        return;
      }

      // Click empty space: deselect
      selectedCrew = null;
      return;
    }
  }

  // Mouse aim: hold mouse to rotate selected crew's weapon
  if (selectedCrew && input.mouseDown && !input.clicked) {
    const mount = getSelectedMount();
    if (mount) {
      mount.coneDirection = Math.atan2(
        input.mouseY - mount.worldY,
        input.mouseX - mount.worldX
      );
    }
  }

  // Enemies
  const carBounds = {
    rearWeapon:  { x: train.cars[0].worldX, y: train.cars[0].worldY, w: CAR_WIDTH, h: CAR_HEIGHT },
    cargo:       { x: train.cars[1].worldX, y: train.cars[1].worldY, w: CAR_WIDTH, h: CAR_HEIGHT },
    frontWeapon: { x: train.cars[2].worldX, y: train.cars[2].worldY, w: CAR_WIDTH, h: CAR_HEIGHT },
  };
  spawner.update(dt, train.distance, carBounds, train.combatDifficulty || 1);
  for (const e of spawner.pool) e.update(dt);
  combat.update(dt, train, spawner.pool);

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
    levelUpChoices = generateLevelUpCards(train);
    state = STATES.LEVELUP;
    kbPowerupIndex = 0;
    hoveredPowerup = 0;
    playLevelUp();
    renderer.spawnConfetti();
  }
}

function renderRun() {
  train.updateWorldPositions(trainScreenX, trainScreenY);
  renderer.applyShake(train, 0.016);
  renderer.drawTerrain(train.distance);
  renderer.drawSteamBlastAura(train);
  renderer.drawWorldCoins(coinSystem.coins);
  renderer.drawEnemies(spawner.pool);
  renderer.drawDamageNumbers(combat.damageNumbers);
  renderer.drawProjectiles(combat.projectiles);
  renderer.drawRicochetBolts(combat.ricochetBolts);
  renderer.drawTrain(train);
  renderer.drawWeaponMounts(train, getSelectedMount());
  renderer.drawMovingCrew(train.crew);
  renderer.drawFlyingCoins(coinSystem.flyingCoins);
  renderer.drawDamageFlash(train);
  renderer.drawHUD(train);
  renderer.drawAutoWeaponHUD(train);
  if (selectedCrew) renderer.drawSelectedIndicator(selectedCrew);
  if (debugMode) drawDebugHitboxes();
  // Debug toggle button
  const dctx = renderer.ctx;
  const dbHover = input.hitRect(debugBtnRun.x, debugBtnRun.y, debugBtnRun.w, debugBtnRun.h);
  dctx.fillStyle = debugMode ? 'rgba(40,90,30,0.7)' : (dbHover ? 'rgba(80,80,80,0.7)' : 'rgba(40,40,40,0.5)');
  dctx.beginPath();
  renderer.roundRect(debugBtnRun.x, debugBtnRun.y, debugBtnRun.w, debugBtnRun.h, 4);
  dctx.fill();
  dctx.fillStyle = debugMode ? '#4f4' : '#888';
  dctx.font = '10px monospace';
  dctx.textAlign = 'center';
  dctx.fillText('DEBUG', debugBtnRun.x + debugBtnRun.w / 2, debugBtnRun.y + 15);
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

    // Firing cone (for crew weapons)
    if (mount.isManned) {
      const dir = mount.coneDirection;
      const half = mount.coneHalfAngle;
      ctx.fillStyle = 'rgba(0,255,255,0.1)';
      ctx.beginPath();
      ctx.moveTo(center.x, center.y);
      ctx.arc(center.x, center.y, screenRange, dir - half, dir + half);
      ctx.closePath();
      ctx.fill();
    }
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

function updateLevelUp() {
  // Mouse hover
  let mouseHover = -1;
  for (let i = 0; i < levelUpChoices.length; i++) {
    const p = levelUpChoices[i];
    if (p._x !== undefined && input.hitRect(p._x, p._y, p._w, p._h)) mouseHover = i;
  }
  if (mouseHover >= 0) hoveredPowerup = mouseHover;

  // Keyboard navigation
  if (input.keyPressed('ArrowRight') || input.keyPressed('KeyD')) {
    kbPowerupIndex = Math.min(levelUpChoices.length - 1, kbPowerupIndex + 1);
    hoveredPowerup = kbPowerupIndex;
  }
  if (input.keyPressed('ArrowLeft') || input.keyPressed('KeyA')) {
    kbPowerupIndex = Math.max(0, kbPowerupIndex - 1);
    hoveredPowerup = kbPowerupIndex;
  }

  // Select with click or space/enter
  const confirmKey = input.keyPressed('Space') || input.keyPressed('Enter');
  if ((input.clicked && mouseHover >= 0) || (confirmKey && hoveredPowerup >= 0)) {
    pendingWeaponId = null;
    levelUpChoices[hoveredPowerup].apply(train);
    playPowerup();
    if (pendingWeaponId) {
      // New weapon acquired — go to placement screen
      state = STATES.PLACE_WEAPON;
    } else {
      state = STATES.RUNNING;
      lastTime = performance.now();
    }
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
  renderer.drawLevelUpMenu(train.level, levelUpChoices, hoveredPowerup);
  renderer.updateAndDrawConfetti(0.016);
  renderer.flush();
}

// --- PLACE WEAPON ---
function updatePlaceWeapon() {
  if (!pendingWeaponId) { state = STATES.RUNNING; lastTime = performance.now(); return; }

  if (input.clicked) {
    // Find which empty mount was clicked
    for (const mount of train.allMounts) {
      if (mount.isOccupied) continue;
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

  // Highlight empty mounts
  const ctx = renderer.ctx;
  const def = pendingWeaponId ? AUTO_WEAPONS[pendingWeaponId] : null;
  for (const mount of train.allMounts) {
    if (mount.isOccupied) continue;
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
function enterGameOver() {
  // Gold calculation
  // Cargo multiplier: 1.0 + (boxes * 0.25), so 4 boxes = 2.0x
  const cargoMultiplier = train.cargoMultiplier;
  if (won) {
    // Win: multiply collected gold by cargo
    goldEarned = Math.floor(train.runGold * cargoMultiplier);
  } else {
    // Lose: just get the gold you shot (no multiplier)
    goldEarned = train.runGold;
  }
  save.gold += goldEarned;
  state = STATES.GAMEOVER;
  if (won) playVictory(); else playDefeat();
}

const gameOverBtns = {
  continue: { x: CANVAS_WIDTH / 2 - 70, y: CANVAS_HEIGHT / 2 + 70, w: 140, h: 44 },
};

function updateGameOver() {
  const confirmKey = input.keyPressed('Space') || input.keyPressed('Enter');
  if (confirmKey) {
    afterGameOver();
    return;
  }
  if (input.clicked) {
    const btn = gameOverBtns.continue;
    if (input.hitRect(btn.x, btn.y, btn.w, btn.h)) {
      afterGameOver();
      return;
    }
  }
}

function afterGameOver() {
  if (won) {
    // Won the combat — refuel and continue
    zone.addCoal(COAL_PER_WIN);
    state = STATES.ZONE_MAP;
  } else {
    // Died — restart entire world (zone 1, fresh train, keep shop upgrades)
    startNewWorld();
    state = STATES.ZONE_MAP;
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
  renderer.drawGameOver(won, train, goldEarned, gameOverBtns, input);
  renderer.flush();
}

// --- SHOP (tiered upgrades) ---
let kbShopIndex = 0;
let kbShopOnDepart = false;

function updateShop() {
  // Mouse hover on upgrade rows
  let mouseHover = -1;
  for (let i = 0; i < UPGRADE_KEYS.length; i++) {
    const key = UPGRADE_KEYS[i];
    const u = save.upgrades[key];
    if (u._y !== undefined && input.hitRect(60, u._y, CANVAS_WIDTH - 120, 36)) {
      mouseHover = i;
    }
  }
  if (mouseHover >= 0) {
    hoveredShopItem = mouseHover;
    kbShopOnDepart = false;
  }

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

  if (input.clicked || confirmKey) {
    if (kbShopOnDepart && confirmKey) { leaveShop(); return; }

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
    if (input.clicked && input.hitRect(departBtn.x, departBtn.y, departBtn.w, departBtn.h)) {
      leaveShop();
    }
  }

  if (input.keyPressed('Escape')) { leaveShop(); }
}

function renderShop() {
  renderer.drawTerrain(0);
  renderer.drawShop(save, UPGRADE_KEYS, hoveredShopItem, departBtn, input, kbShopOnDepart);
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
  if (input.keyPressed('Escape')) {
    state = STATES.ZONE_MAP;
    activeSliderDrag = null;
    return;
  }

  if (input.clicked && input.hitRect(settingsDebugBtn.x, settingsDebugBtn.y, settingsDebugBtn.w, settingsDebugBtn.h)) {
    debugMode = !debugMode;
  }

  if (input.clicked && input.hitRect(settingsBackBtn.x, settingsBackBtn.y, settingsBackBtn.w, settingsBackBtn.h)) {
    state = STATES.ZONE_MAP;
    activeSliderDrag = null;
    return;
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

  // Start music on first interaction
  if (!musicStarted && input.clicked) {
    startMusic();
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
  const typeLabels = {
    combat: '⚔ BANDITS AHEAD! ⚔',
    empty: '— Quiet Stop —',
    start: '',
    exit: '★ ZONE COMPLETE! ★',
  };

  if (station.type === STATION_TYPES.START) return;

  stationArrival = {
    type: station.type,
    label: typeLabels[station.type] || '',
    timer: station.type === STATION_TYPES.EMPTY ? 1.0 : 1.5,
    station,
    acted: false,
  };
}

function updateStationArrival(dt) {
  if (!stationArrival) return false;
  stationArrival.timer -= dt;

  if (stationArrival.timer <= 0 && !stationArrival.acted) {
    stationArrival.acted = true;
    const s = stationArrival.station;
    switch (s.type) {
      case STATION_TYPES.COMBAT:
        combatDifficulty = 1 + (zoneNumber - 1) * ZONE_DIFFICULTY_SCALE;
        prepareForCombat();
        break;
      case STATION_TYPES.EXIT:
        save.gold += zone.stationsVisited * GOLD_PER_STATION;
        state = STATES.SHOP;
        hoveredShopItem = -1;
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

// --- MAIN LOOP ---
function loop(timestamp) {
  const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
  lastTime = timestamp;
  renderer.clear();

  // F3 toggles debug hitboxes
  if (input.keyPressed('F3')) debugMode = !debugMode;

  // Esc toggles pause (from running, setup, or levelup)
  if (state !== STATES.PAUSED && state !== STATES.GAMEOVER && state !== STATES.SHOP && state !== STATES.ZONE_MAP && input.keyPressed('Escape')) {
    stateBeforePause = state;
    state = STATES.PAUSED;
    // Consume the frame so updatePaused doesn't see the same Esc
    input.endFrame();
    renderPaused();
    requestAnimationFrame(loop);
    return;
  }

  switch (state) {
    case STATES.ZONE_MAP: updateZoneMap();  renderZoneMap();  break;
    case STATES.SETUP:   updateSetup(dt);  renderSetup();    break;
    case STATES.RUNNING: updateRun(dt);    renderRun();      break;
    case STATES.LEVELUP: updateLevelUp();  renderLevelUp();  break;
    case STATES.PLACE_WEAPON: updatePlaceWeapon(); renderPlaceWeapon(); break;
    case STATES.GAMEOVER: updateGameOver(); renderGameOver(); break;
    case STATES.PAUSED:  updatePaused();   renderPaused();   break;
    case STATES.SHOP:    updateShop();     renderShop();     break;
    case STATES.SETTINGS: updateSettings(); renderSettings(); break;
  }
  input.endFrame();
  requestAnimationFrame(loop);
}

startNewWorld();
train.updateWorldPositions(trainScreenX, trainScreenY);
requestAnimationFrame(loop);
