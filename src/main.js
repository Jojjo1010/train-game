import {
  CANVAS_WIDTH, CANVAS_HEIGHT, CAMERA_TRAIN_X,
  CAR_WIDTH, CAR_HEIGHT, CAR_GAP, TRAIN_SPEED,
  TARGET_DISTANCE, AUTO_WEAPONS, MAX_AUTO_WEAPON_LEVEL, MOUNT_RADIUS
} from './constants.js';
import { Train } from './train.js';
import { Renderer3D } from './renderer3d.js';
import { InputManager } from './input.js';
import { Spawner } from './enemies.js';
import { CombatSystem } from './combat.js';
import { CoinSystem } from './coins.js';
import { Zone, STATION_TYPES } from './zone.js';
import { playLevelUp, playPowerup, playVictory, playDefeat, startMusic, stopMusic } from './audio.js';

const STATES = { ZONE_MAP: 0, SETUP: 1, RUNNING: 2, LEVELUP: 3, PLACE_WEAPON: 4, GAMEOVER: 5, PAUSED: 6, SHOP: 7 };

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
let train = new Train();
let zone = new Zone();
let lastTime = performance.now();
let won = false;

// Selection state
let selectedCrew = null; // currently selected crew member

const ROTATE_SPEED = 2.5; // radians/sec for keyboard rotation

let levelUpChoices = [];
let hoveredPowerup = -1;
let pendingWeaponId = null; // weapon waiting to be placed on a mount

// === PERSISTENT UPGRADES (tiered, VS-style) ===
const save = {
  gold: 0,
  upgrades: {
    might:     { level: 0, maxLevel: 5, cost: 40,  icon: '🗡', color: '#e74c3c', name: 'Might',      desc: '+10% weapon damage' },
    armor:     { level: 0, maxLevel: 5, cost: 35,  icon: '🛡', color: '#3498db', name: 'Armor',      desc: '-1 damage taken per hit' },
    fireRate:  { level: 0, maxLevel: 5, cost: 45,  icon: '⚡', color: '#f39c12', name: 'Fire Rate',  desc: '+8% attack speed' },
    maxHull:   { level: 0, maxLevel: 5, cost: 30,  icon: '❤', color: '#e74c3c', name: 'Max Hull',   desc: '+10 max HP' },
    greed:     { level: 0, maxLevel: 3, cost: 60,  icon: '💰', color: '#f5a623', name: 'Greed',      desc: '+20% gold from coins' },
    crewSlots: { level: 0, maxLevel: 2, cost: 100, icon: '👤', color: '#2ecc71', name: 'Crew Slots', desc: 'Unlock crew member' },
  },
};
const UPGRADE_KEYS = Object.keys(save.upgrades);
let hoveredShopItem = -1;

const trainTotalWidth = 4 * CAR_WIDTH + 3 * CAR_GAP;
// Center train in the pixel grid so toWorld() maps it near 3D origin
const trainScreenX = CANVAS_WIDTH / 2 - trainTotalWidth / 2;
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
  zone = new Zone(zoneNumber);
  state = STATES.ZONE_MAP;
}

function resetForCombat() {
  state = STATES.SETUP;
  train = new Train();
  train.combatDifficulty = combatDifficulty;
  spawner.reset();
  combat.reset();
  coinSystem.reset();
  won = false;
  selectedCrew = null;

  // Apply persistent tiered upgrades
  const u = save.upgrades;
  // Crew slots
  const crewCount = 1 + u.crewSlots.level;
  while (train.crew.length < crewCount) train.recruitCrew();
  // Might + fire rate multipliers (applied in combat via train.totalDamageMultiplier/totalCooldownMultiplier)
  train.mightMultiplier = 1 + u.might.level * 0.1;
  train.shopFireRateMult = 1 + u.fireRate.level * 0.08;
  // Armor
  train.armorReduction = u.armor.level;
  // Max Hull
  train.maxHp += u.maxHull.level * 10;
  train.hp = train.maxHp;
  // Greed
  train.greedMultiplier = 1 + u.greed.level * 0.2;

  // No starter auto-weapon — crew fires their own guns
}

function generateLevelUpCards(train) {
  const cards = [];

  // Weapon cards: new or upgrade
  for (const [id, def] of Object.entries(AUTO_WEAPONS)) {
    if (!train.hasAutoWeapon(id) && train.hasEmptyMount) {
      const wid = id; // capture for closure
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

  // === DEFENCE CARDS ===
  if (train.passives.shield < 5) {
    const lv = train.passives.shield + 1;
    cards.push({ type: 'defence', name: `Shield Lv${lv}`, icon: '🛡', color: '#3498db',
      desc: `-2 damage per hit (total: -${lv * 2})`,
      apply(t) { t.passives.shield++; } });
  }
  if (train.passives.maxHp < 5) {
    const lv = train.passives.maxHp + 1;
    cards.push({ type: 'defence', name: `Max HP Lv${lv}`, icon: '❤', color: '#e74c3c',
      desc: `+15 max hull (total: +${lv * 15})`,
      apply(t) { t.passives.maxHp++; t.maxHp += 15; t.hp = Math.min(t.hp + 15, t.maxHp); } });
  }
  // Repair is always available (repeatable, no levels)
  cards.push({ type: 'defence', name: 'Repair', icon: '🔧', color: '#1abc9c',
    desc: 'Restore 30 hull points',
    apply(t) { t.hp = Math.min(t.hp + 30, t.maxHp); } });

  // === MODIFIER CARDS ===
  if (train.passives.coolOff < 5) {
    const lv = train.passives.coolOff + 1;
    cards.push({ type: 'modifier', name: `Cool-off Lv${lv}`, icon: '❄', color: '#00bcd4',
      desc: `-10% cooldown (total: -${lv * 10}%)`,
      apply(t) { t.passives.coolOff++; } });
  }
  if (train.passives.baseArea < 5) {
    const lv = train.passives.baseArea + 1;
    cards.push({ type: 'modifier', name: `Base Area Lv${lv}`, icon: '🎯', color: '#9b59b6',
      desc: `+15% weapon range (total: +${lv * 15}%)`,
      apply(t) { t.passives.baseArea++; } });
  }
  if (train.passives.damage < 5) {
    const lv = train.passives.damage + 1;
    cards.push({ type: 'modifier', name: `Damage Lv${lv}`, icon: '💥', color: '#ff5722',
      desc: `+15% weapon damage (total: +${lv * 15}%)`,
      apply(t) { t.passives.damage++; } });
  }

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
      startMusic();
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
  renderer.drawWeaponMounts(train, getSelectedMount());
  renderer.drawCrewPanel(train.crew, crewPanelY);
  renderer.drawSetupOverlay();
  const crewReady = train.crew.some(c => c.assignment && !c.assignment.isDriverSeat);
  renderer.drawDepartButton(departBtn.x, departBtn.y, departBtn.w, departBtn.h,
    crewReady && input.hitRect(departBtn.x, departBtn.y, departBtn.w, departBtn.h), !crewReady);
  if (selectedCrew) renderer.drawSelectedIndicator(selectedCrew);
  renderer.flush();
}

// --- RUN PHASE ---
function updateRun(dt) {
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
  renderer.flush();
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
  renderer.drawWeaponMounts(train, null);
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
  stopMusic();
  if (won) playVictory(); else playDefeat();
}

const gameOverBtns = {
  continue: { x: CANVAS_WIDTH / 2 - 70, y: CANVAS_HEIGHT / 2 + 70, w: 140, h: 44 },
};

function updateGameOver() {
  const confirmKey = input.keyPressed('Space') || input.keyPressed('Enter');
  if (confirmKey) {
    state = STATES.ZONE_MAP;
    return;
  }
  if (input.clicked) {
    const btn = gameOverBtns.continue;
    if (input.hitRect(btn.x, btn.y, btn.w, btn.h)) {
      state = STATES.ZONE_MAP;
      return;
    }
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
    if (kbShopOnDepart && confirmKey) { state = STATES.ZONE_MAP; return; }

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
      state = STATES.ZONE_MAP;
    }
  }

  if (input.keyPressed('Escape')) { state = STATES.ZONE_MAP; }
}

function renderShop() {
  renderer.drawTerrain(0);
  renderer.drawShop(save, UPGRADE_KEYS, hoveredShopItem, departBtn, input, kbShopOnDepart);
  renderer.flush();
}

// --- PAUSED ---
let kbPauseIndex = 0;
const pauseKeys = ['resume', 'restart', 'quit'];

function updatePaused() {
  if (input.keyPressed('Escape')) {
    state = stateBeforePause;
    lastTime = performance.now();
    return;
  }

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
    resetForCombat();
  } else if (clickedBtn('quit') || (confirmKey && kbPauseIndex === 2)) {
    state = STATES.ZONE_MAP;
    stopMusic();
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
  renderer.flush();
}

// --- ZONE MAP ---
let kbZoneIndex = -1; // keyboard-selected reachable station index

function getReachableStations() {
  return zone.stations.filter(s => zone.canTravelTo(s.id));
}

function updateZoneMap() {
  renderer.setZoneGold(save.gold);

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

  // Shop button (top-right area)
  const shopBtn = { x: CANVAS_WIDTH - 110, y: 44, w: 90, h: 30 };
  if (input.clicked && input.hitRect(shopBtn.x, shopBtn.y, shopBtn.w, shopBtn.h)) {
    state = STATES.SHOP;
    hoveredShopItem = -1;
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
    trade: '🏪 TRADING POST',
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
        combatDifficulty = zoneNumber;
        resetForCombat();
        break;
      case STATION_TYPES.TRADE:
        state = STATES.SHOP;
        hoveredShopItem = -1;
        break;
      case STATION_TYPES.EXIT:
        save.gold += 50;
        newZone();
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
  }
  input.endFrame();
  requestAnimationFrame(loop);
}

train.updateWorldPositions(trainScreenX, trainScreenY);
requestAnimationFrame(loop);
