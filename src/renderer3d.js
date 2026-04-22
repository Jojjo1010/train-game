import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { toWorld, toWorldX, toWorldZ, toPixelX, toPixelZ } from './coordMap.js';

// === DEBUG MOUNT TUNING ===
// Press F4 to toggle debug panel. Use keys to adjust:
//   Q/W: upper cone angle ±5°    E/R: lower cone angle ±5°
//   A/S: gun rotation offset ±5° D/F: cone half-angle ±5°
window.__mountDebug = window.__mountDebug || {
  enabled: false,
  upperConeAngle: -125,  // screen-space cone center (degrees)
  lowerConeAngle: 55,    // screen-space cone center (degrees)
  upperGunRot: 161,      // direct rotation.y for upper gun (degrees) — -19 + 180
  lowerGunRot: -15,      // direct rotation.y for lower gun (degrees)
  coneHalf: 90,          // half of total cone (degrees)
  upperMouseScale: -1,   // multiplier for upper mouse delta → rotation.y
  lowerMouseScale: -1,   // multiplier for lower mouse delta → rotation.y
};
const MD = window.__mountDebug;
document.addEventListener('keydown', (e) => {
  if (e.code === 'F4') { MD.enabled = !MD.enabled; e.preventDefault(); return; }
  if (!MD.enabled) return;
  // Use number keys (no conflict with game controls)
  const step = e.shiftKey ? 1 : 5;
  let handled = true;
  switch (e.code) {
    case 'Digit1': MD.upperConeAngle -= step; break;
    case 'Digit2': MD.upperConeAngle += step; break;
    case 'Digit3': MD.lowerConeAngle -= step; break;
    case 'Digit4': MD.lowerConeAngle += step; break;
    case 'Digit5': MD.upperGunRot -= step; break;
    case 'Digit6': MD.upperGunRot += step; break;
    case 'Digit7': MD.lowerGunRot -= step; break;
    case 'Digit8': MD.lowerGunRot += step; break;
    case 'Digit9': MD.coneHalf -= step; break;
    case 'Digit0': MD.coneHalf += step; break;
    default: handled = false;
  }
  if (handled) e.preventDefault();
});
import {
  CANVAS_WIDTH, CANVAS_HEIGHT, MOUNT_RADIUS, CREW_RADIUS,
  WEAPON_RANGE, TARGET_DISTANCE, COIN_RADIUS,
  AUTO_WEAPONS, MANUAL_GUN, COAL_SHOP_COST, COAL_SHOP_AMOUNT,
  MAX_ENEMIES, MAX_PROJECTILES, MAX_RICOCHET_BOLTS,
  MAX_COINS, MAX_FLYING_COINS, MAX_BANDITS
} from './constants.js';

// Role-based crew emoji: visually distinct per role
function crewEmoji(crew) {
  if (!crew) return '\uD83D\uDC31'; // default cat
  if (crew.role === 'Gunner')  return '\uD83D\uDC31'; // 🐱 cat
  if (crew.role === 'Brawler') return '\u26C4\uFE0F'; // ⛄️ snowman
  return '\uD83D\uDC31'; // 🐱 default
}

export class Renderer3D {
  constructor(threeCanvas, overlayCtx) {
    this.ctx = overlayCtx;

    // Gold counter animation state
    this._displayedGold = 0;
    this._goldFlashTimer = 0;    // seconds remaining for color flash
    this._goldFlashColor = null; // '#4f4' for gain, '#f44' for loss

    // --- Three.js renderer ---
    this.threeRenderer = new THREE.WebGLRenderer({ canvas: threeCanvas, antialias: true });
    this.threeRenderer.setSize(window.innerWidth, window.innerHeight);
    this.threeRenderer.setPixelRatio(window.devicePixelRatio);
    window.addEventListener('resize', () => {
      this.threeRenderer.setSize(window.innerWidth, window.innerHeight);
      // Keep camera frustum matching UI canvas aspect (1.5) so projection stays aligned
      const aspect = CANVAS_WIDTH / CANVAS_HEIGHT;
      const fs = this.frustumSize;
      this.camera.left = -fs * aspect / 2;
      this.camera.right = fs * aspect / 2;
      this.camera.top = fs / 2;
      this.camera.bottom = -fs / 2;
      this.camera.updateProjectionMatrix();
    });

    // --- Scene ---
    this.scene = new THREE.Scene();
    this._projVec = new THREE.Vector3();
    this._unprojNear = new THREE.Vector3();
    this._unprojFar = new THREE.Vector3();
    this._unprojDir = new THREE.Vector3();
    this.scene.background = new THREE.Color(0x8a7a52);

    // --- Camera (isometric view matching Blender reference) ---
    // Camera frustum must match UI canvas aspect (960/640 = 1.5) for projection to align
    this.frustumSize = 300;
    const aspect = CANVAS_WIDTH / CANVAS_HEIGHT; // always 1.5
    this.camera = new THREE.OrthographicCamera(
      -this.frustumSize * aspect / 2, this.frustumSize * aspect / 2,
      this.frustumSize / 2, -this.frustumSize / 2,
      0.1, 2000
    );
    // Isometric view matching Blender reference:
    // Train runs diagonally bottom-left to top-right, locomotive top-right
    // Camera looks from front-left-above toward the train
    this.camera.position.set(-180, 220, 180);
    this.camera.lookAt(0, 0, 0);
    this.cameraBasePos = this.camera.position.clone();

    // --- Lights ---
    const ambient = new THREE.AmbientLight(0x404040);
    this.scene.add(ambient);

    const directional = new THREE.DirectionalLight(0xffffff, 0.8);
    directional.position.set(100, 200, 100);
    this.scene.add(directional);

    const hemi = new THREE.HemisphereLight(0xffffbb, 0x080820, 0.4);
    this.scene.add(hemi);

    // --- State ---
    this.shakeX = 0;
    this.shakeY = 0;
    this.confetti = [];
    this._zoneGold = 0;
    this._kbHighlightStation = -1;

    // --- Kill effect particles (pool of 50) ---
    this._killParticles = [];
    for (let i = 0; i < 50; i++) {
      this._killParticles.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 0, color: '#fff', radius: 2 });
    }
    // Kill effect expanding rings
    this._killRings = [];
    for (let i = 0; i < 20; i++) {
      this._killRings.push({ active: false, x: 0, y: 0, radius: 0, maxRadius: 0, life: 0, maxLife: 0, color: '#fff' });
    }
    // Kill effect white flash (small pool of 20)
    this._killFlashes = [];
    for (let i = 0; i < 20; i++) {
      this._killFlashes.push({ active: false, x: 0, y: 0, radius: 0, life: 0, maxLife: 0 });
    }

    // --- Muzzle flash pool (max 20) ---
    this._muzzleFlashes = [];
    for (let i = 0; i < 20; i++) {
      this._muzzleFlashes.push({ active: false, x: 0, y: 0, life: 0, maxLife: 0.08 });
    }

    // --- Hit spark pool (max 30) ---
    this._hitSparks = [];
    for (let i = 0; i < 30; i++) {
      this._hitSparks.push({ active: false, x: 0, y: 0, life: 0, maxLife: 0.12 });
    }

    // --- FBX Models ---
    this.models = {};
    this.modelsLoaded = false;
    this._loadAssets();

    // --- Ground plane ---
    const groundGeo = new THREE.PlaneGeometry(2000, 2000);
    const groundMat = new THREE.MeshLambertMaterial({ color: 0xb5a272 });
    this.ground = new THREE.Mesh(groundGeo, groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.5;
    this.scene.add(this.ground);

    // --- Rail track centered at origin, running along X axis ---
    const railGroup = new THREE.Group();
    const railMat = new THREE.MeshLambertMaterial({ color: 0x8b7355 });
    const rail1 = new THREE.Mesh(new THREE.BoxGeometry(2000, 1, 1.5), railMat);
    rail1.position.set(0, 0.3, -8);
    const rail2 = new THREE.Mesh(new THREE.BoxGeometry(2000, 1, 1.5), railMat);
    rail2.position.set(0, 0.3, 8);
    railGroup.add(rail1, rail2);

    const sleeperMat = new THREE.MeshLambertMaterial({ color: 0x6b5a3e });
    for (let i = -60; i <= 60; i++) {
      const sleeper = new THREE.Mesh(new THREE.BoxGeometry(3, 0.5, 24), sleeperMat);
      sleeper.position.set(i * 15, 0, 0);
      railGroup.add(sleeper);
    }
    this.railGroup = railGroup;
    this.scene.add(railGroup);

    // --- Object pools ---
    this._initPools();
  }

  // =============================================
  // ASSET LOADING
  // =============================================
  _loadAssets() {
    const loader = new FBXLoader();
    const assetNames = ['Train', 'Rail', 'enemy', 'Gun', 'AutoGun', 'Garlic', 'Laser'];
    let loaded = 0;

    const scaleOverrides = { AutoGun: 0.15, Laser: 0.15 };
    for (const name of assetNames) {
      loader.load(
        `assets/${name}.fbx`,
        (object) => {
          // Normalise scale — FBX files often come in huge
          object.scale.setScalar(scaleOverrides[name] || 0.05);
          this.models[name] = object;
          loaded++;
          if (loaded === assetNames.length) {
            this.modelsLoaded = true;
            this._populatePoolsWithModels();
          }
        },
        undefined,
        (err) => {
          console.warn(`Failed to load ${name}.fbx:`, err);
          loaded++;
          if (loaded === assetNames.length) {
            this.modelsLoaded = true;
            this._populatePoolsWithModels();
          }
        }
      );
    }
  }

  // =============================================
  // OBJECT POOLS
  // =============================================
  _initPools() {
    // Enemy pool — small cones matching the FBX blockout
    this.enemyPool = [];
    const enemyMat = new THREE.MeshLambertMaterial({ color: 0x2d6a2e });
    for (let i = 0; i < MAX_ENEMIES; i++) {
      const mesh = new THREE.Mesh(new THREE.ConeGeometry(3, 8, 8), enemyMat.clone());
      mesh.visible = false;
      mesh.position.y = 4;
      this.scene.add(mesh);
      this.enemyPool.push(mesh);
    }

    // Projectile pool
    this.projectilePool = [];
    const projMat = new THREE.MeshBasicMaterial({ color: 0xffeeaa });
    for (let i = 0; i < MAX_PROJECTILES; i++) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(2, 6, 6), projMat.clone());
      mesh.visible = false;
      mesh.position.y = 5;
      this.scene.add(mesh);
      this.projectilePool.push(mesh);
    }

    // Ricochet bolt pool (lines)
    this.ricochetPool = [];
    for (let i = 0; i < MAX_RICOCHET_BOLTS; i++) {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, 0)
      ]);
      const mat = new THREE.LineBasicMaterial({ color: 0xd4b8ff, linewidth: 2 });
      const line = new THREE.Line(geo, mat);
      line.visible = false;
      this.scene.add(line);
      this.ricochetPool.push(line);
    }

    // Coin pool
    this.coinPool = [];
    const coinMat = new THREE.MeshLambertMaterial({ color: 0xf5a623 });
    for (let i = 0; i < MAX_COINS; i++) {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(COIN_RADIUS * 0.6, COIN_RADIUS * 0.6, 2, 12), coinMat.clone());
      mesh.rotation.x = Math.PI / 2; // stand upright
      mesh.visible = false;
      mesh.position.y = COIN_RADIUS * 0.6;
      this.scene.add(mesh);
      this.coinPool.push(mesh);
    }

    // Flying coin pool
    this.flyingCoinPool = [];
    for (let i = 0; i < MAX_FLYING_COINS; i++) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(3, 8, 8), coinMat.clone());
      mesh.visible = false;
      mesh.position.y = 8;
      this.scene.add(mesh);
      this.flyingCoinPool.push(mesh);
    }

    // Bandit pool — bright red figure (body + head + arms)
    this.banditPool = [];
    const banditBodyMat = new THREE.MeshLambertMaterial({ color: 0xff2222 });
    const banditHeadMat = new THREE.MeshLambertMaterial({ color: 0xffccaa });
    for (let i = 0; i < MAX_BANDITS; i++) {
      const group = new THREE.Group();
      // Body (torso)
      const body = new THREE.Mesh(new THREE.BoxGeometry(12, 14, 10), banditBodyMat.clone());
      body.position.y = 7;
      group.add(body);
      // Head
      const head = new THREE.Mesh(new THREE.SphereGeometry(5, 8, 8), banditHeadMat.clone());
      head.position.y = 19;
      group.add(head);
      // Left arm
      const armL = new THREE.Mesh(new THREE.BoxGeometry(4, 12, 4), banditBodyMat.clone());
      armL.position.set(-8, 7, 0);
      group.add(armL);
      // Right arm
      const armR = new THREE.Mesh(new THREE.BoxGeometry(4, 12, 4), banditBodyMat.clone());
      armR.position.set(8, 7, 0);
      group.add(armR);
      group.visible = false;
      this.scene.add(group);
      this.banditPool.push(group);
    }

    // Train — single FBX model (contains all cars), centered at origin
    const placeholderTrain = new THREE.Mesh(
      new THREE.BoxGeometry(200, 15, 30),
      new THREE.MeshLambertMaterial({ color: 0x444444 })
    );
    placeholderTrain.position.y = 8;
    this.trainMesh = placeholderTrain;
    this._trainOrigRotY = 0;
    this.scene.add(placeholderTrain);

    // Fixed 3D mount positions ON the train (offsets from train center)
    // 8 weapon mounts: 4 on rear weapon car, 4 on front weapon car
    // Train layout (along X): rear weapon (-80) | cargo (-27) | front weapon (27) | locomotive (80)
    this.mountOffsets3D = [
      // Rear weapon car (4 mounts: corners)
      { x: -76, y: 16, z: -6 },   // rear top-left
      { x: -62, y: 16, z: -6 },   // rear top-right
      { x: -76, y: 16, z: 6 },    // rear bottom-left
      { x: -62, y: 16, z: 6 },    // rear bottom-right
      // Front weapon car (4 mounts: corners)
      { x: 10, y: 16, z: -6 },    // front top-left
      { x: 26, y: 16, z: -6 },    // front top-right
      { x: 10, y: 16, z: 6 },     // front bottom-left
      { x: 26, y: 16, z: 6 },     // front bottom-right
    ];
    // Driver seat on locomotive
    this.driverOffset3D = { x: 75, y: 16, z: 0 };

    // Mount meshes — one group per mount slot, model swapped based on state
    this.mountGroups = [];
    for (let i = 0; i < 12; i++) {
      const group = new THREE.Group();
      group.visible = false;
      group.position.y = 16;
      this.scene.add(group);
      this.mountGroups.push({ group, currentType: null }); // track what's shown
    }

    // Steam blast aura ring
    const ringGeo = new THREE.RingGeometry(38, 42, 48);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x8ecae6, transparent: true, opacity: 0.2, side: THREE.DoubleSide });
    this.steamRing = new THREE.Mesh(ringGeo, ringMat);
    this.steamRing.rotation.x = -Math.PI / 2;
    this.steamRing.position.y = 1;
    this.steamRing.visible = false;
    this.scene.add(this.steamRing);

    // Crew walking spheres
    this.crewMoveMeshes = [];
    const crewColors = [0xe74c3c, 0x3498db, 0x2ecc71];
    for (let i = 0; i < 3; i++) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(CREW_RADIUS * 0.4, 8, 8),
        new THREE.MeshLambertMaterial({ color: crewColors[i] })
      );
      mesh.visible = false;
      mesh.position.y = 10;
      this.scene.add(mesh);
      this.crewMoveMeshes.push(mesh);
    }
  }

  _populatePoolsWithModels() {
    // Replace placeholder enemy meshes with cloned FBX if available
    if (this.models.enemy) {
      for (let i = 0; i < this.enemyPool.length; i++) {
        const old = this.enemyPool[i];
        const clone = this.models.enemy.clone();
        clone.visible = false;
        clone.position.copy(old.position);
        clone.scale.setScalar(0.015); // much smaller base scale
        this.scene.remove(old);
        old.geometry?.dispose();
        this.scene.add(clone);
        this.enemyPool[i] = clone;
      }
    }

    // Replace train placeholder with Train.fbx (single model, all cars)
    if (this.models.Train) {
      const old = this.trainMesh;
      this.scene.remove(old);
      old.geometry?.dispose();
      const trainModel = this.models.Train.clone();
      trainModel.visible = true;
      this.trainMesh = trainModel;
      this._trainOrigRotY = trainModel.rotation.y;
      this.scene.add(trainModel);
    }

    // Mount models are now swapped dynamically in drawWeaponMounts
  }

  // =============================================
  // COORDINATE HELPER — project 3D pos to 2D overlay
  // =============================================
  _project(worldX, worldZ, worldY = 16) {
    const v = this._projVec.set(worldX, worldY, worldZ);
    v.project(this.camera);
    return {
      x: (v.x * 0.5 + 0.5) * CANVAS_WIDTH,
      y: (-v.y * 0.5 + 0.5) * CANVAS_HEIGHT,
    };
  }

  // Convert screen coords (canvas pixels) back to 2D game pixel coords
  // For orthographic camera: unproject two points to get a ray, intersect with Y=worldY plane
  screenToPixel(screenX, screenY, worldY = 0) {
    const ndcX = (screenX / CANVAS_WIDTH) * 2 - 1;
    const ndcY = -(screenY / CANVAS_HEIGHT) * 2 + 1;

    // Near and far points on the ray
    const near = this._unprojNear.set(ndcX, ndcY, -1);
    near.unproject(this.camera);
    const far = this._unprojFar.set(ndcX, ndcY, 1);
    far.unproject(this.camera);

    // Ray direction
    const dir = this._unprojDir.copy(far).sub(near);

    // Intersect with Y = worldY plane
    if (Math.abs(dir.y) < 0.0001) {
      // Ray parallel to plane — fallback
      return { x: near.x + CANVAS_WIDTH / 2, y: near.z + CANVAS_HEIGHT / 2 };
    }
    const t = (worldY - near.y) / dir.y;
    const hitX = near.x + dir.x * t;
    const hitZ = near.z + dir.z * t;

    return {
      x: hitX + CANVAS_WIDTH / 2,
      y: hitZ + CANVAS_HEIGHT / 2,
    };
  }

  // =============================================
  // CLEAR + FLUSH
  // =============================================
  clear() {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }

  flush() {
    this.threeRenderer.render(this.scene, this.camera);
  }

  // =============================================
  // GAME WORLD METHODS (3D)
  // =============================================

  applyShake(train, dt) {
    if (train.shakeTimer > 0) {
      train.shakeTimer -= dt;
      const intensityMult = train.shakeIntensity !== undefined ? train.shakeIntensity : 1.0;
      const intensity = train.shakeTimer * 30 * intensityMult;
      this.shakeX = (Math.random() - 0.5) * intensity;
      this.shakeY = (Math.random() - 0.5) * intensity;
      this.camera.position.copy(this.cameraBasePos);
      this.camera.position.x += this.shakeX;
      this.camera.position.y += this.shakeY * 0.5;
      this.ctx.setTransform(1, 0, 0, 1, this.shakeX, this.shakeY);
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
      this.camera.position.copy(this.cameraBasePos);
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    if (train.damageFlash > 0) train.damageFlash -= dt;
  }

  // =============================================
  // KILL EFFECTS
  // =============================================
  spawnKillEffect(x, y, color) {
    // Spawn expanding ring
    const ring = this._killRings.find(r => !r.active);
    if (ring) {
      ring.active = true;
      ring.x = x;
      ring.y = y;
      ring.radius = 4;
      ring.maxRadius = 40;
      ring.life = 0.25;
      ring.maxLife = 0.25;
      ring.color = color;
    }

    // Spawn 6 outward particles with randomized sizes
    for (let i = 0; i < 6; i++) {
      const p = this._killParticles.find(p => !p.active);
      if (!p) break;
      const angle = (i / 6) * Math.PI * 2 + (Math.random() - 0.5) * 0.8;
      const speed = 80 + Math.random() * 80;
      p.active = true;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.life = 0.3 + Math.random() * 0.15;
      p.maxLife = p.life;
      p.color = color;
      p.radius = 1 + Math.random() * 2; // 1–3px
    }

    // Spawn white flash
    const flash = this._killFlashes.find(f => !f.active);
    if (flash) {
      flash.active = true;
      flash.x = x;
      flash.y = y;
      flash.radius = 12;
      flash.life = 0.10;
      flash.maxLife = 0.10;
    }
  }

  updateAndDrawKillEffects(dt) {
    const ctx = this.ctx;

    // Update + draw white flashes (drawn first, behind particles)
    for (const f of this._killFlashes) {
      if (!f.active) continue;
      f.life -= dt;
      if (f.life <= 0) { f.active = false; continue; }
      const t = 1 - f.life / f.maxLife; // 0→1
      const radius = f.radius * (1 - t); // shrinks to 0
      const alpha = f.life / f.maxLife;
      ctx.beginPath();
      ctx.arc(f.x, f.y, Math.max(0, radius), 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = alpha;
      ctx.fill();
    }

    // Update + draw particles
    for (const p of this._killParticles) {
      if (!p.active) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.max(0, 1 - 8 * dt);
      p.vy *= Math.max(0, 1 - 8 * dt);
      p.life -= dt;
      if (p.life <= 0) { p.active = false; continue; }
      const alpha = p.life / p.maxLife;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius ?? 2, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = alpha;
      ctx.fill();
    }

    // Update + draw rings
    for (const r of this._killRings) {
      if (!r.active) continue;
      r.life -= dt;
      if (r.life <= 0) { r.active = false; continue; }
      const t = 1 - r.life / r.maxLife; // 0→1
      r.radius = 4 + (r.maxRadius - 4) * t;
      const alpha = (1 - t) * 0.8;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = alpha;
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  }

  drawTerrain(scrollOffset) {
    // Re-show rail and restore background after start screen
    this.railGroup.visible = true;
    if (this._savedBg) {
      this.scene.background = this._savedBg;
      this._savedBg = null;
    }
    // Scroll only by one sleeper spacing cycle so track never disappears
    const sleeperSpacing = 15;
    const offset = (scrollOffset * 0.5) % sleeperSpacing;
    this.railGroup.position.x = -offset;
  }

  drawTrain(train) {
    if (!this.trainMesh) return;
    // Train always at scene origin, restore original rotation from FBX
    this.trainMesh.position.set(0, 0, 0);
    if (this._trainOrigRotY !== undefined) {
      this.trainMesh.rotation.y = this._trainOrigRotY;
    }
    this.trainMesh.visible = true;

    // Project driver seat to screen coords
    for (const car of train.cars) {
      if (car.driverSeat) {
        const d = this.driverOffset3D;
        const ds = this._project(d.x, d.z);
        car.driverSeat.screenX = ds.x;
        car.driverSeat.screenY = ds.y;
        car.driverSeat.worldX = toPixelX(d.x);
        car.driverSeat.worldY = toPixelZ(d.z);
      }
    }
  }

  drawWeaponMounts(train, aimingMount, showEmptySlots = false) {
    const ctx = this.ctx;
    let mountIdx = 0;

    // Flatten all mounts to iterate alongside 3D offsets
    const allMounts = train.allMounts;

    for (let i = 0; i < allMounts.length; i++) {
      const mount = allMounts[i];
      const offset = this.mountOffsets3D[i];
      if (!offset) continue;

      // Show correct 3D model based on mount state
      if (mountIdx < this.mountGroups.length) {
        const entry = this.mountGroups[mountIdx];
        const group = entry.group;
        group.position.set(offset.x, offset.y, offset.z);
        // Direct rotation.y from tuned values
        const defaultRot = (offset.z < 0 ? MD.upperGunRot : MD.lowerGunRot) * Math.PI / 180;
        if (mount.screenAimAngle !== undefined) {
          // Mouse aim: compute delta from cone center in screen space, apply to 3D rotation
          const coneCenterRad = (offset.z < 0 ? MD.upperConeAngle : MD.lowerConeAngle) * Math.PI / 180;
          const aimDelta = mount.screenAimAngle - coneCenterRad;
          const mScale = offset.z < 0 ? MD.upperMouseScale : MD.lowerMouseScale;
          group.rotation.y = defaultRot + aimDelta * mScale;
        } else {
          group.rotation.y = defaultRot;
        }

        // Determine which model to show
        let desiredType = null;
        if (mount.hasAutoWeapon) {
          const modelMap = { turret: 'AutoGun', steamBlast: 'Laser', ricochetShot: 'Laser' };
          desiredType = modelMap[mount.autoWeaponId] || null;
        } else if (mount.isManned) {
          desiredType = 'Gun';
        }
        // Empty mount = no model

        // Swap model if type changed
        if (entry.currentType !== desiredType) {
          while (group.children.length) group.remove(group.children[0]);
          entry.currentType = desiredType;
          if (desiredType && this.models[desiredType]) {
            const clone = this.models[desiredType].clone();
            clone.scale.copy(this.models[desiredType].scale);
            group.add(clone);
          }
        }

        group.visible = desiredType !== null;

        // DEBUG: show cone center (yellow) and gun rotation value
        if (mount.isManned) {
          try {
            const coneCenter = offset.z < 0 ? MD.upperConeAngle : MD.lowerConeAngle;
            const ccRad = coneCenter * Math.PI / 180;
            ctx.save();
            // Yellow line: cone center direction
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(sx + Math.cos(ccRad) * 60, sy + Math.sin(ccRad) * 60);
            ctx.strokeStyle = '#ff0';
            ctx.lineWidth = 2;
            ctx.stroke();
            // Show rotation value
            const rotDeg = Math.round(group.rotation.y * 180 / Math.PI);
            const defDeg = offset.z < 0 ? MD.upperGunRot : MD.lowerGunRot;
            ctx.fillStyle = '#ff0';
            ctx.font = '10px monospace';
            ctx.textAlign = 'left';
            ctx.fillText(`rot=${rotDeg}° def=${defDeg}°`, sx + 15, sy - 15);
            ctx.restore();
          } catch(e) { /* prevent crash */ }
        }

        mountIdx++;
      }

      // Project to screen for overlay + input
      const screenPos = this._project(offset.x, offset.z);
      const sx = screenPos.x;
      const sy = screenPos.y;

      // --- Mount status glow ---
      {
        const hasBandit = mount._bandit && mount._bandit.active &&
          (mount._bandit.state === 2 /* ON_TRAIN */ || mount._bandit.state === 3 /* FIGHTING */);
        let glowColor = null;
        let glowAlpha = 0;
        let glowRadius = 14;

        if (hasBandit) {
          const dwellTime = mount._bandit.dwellTime || 0;
          if (dwellTime > 2.5) {
            const pulse = 0.25 + 0.2 * Math.sin(performance.now() * 0.006);
            glowColor = '255, 50, 30';
            glowAlpha = pulse;
            glowRadius = 15 + 2 * Math.sin(performance.now() * 0.006);
          } else {
            glowColor = '220, 50, 30';
            glowAlpha = 0.22;
          }
        } else if (mount.isManned) {
          glowColor = '60, 220, 80';
          glowAlpha = 0.18;
        } else if (mount.hasAutoWeapon) {
          glowColor = '240, 180, 40';
          glowAlpha = 0.2;
        }

        if (glowColor) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(sx, sy, glowRadius, 0, Math.PI * 2);
          const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, glowRadius);
          grad.addColorStop(0, `rgba(${glowColor}, ${glowAlpha})`);
          grad.addColorStop(0.6, `rgba(${glowColor}, ${glowAlpha * 0.5})`);
          grad.addColorStop(1, `rgba(${glowColor}, 0)`);
          ctx.fillStyle = grad;
          ctx.fill();
          ctx.restore();
        }
      }

      // Firing cone — perpendicular to the train edge this mount sits on
      // Upper side (z<0) → upper-left (-135°), Lower side (z>0) → lower-right (45°)
      const hasAuto = mount.hasAutoWeapon;
      const showCone = mount.isManned;
      if (showCone) {
        const upperRad = MD.upperConeAngle * Math.PI / 180;
        const lowerRad = MD.lowerConeAngle * Math.PI / 180;
        const screenCenter = offset.z < 0 ? upperRad : lowerRad;
        const screenHalf = MD.coneHalf * Math.PI / 180;

        const coneColor = mount.crew.color;
        const coneRadius = 70;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.arc(sx, sy, coneRadius, screenCenter - screenHalf, screenCenter + screenHalf, false);
        ctx.closePath();
        ctx.fillStyle = coneColor;
        ctx.globalAlpha = 0.2;
        ctx.fill();
        ctx.strokeStyle = coneColor;
        ctx.globalAlpha = 0.4;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }

      // Slot indicator on overlay
      const active = mount.isManned || hasAuto;
      if (!hasAuto && !mount.isManned) {
        // Empty mount slot — visible circle
        const slotR = 10;
        ctx.beginPath();
        ctx.arc(sx, sy, slotR, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(80, 80, 80, 0.6)';
        ctx.fill();
        ctx.strokeStyle = showEmptySlots ? 'rgba(255,255,255,0.7)' : 'rgba(160,160,160,0.5)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      if (mount.crew) {
        ctx.font = '12px serif';
        ctx.textAlign = 'center';
        ctx.fillText(crewEmoji(mount.crew), sx, sy + 4);

        // PROTOTYPE: buddy bonus "+" removed for cleaner visuals

        // Idle crew warning — crew on auto-weapon mount, no bandit (guarding after fight)
        if (hasAuto && !mount._bandit) {
          const warn = 0.5 + Math.sin(performance.now() * 0.008) * 0.5;
          ctx.save();
          // Orange pulsing circle
          ctx.beginPath();
          ctx.arc(sx, sy - 16, 10, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 165, 0, ${warn * 0.4})`;
          ctx.fill();
          // Warning icon + text
          ctx.font = 'bold 11px monospace';
          ctx.textAlign = 'center';
          ctx.strokeStyle = 'rgba(0,0,0,0.7)';
          ctx.lineWidth = 2;
          ctx.strokeText('⚠ IDLE', sx, sy - 13);
          ctx.fillStyle = `rgba(255, 200, 50, ${warn})`;
          ctx.fillText('⚠ IDLE', sx, sy - 13);
          ctx.restore();
        }

      }

      // Screen coords for input hit-testing + overlay drawing
      mount.screenX = sx;
      mount.screenY = sy;
      mount._offset_z = offset.z; // which side of train (for cone angle lookup)
      // Set pixel coords from 3D offset so combat fires from turret position
      mount.worldX = toPixelX(offset.x);
      mount.worldY = toPixelZ(offset.z);

      // Do NOT override baseDirection — train.js sets it in 2D pixel space
      // which is the coordinate system used by aiming and combat
    }

    // Hide unused mount groups
    for (let i = mountIdx; i < this.mountGroups.length; i++) {
      this.mountGroups[i].group.visible = false;
    }
  }

  drawEnemies(enemies) {
    let idx = 0;
    for (const e of enemies) {
      if (idx >= this.enemyPool.length) break;
      const mesh = this.enemyPool[idx];
      if (!e.active) {
        mesh.visible = false;
        idx++;
        continue;
      }
      const w = toWorld(e.x, e.y);
      mesh.position.x = w.x;
      mesh.position.z = w.z;
      mesh.visible = true;

      // Scale based on enemy radius (relative to base ENEMY_RADIUS of 6)
      const radiusRatio = e.radius / 6;
      const baseScale = 0.045 * radiusRatio;
      mesh.scale.setScalar(baseScale);

      // Flash white on hit
      const color = e.flashTimer > 0 ? '#ffffff' : e.color;
      if (mesh.material && mesh.material.color) {
        mesh.material.color.set(color);
      } else if (mesh.children) {
        mesh.traverse(child => {
          if (child.isMesh && child.material && child.material.color) {
            child.material.color.set(color);
          }
        });
      }

      const screenPos = this._project(w.x, w.z);
      const ctx = this.ctx;

      // Enemy emoji
      const emojiSize = Math.round(12 + (e.radius - 6) * 2);
      ctx.font = `${emojiSize}px serif`;
      ctx.textAlign = 'center';
      ctx.fillText(e.kind === 'bug' ? '\uD83E\uDD9F' : '\uD83E\uDDDF', screenPos.x, screenPos.y + 4);

      const barW = Math.max(20, e.radius * 1.5);
      const barH = 3;
      const barX = screenPos.x - barW / 2;
      const barY = screenPos.y - 18;
      ctx.fillStyle = '#222';
      ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
      const hpRatio = Math.max(0, e.hp / e.maxHp);
      ctx.fillStyle = hpRatio > 0.5 ? '#e74c3c' : hpRatio > 0.25 ? '#f39c12' : '#ff4444';
      ctx.fillRect(barX, barY, barW * hpRatio, barH);

      idx++;
    }
    // Hide unused
    for (let i = idx; i < this.enemyPool.length; i++) {
      this.enemyPool[i].visible = false;
    }
  }

  drawProjectiles(projectiles) {
    let idx = 0;
    for (const p of projectiles) {
      if (idx >= this.projectilePool.length) break;
      const mesh = this.projectilePool[idx];
      if (!p.active) {
        mesh.visible = false;
        idx++;
        continue;
      }
      const w = toWorld(p.x, p.y);
      mesh.position.x = w.x;
      mesh.position.z = w.z;
      mesh.visible = true;

      // Color by source
      if (mesh.material && mesh.material.color && mesh._lastColor !== p.color) {
        mesh.material.color.set(p.color);
        mesh._lastColor = p.color;
      }
      idx++;
    }
    for (let i = idx; i < this.projectilePool.length; i++) {
      this.projectilePool[i].visible = false;
    }
  }

  drawRicochetBolts(bolts) {
    // Hide all 3D lines (use 2D overlay instead for visibility)
    for (const line of this.ricochetPool) line.visible = false;

    const ctx = this.ctx;
    for (const b of bolts) {
      if (!b.active) continue;
      const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
      if (speed < 1) continue;

      // Project head and tail through isometric camera
      const headW = toWorld(b.x, b.y);
      const trailLen = 35;
      const tailX = b.x - (b.vx / speed) * trailLen;
      const tailY = b.y - (b.vy / speed) * trailLen;
      const tailW = toWorld(tailX, tailY);

      const head = this._project(headW.x, headW.z);
      const tail = this._project(tailW.x, tailW.z);

      // Bright glowing bolt line
      ctx.save();
      ctx.strokeStyle = '#d4b8ff';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#b388ff';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(tail.x, tail.y);
      ctx.lineTo(head.x, head.y);
      ctx.stroke();

      // Bright head dot
      ctx.beginPath();
      ctx.arc(head.x, head.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.restore();
    }
  }

  // =============================================
  // FEATURE 1: TRAIN POWER AURA
  // Subtle glow behind the train that grows with active auto-weapons
  // =============================================
  drawTrainPowerAura(train) {
    const weaponCount = train.autoWeaponCount; // 0, 1, or 2+
    if (weaponCount === 0) return;

    const ctx = this.ctx;
    const now = performance.now();

    // Find the screen-space bounding box of the train mounts to center the aura
    // The train is centered near screen center; use a fixed approximate box
    // Train runs from roughly x=300 to x=680 on screen at CANVAS_WIDTH=960
    const trainCx = CANVAS_WIDTH / 2 - 20;
    const trainCy = CANVAS_HEIGHT / 2;
    const auraW = 420;
    const auraH = 80;

    // Intensity ramps: 1 weapon = faint, 2+ weapons = stronger
    const maxAlpha = weaponCount >= 2 ? 0.18 : 0.10;
    const pulse = 0.6 + Math.sin(now * 0.0025) * 0.4;
    const alpha = maxAlpha * pulse;

    // Color shifts from cool blue (1 weapon) to warm gold (2 weapons)
    const color = weaponCount >= 2 ? `rgba(255, 200, 80, ${alpha})` : `rgba(100, 180, 255, ${alpha})`;

    ctx.save();
    // Soft glow: draw a few concentric ellipses fading outward
    for (let layer = 3; layer >= 0; layer--) {
      const expand = layer * 12;
      const layerAlpha = alpha * (1 - layer * 0.22);
      ctx.beginPath();
      ctx.ellipse(trainCx, trainCy, auraW / 2 + expand, auraH / 2 + expand, 0, 0, Math.PI * 2);
      ctx.fillStyle = weaponCount >= 2
        ? `rgba(255, 200, 80, ${layerAlpha})`
        : `rgba(100, 180, 255, ${layerAlpha})`;
      ctx.fill();
    }
    ctx.restore();
  }

  // =============================================
  // FEATURE 1: PASSIVE BUFF PIPS ON TRAIN
  // Small colored dots near the train indicating active shop passives
  // =============================================
  drawTrainPassivePips(train) {
    const ctx = this.ctx;
    const now = performance.now();

    // Collect active passives (only ones with level > 0)
    const PASSIVE_COLORS = {
      damage:   '#ff5722',
      shield:   '#3498db',
      maxHp:    '#e74c3c',
      coolOff:  '#00bcd4',
      baseArea: '#9b59b6',
    };

    const activePips = [];
    for (const [key, color] of Object.entries(PASSIVE_COLORS)) {
      const lvl = train.passives[key] || 0;
      if (lvl > 0) activePips.push({ key, color, level: lvl });
    }
    if (activePips.length === 0) return;

    // Place pips as a small row just above-left of the train center
    const startX = CANVAS_WIDTH / 2 - (activePips.length * 10) / 2 - 80;
    const pipY = CANVAS_HEIGHT / 2 - 38;
    const pipSpacing = 10;
    const pipR = 3.5;

    ctx.save();
    for (let i = 0; i < activePips.length; i++) {
      const pip = activePips[i];
      const px = startX + i * pipSpacing;
      // Subtle pulse per pip
      const pulse = 0.7 + Math.sin(now * 0.004 + i * 0.8) * 0.3;
      ctx.beginPath();
      ctx.arc(px, pipY, pipR, 0, Math.PI * 2);
      ctx.fillStyle = pip.color;
      ctx.globalAlpha = pulse * 0.85;
      ctx.fill();
      // Inner bright dot for higher levels
      if (pip.level >= 3) {
        ctx.beginPath();
        ctx.arc(px, pipY, pipR * 0.45, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.globalAlpha = pulse * 0.6;
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  drawSteamBlastAura(train) {
    if (!train.autoWeapons.steamBlast) {
      this.steamRing.visible = false;
      return;
    }
    const stats = train.getAutoWeaponStats('steamBlast');
    if (!stats) { this.steamRing.visible = false; return; }

    const m = train.getAutoWeaponMount('steamBlast');
    const isBanditDisabled = m && m._bandit;
    const now = performance.now();

    const pulse = isBanditDisabled ? 1.0 : 1 + Math.sin(now * 0.004) * 0.12;
    const r = stats.radius * (train.totalAreaMultiplier || 1) * pulse;

    // Position 3D ring at the mount's 3D offset (not pixel coords)
    const mountIdx = train.allMounts.indexOf(m);
    const offset3D = mountIdx >= 0 && mountIdx < this.mountOffsets3D.length
      ? this.mountOffsets3D[mountIdx] : null;
    if (offset3D) {
      this.steamRing.position.x = offset3D.x;
      this.steamRing.position.z = offset3D.z;
    } else {
      const w = toWorld(m ? m.worldX : train.centerX, m ? m.worldY : train.centerY);
      this.steamRing.position.x = w.x;
      this.steamRing.position.z = w.z;
    }
    // Scale ring to match radius (base geometry is ~40 units)
    const scale = r / 40;
    this.steamRing.scale.set(scale, scale, scale);
    this.steamRing.visible = !isBanditDisabled;

    // 2D overlay at the mount's projected screen position
    const scrX = m && m.screenX !== undefined ? m.screenX : CANVAS_WIDTH / 2;
    const scrY = m && m.screenY !== undefined ? m.screenY : CANVAS_HEIGHT / 2;
    const ctx = this.ctx;

    if (isBanditDisabled) {
      // Disrupted: flickering red circle
      const flicker = Math.sin(now * 0.02) > 0 ? 0.25 : 0.08;
      ctx.strokeStyle = `rgba(230, 60, 60, ${flicker})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 8]);
      ctx.beginPath();
      ctx.arc(scrX, scrY, r * 0.8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      // "DISABLED" label
      ctx.fillStyle = `rgba(230, 60, 60, ${0.5 + Math.sin(now * 0.008) * 0.3})`;
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('GARLIC DISABLED', scrX, scrY - r * 0.8 - 8);
    } else {
      // Active: visible pulsing aura fill + stroke
      const alpha = 0.08 + Math.sin(now * 0.005) * 0.04;
      ctx.fillStyle = `rgba(142, 230, 180, ${alpha})`;
      ctx.beginPath();
      ctx.arc(scrX, scrY, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = `rgba(142, 230, 180, ${0.25 + Math.sin(now * 0.006) * 0.1})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(scrX, scrY, r, 0, Math.PI * 2);
      ctx.stroke();

      // Inner ring for pulse visual
      const innerR = r * (0.4 + Math.sin(now * 0.003) * 0.1);
      ctx.strokeStyle = `rgba(142, 230, 180, ${0.12 + Math.sin(now * 0.008) * 0.06})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(scrX, scrY, innerR, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  drawWorldCoins(coins) {
    const t = performance.now() * 0.003;
    let idx = 0;
    for (const c of coins) {
      if (idx >= this.coinPool.length) break;
      const mesh = this.coinPool[idx];
      if (!c.active) {
        mesh.visible = false;
        idx++;
        continue;
      }
      const bobY = Math.sin(t + c.bobPhase) * 1.5;
      const w = toWorld(c.x, c.y);
      mesh.position.x = w.x;
      mesh.position.z = w.z;
      mesh.position.y = 4 + bobY;
      mesh.rotation.y += 0.02; // slow spin
      mesh.visible = true;
      idx++;
    }
    for (let i = idx; i < this.coinPool.length; i++) {
      this.coinPool[i].visible = false;
    }
  }

  drawMagnets(magnets) {
    const ctx = this.ctx;
    const t = performance.now() * 0.003;
    for (const m of magnets) {
      if (!m.active) continue;
      const bobY = Math.sin(t + m.bobPhase) * 2;
      const w = toWorld(m.x, m.y);
      const s = this._project(w.x, w.z);
      // Pulsing glow
      const pulse = 0.6 + Math.sin(t * 3 + m.bobPhase) * 0.4;
      ctx.beginPath();
      ctx.arc(s.x, s.y + bobY * 0.5, 16, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(230, 50, 50, ${pulse * 0.25})`;
      ctx.fill();
      // Magnet emoji
      ctx.font = '18px serif';
      ctx.textAlign = 'center';
      ctx.fillText('\uD83E\uDDF2', s.x, s.y + bobY * 0.5 + 6);
    }
  }

  drawMagnetFlash(coinSystem) {
    if (!coinSystem || coinSystem.magnetFlash <= 0) return;
    const ctx = this.ctx;
    const alpha = Math.min(0.3, coinSystem.magnetFlash * 0.6);
    ctx.fillStyle = `rgba(255, 200, 50, ${alpha})`;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }

  drawFlyingCoins(flyingCoins) {
    let idx = 0;
    for (const fc of flyingCoins) {
      if (idx >= this.flyingCoinPool.length) break;
      const mesh = this.flyingCoinPool[idx];
      if (!fc.active) {
        mesh.visible = false;
        idx++;
        continue;
      }
      const w = toWorld(fc.x, fc.y);
      mesh.position.x = w.x;
      mesh.position.z = w.z;
      mesh.position.y = 8;
      mesh.visible = true;
      idx++;
    }
    for (let i = idx; i < this.flyingCoinPool.length; i++) {
      this.flyingCoinPool[i].visible = false;
    }
  }

  drawMovingCrew(crew) {
    const ctx = this.ctx;
    for (let i = 0; i < crew.length; i++) {
      const c = crew[i];
      if (i < this.crewMoveMeshes.length) this.crewMoveMeshes[i].visible = false;
      if (!c.isMoving) continue;

      // Get screen position: project moveX/moveY through 3D camera
      const x = c.moveScreenX !== undefined ? c.moveScreenX : undefined;
      const y = c.moveScreenY !== undefined ? c.moveScreenY : undefined;
      let sx, sy;
      if (x !== undefined) {
        sx = x; sy = y;
      } else {
        const projected = this._project(c.moveX - CANVAS_WIDTH / 2, c.moveY - CANVAS_HEIGHT / 2, 16);
        sx = projected.x; sy = projected.y;
      }

      const pulse = 0.8 + Math.sin(performance.now() * 0.008) * 0.2;
      ctx.globalAlpha = pulse;
      ctx.font = '20px serif';
      ctx.textAlign = 'center';
      ctx.fillText(crewEmoji(c), sx, sy + 6);
      ctx.globalAlpha = 1;
    }
  }

  // =============================================
  // FEATURE 2: BANDIT TELEGRAPHING
  // =============================================

  // Draw pulsing "!" above a bandit that has boarded the train, and a dashed
  // guide arrow from the nearest unassigned crew member to that mount.
  drawBanditTelegraphing(bandits, crew) {
    const ctx = this.ctx;
    const now = performance.now();

    for (const b of bandits) {
      if (!b.active) continue;
      if (b.state !== 2 /* ON_TRAIN */ && b.state !== 3 /* FIGHTING */) continue;
      if (!b.targetSlot) continue;

      const sx = b.targetSlot.screenX ?? b.targetSlot.worldX;
      const sy = b.targetSlot.screenY ?? b.targetSlot.worldY;

      // --- Pulsing "!" exclamation above the mount ---
      const excPulse = 0.4 + Math.abs(Math.sin(now * 0.009)) * 0.6;
      const excBob = Math.sin(now * 0.009) * 3;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = 'bold 18px monospace';
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.lineWidth = 3;
      ctx.strokeText('!', sx, sy - 30 + excBob);
      ctx.fillStyle = `rgba(255, 50, 30, ${excPulse})`;
      ctx.fillText('!', sx, sy - 30 + excBob);
      ctx.restore();

      // --- Crew-hint arrow: nearest unassigned crew → bandit mount ---
      // Only show when bandit is stealing (not fighting — crew is already there)
      if (b.state === 2 /* ON_TRAIN */) {
        let nearestCrew = null;
        let nearestDist = Infinity;
        for (const c of crew) {
          if (c.isMoving && c.moveTargetSlot === b.targetSlot) continue; // already going there
          const cx = c.assignment
            ? (c.assignment.screenX ?? c.assignment.worldX)
            : c.panelX;
          const cy = c.assignment
            ? (c.assignment.screenY ?? c.assignment.worldY)
            : c.panelY;
          const dist = Math.hypot(cx - sx, cy - sy);
          if (dist < nearestDist) {
            nearestDist = dist;
            nearestCrew = { cx, cy };
          }
        }

        if (nearestCrew && nearestDist > 30) {
          const { cx, cy } = nearestCrew;
          const dx = sx - cx;
          const dy = sy - cy;
          const len = Math.hypot(dx, dy);
          const ux = dx / len;
          const uy = dy / len;
          const startGap = 16;
          const endGap = 14;
          const x1 = cx + ux * startGap;
          const y1 = cy + uy * startGap;
          const x2 = sx - ux * endGap;
          const y2 = sy - uy * endGap;

          const arrowPulse = 0.3 + Math.abs(Math.sin(now * 0.006)) * 0.5;

          ctx.save();
          ctx.strokeStyle = `rgba(255, 220, 50, ${arrowPulse})`;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([6, 5]);
          ctx.lineDashOffset = -(now * 0.06) % 11; // animated marching ants
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.lineDashOffset = 0;

          // Arrow head
          const headLen = 7;
          const headAngle = 0.45;
          const angle = Math.atan2(y2 - y1, x2 - x1);
          ctx.fillStyle = `rgba(255, 220, 50, ${arrowPulse})`;
          ctx.beginPath();
          ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - Math.cos(angle - headAngle) * headLen,
                     y2 - Math.sin(angle - headAngle) * headLen);
          ctx.lineTo(x2 - Math.cos(angle + headAngle) * headLen,
                     y2 - Math.sin(angle + headAngle) * headLen);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }
    }
  }

  // Draw the "Drag crew to fight off bandits!" first-boarding tooltip.
  // fadeTimer: seconds remaining (0-3 range, drawn while > 0).
  drawBanditBoardingTooltip(fadeTimer) {
    if (fadeTimer <= 0) return;
    const ctx = this.ctx;
    const alpha = Math.min(1, fadeTimer); // full alpha until last second, then fades
    const tipW = 360;
    const tipH = 40;
    const tipX = CANVAS_WIDTH / 2 - tipW / 2;
    const tipY = CANVAS_HEIGHT / 2 + 80;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(20, 20, 40, 0.88)';
    this.roundRect(tipX, tipY, tipW, tipH, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 200, 50, 0.9)';
    ctx.lineWidth = 1.5;
    this.roundRect(tipX, tipY, tipW, tipH, 8);
    ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Click crew \u2192 click mount to fight bandits!', CANVAS_WIDTH / 2, tipY + 26);
    ctx.restore();
  }

  drawBandits(bandits, allMounts) {
    const ctx = this.ctx;
    let poolIdx = 0;
    for (const b of bandits) {
      if (!b.active) {
        continue;
      }

      // --- 3D mesh ---
      const mesh = poolIdx < this.banditPool.length ? this.banditPool[poolIdx] : null;
      poolIdx++;

      // Project bandit position to screen
      let sx, sy;
      let worldX3d = null, worldZ3d = null;
      if (b.state <= 1) {
        // RUNNING or JUMPING — use world coords
        const w = toWorld(b.x, b.y);
        worldX3d = w.x;
        worldZ3d = w.z;
        const s = this._project(w.x, w.z);
        sx = s.x;
        sy = s.y;
        // For jumping, apply the arc in screen space
        if (b.state === 1) {
          const progress = 1 - Math.max(0, b.timer / 0.4);
          sy -= Math.sin(progress * Math.PI) * 20;
        }
      } else if (b.targetSlot) {
        // ON_TRAIN, FIGHTING — use slot screen coords + find 3D offset
        sx = b.targetSlot.screenX ?? b.targetSlot.worldX;
        sy = b.targetSlot.screenY ?? b.targetSlot.worldY;
        if (allMounts) {
          const mi = allMounts.indexOf(b.targetSlot);
          if (mi >= 0 && this.mountOffsets3D[mi]) {
            worldX3d = this.mountOffsets3D[mi].x;
            worldZ3d = this.mountOffsets3D[mi].z;
          }
        }
      } else {
        // DEAD — project world coords
        const w = toWorld(b.x, b.y);
        worldX3d = w.x;
        worldZ3d = w.z;
        const s = this._project(w.x, w.z);
        sx = s.x;
        sy = s.y;
      }

      // Position 3D mesh
      if (mesh) {
        if (worldX3d !== null) {
          mesh.visible = true;
          mesh.position.x = worldX3d;
          mesh.position.z = worldZ3d;
          if (b.state <= 1) {
            mesh.position.y = b.state === 1
              ? 4 + Math.sin((1 - Math.max(0, b.timer / 0.4)) * Math.PI) * 12
              : 4;
          } else {
            mesh.position.y = 18; // on top of train
          }
          // Rotate toward train when running
          if (b.state === 0) {
            mesh.rotation.y = b.side > 0 ? -Math.PI / 2 : Math.PI / 2;
          }
          // Flash white on hit
          const color = (b.state === 3 && b.flashTimer % 0.3 < 0.15) ? 0xffffff : 0xcc3333;
          mesh.children.forEach(c => { if (c.material) c.material.color.setHex(color); });
          // Fade on death
          if (b.state === 4) {
            const alpha = Math.max(0, b.timer / 0.6);
            mesh.children.forEach(c => {
              if (c.material) { c.material.transparent = true; c.material.opacity = alpha; }
            });
            mesh.rotation.y += 0.1;
          } else {
            mesh.children.forEach(c => {
              if (c.material && c.material.transparent) { c.material.transparent = false; c.material.opacity = 1; }
            });
          }
        } else {
          mesh.visible = false;
        }
      }

      switch (b.state) {
        case 0: // RUNNING
        case 1: { // JUMPING
          const bobY = b.state === 0 ? Math.sin(performance.now() * 0.015) * 2 : 0;
          ctx.save();
          ctx.translate(sx, sy + bobY);
          ctx.font = '16px serif';
          ctx.textAlign = 'center';
          ctx.fillText('\uD83C\uDFCE\uFE0F', 0, 4);
          ctx.restore();
          break;
        }

        case 2: // ON_TRAIN
        case 3: { // FIGHTING
          const fighting = b.state === 3;

          ctx.save();
          ctx.translate(sx, sy);
          if (fighting) ctx.translate((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4);

          if (fighting && b.flashTimer % 0.3 < 0.15) {
            ctx.globalAlpha = 0.5;
          }
          ctx.font = '16px serif';
          ctx.textAlign = 'center';
          ctx.fillText('\uD83C\uDFCE\uFE0F', 0, 4);
          ctx.globalAlpha = 1;
          ctx.restore();

          // Status labels and effects
          if (!fighting && !b.targetSlot?.autoWeaponId) {
            // Gold coins flowing from gold counter to bandit
            const goldHudX = CANVAS_WIDTH - 94;
            const goldHudY = 26;
            const t = performance.now() * 0.003;
            for (let i = 0; i < 6; i++) {
              const age = (t + i * 0.35) % 2;
              if (age > 1.5) continue;
              const progress = age / 1.5;
              const px = goldHudX + (sx - goldHudX) * progress + Math.sin(progress * Math.PI * 2 + i) * 10;
              const py = goldHudY + (sy - goldHudY) * progress + Math.sin(progress * Math.PI) * -20;
              const alpha = progress < 0.1 ? progress / 0.1 : progress > 0.85 ? (1 - progress) / 0.15 : 1;
              ctx.globalAlpha = alpha * 0.9;
              ctx.beginPath();
              ctx.arc(px, py, 3, 0, Math.PI * 2);
              ctx.fillStyle = '#f5a623';
              ctx.fill();
              ctx.strokeStyle = '#c88a1a';
              ctx.lineWidth = 1;
              ctx.stroke();
            }
            ctx.globalAlpha = 1;

            // Stolen amount
            if (b.stealFlash > 0) {
              ctx.strokeStyle = `rgba(0, 0, 0, ${Math.min(1, b.stealFlash * 2) * 0.8})`;
              ctx.lineWidth = 3;
              ctx.font = 'bold 16px monospace';
              ctx.textAlign = 'center';
              ctx.strokeText(`-${b.totalStolen}g`, sx, sy - 40);
              ctx.fillStyle = `rgba(231, 76, 60, ${Math.min(1, b.stealFlash * 2)})`;
              ctx.fillText(`-${b.totalStolen}g`, sx, sy - 40);
            }

            // "STEALING!" label — large and urgent
            const pulse = 0.5 + Math.sin(performance.now() * 0.012) * 0.5;
            const stealScale = 1 + Math.sin(performance.now() * 0.01) * 0.08;
            ctx.save();
            ctx.translate(sx, sy - 24);
            ctx.scale(stealScale, stealScale);
            ctx.strokeStyle = `rgba(0, 0, 0, ${pulse * 0.8})`;
            ctx.lineWidth = 3;
            ctx.font = 'bold 15px monospace';
            ctx.textAlign = 'center';
            ctx.strokeText('STEALING!', 0, 0);
            ctx.fillStyle = `rgba(255, 60, 30, ${pulse})`;
            ctx.fillText('STEALING!', 0, 0);
            ctx.restore();
          }

          if (!fighting && b.targetSlot?.autoWeaponId) {
            // Disabled weapon — large red glow + big X
            const pulse = 0.6 + Math.sin(performance.now() * 0.008) * 0.4;
            // Red glow circle behind
            const glowR = 22 + Math.sin(performance.now() * 0.01) * 4;
            ctx.beginPath();
            ctx.arc(sx, sy, glowR, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(231, 50, 50, ${pulse * 0.35})`;
            ctx.fill();
            // Big X
            ctx.strokeStyle = `rgba(255, 40, 40, ${pulse})`;
            ctx.lineWidth = 5;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(sx - 14, sy - 14); ctx.lineTo(sx + 14, sy + 14);
            ctx.moveTo(sx + 14, sy - 14); ctx.lineTo(sx - 14, sy + 14);
            ctx.stroke();
            ctx.lineCap = 'butt';
            // DISABLED label
            ctx.strokeStyle = `rgba(0,0,0,0.8)`;
            ctx.lineWidth = 3;
            ctx.font = 'bold 13px monospace';
            ctx.textAlign = 'center';
            ctx.strokeText('DISABLED!', sx, sy - 24);
            ctx.fillStyle = '#ff4444';
            ctx.fillText('DISABLED!', sx, sy - 24);
          }

          // "Move crew here!" prompt — pulsing arrow
          if (!fighting) {
            const bounce = Math.sin(performance.now() * 0.006) * 3;
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('▼ SEND CREW ▼', sx, sy + 18 + bounce);
          }

          if (fighting) {
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 10px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('⚔ FIGHT!', sx, sy - 20);
          }
          break;
        }

        case 4: { // DEAD
          const alpha = Math.max(0, b.timer / 0.6);
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.translate(sx, sy);
          ctx.rotate(performance.now() * 0.02);
          ctx.font = '16px serif';
          ctx.textAlign = 'center';
          ctx.fillText('\uD83C\uDFCE\uFE0F', 0, 4);
          ctx.restore();
          break;
        }
      }
    }
    // Hide unused bandit meshes
    for (let i = poolIdx; i < this.banditPool.length; i++) {
      this.banditPool[i].visible = false;
    }
  }

  // Cargo boxes are part of the train model — skip in 3D
  drawCargoBoxes(x, y, w, h, boxes) {
    // No-op: cargo visual is baked into train model
  }

  // =============================================
  // 2D OVERLAY METHODS (copied from renderer.js)
  // =============================================

  drawSelectedIndicator(crew) {
    const ctx = this.ctx;
    let x, y;
    if (crew.isMoving) {
      // Project moving crew position to screen
      const w = toWorld(crew.moveX, crew.moveY);
      const s = this._project(w.x, w.z);
      x = s.x;
      y = s.y;
    } else if (crew.assignment) {
      // Use projected screen coords
      x = crew.assignment.screenX ?? crew.assignment.worldX;
      y = crew.assignment.screenY ?? crew.assignment.worldY;
    } else {
      x = crew.panelX;
      y = crew.panelY;
    }

    // Pulsing selection ring
    const pulse = 1 + Math.sin(performance.now() * 0.006) * 0.15;
    const r = (CREW_RADIUS + 8) * pulse;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Corner brackets
    ctx.strokeStyle = crew.color;
    ctx.lineWidth = 2.5;
    const s = r + 4;
    const l = 6;
    ctx.beginPath(); ctx.moveTo(x - s, y - s + l); ctx.lineTo(x - s, y - s); ctx.lineTo(x - s + l, y - s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + s - l, y - s); ctx.lineTo(x + s, y - s); ctx.lineTo(x + s, y - s + l); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - s, y + s - l); ctx.lineTo(x - s, y + s); ctx.lineTo(x - s + l, y + s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + s - l, y + s); ctx.lineTo(x + s, y + s); ctx.lineTo(x + s, y + s - l); ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('SELECTED', x, y - r - 8);
  }

  // =============================================
  // CREW INFO CARD
  // =============================================
  drawCrewInfoCard(crew) {
    if (!crew) return;
    const ctx = this.ctx;

    // Resolve screen position of crew member
    let cx, cy;
    if (crew.isMoving) {
      if (crew.moveScreenX !== undefined) {
        cx = crew.moveScreenX;
        cy = crew.moveScreenY;
      } else {
        const proj = this._project(crew.moveX - CANVAS_WIDTH / 2, crew.moveY - CANVAS_HEIGHT / 2, 16);
        cx = proj.x;
        cy = proj.y;
      }
    } else if (crew.assignment) {
      cx = crew.assignment.screenX ?? crew.assignment.worldX;
      cy = crew.assignment.screenY ?? crew.assignment.worldY;
    } else {
      cx = crew.panelX;
      cy = crew.panelY;
    }

    // Role bonus text per role
    const roleBonusMap = {
      Gunner:   '+60% dmg, slow bandit fight',
      Brawler:  'Instant bandit kick, -40% dmg',
    };
    const roleBonus = roleBonusMap[crew.role] || '';

    // Card dimensions
    const cardW = 120;
    const cardH = 62;

    // Position: offset to the right and slightly above the crew circle
    // Clamp so the card never goes off-screen
    let cardX = cx + 20;
    let cardY = cy - cardH - 8;
    if (cardX + cardW > CANVAS_WIDTH - 4) cardX = cx - cardW - 20;
    if (cardY < 4) cardY = cy + 20;

    ctx.save();

    // Background
    ctx.fillStyle = 'rgba(10, 14, 22, 0.82)';
    ctx.beginPath();
    this.roundRect(cardX, cardY, cardW, cardH, 6);
    ctx.fill();

    // Border in crew colour
    ctx.strokeStyle = crew.color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    this.roundRect(cardX, cardY, cardW, cardH, 6);
    ctx.stroke();

    ctx.textAlign = 'left';

    // Name
    ctx.fillStyle = crew.color;
    ctx.font = 'bold 13px monospace';
    ctx.fillText(crew.name || `Crew ${crew.id + 1}`, cardX + 8, cardY + 17);

    // Role
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = '10px monospace';
    ctx.fillText(crew.role ? crew.role.toUpperCase() : '', cardX + 8, cardY + 30);

    // Role bonus
    if (roleBonus) {
      ctx.fillStyle = '#f5a623';
      ctx.font = 'bold 10px monospace';
      ctx.fillText(roleBonus, cardX + 8, cardY + 43);
    }

    // Gun level
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '9px monospace';
    ctx.fillText(`Gun Lv.${crew.gunLevel}`, cardX + 8, cardY + 56);

    ctx.restore();
  }

  // Spawn + tick muzzle flash at world position (x, y in pixel/canvas coords)
  spawnMuzzleFlash(x, y) {
    const f = this._muzzleFlashes.find(f => !f.active);
    if (!f) return;
    f.active = true;
    f.x = x;
    f.y = y;
    f.maxLife = 0.08;
    f.life = f.maxLife;
  }

  updateAndDrawMuzzleFlashes(dt) {
    const ctx = this.ctx;
    for (const f of this._muzzleFlashes) {
      if (!f.active) continue;
      f.life -= dt;
      if (f.life <= 0) { f.active = false; continue; }
      const t = f.life / f.maxLife; // 1→0
      const radius = 8 * t;
      const alpha = t;
      ctx.save();
      ctx.globalAlpha = alpha;
      // Outer glow — yellow
      ctx.beginPath();
      ctx.arc(f.x, f.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = '#ffe066';
      ctx.fill();
      // Inner core — white
      ctx.beginPath();
      ctx.arc(f.x, f.y, radius * 0.45, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.restore();
    }
  }

  // Spawn hit spark at world pixel position (same coord space as projectiles/enemies)
  spawnHitSpark(pixelX, pixelY) {
    const s = this._hitSparks.find(s => !s.active);
    if (!s) return;
    const w = toWorld(pixelX, pixelY);
    const screen = this._project(w.x, w.z, 5);
    s.active = true;
    s.x = screen.x;
    s.y = screen.y;
    s.maxLife = 0.12;
    s.life = s.maxLife;
    s.particles = [];
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = 40 + Math.random() * 40;
      s.particles.push({ x: s.x, y: s.y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, life: 0.1 });
    }
  }

  updateAndDrawHitSparks(dt) {
    const ctx = this.ctx;
    for (const s of this._hitSparks) {
      if (!s.active) continue;
      s.life -= dt;
      if (s.life <= 0) { s.active = false; continue; }
      const t = s.life / s.maxLife; // 1→0
      const radius = 5 * t;
      ctx.save();
      ctx.globalAlpha = t * 0.9;
      ctx.beginPath();
      ctx.arc(s.x, s.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      if (s.particles) {
        for (const p of s.particles) {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.life -= dt;
          if (p.life <= 0) continue;
          const pa = p.life / 0.1;
          ctx.globalAlpha = pa * 0.8;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 1.5 * pa, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  // Draw trajectory preview dashed line from mount screen pos toward mouse
  drawTrajectoryPreview(mount, mouseX, mouseY) {
    // mount must have screenX/screenY set (done by drawWeaponMounts)
    if (mount.screenX === undefined || mount.screenY === undefined) return;
    const sx = mount.screenX;
    const sy = mount.screenY;
    const dx = mouseX - sx;
    const dy = mouseY - sy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) return;
    const nx = dx / dist;
    const ny = dy / dist;
    const lineLen = 150;
    const ex = sx + nx * lineLen;
    const ey = sy + ny * lineLen;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  drawDamageNumbers(numbers) {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    for (const d of numbers) {
      if (!d.active) continue;
      const w = toWorld(d.x, d.y);
      const s = this._project(w.x, w.z);
      const t = 1 - d.life / d.maxLife; // 0→1 over lifetime
      const alpha = Math.max(0, d.life / d.maxLife);
      // Float upward in screen space
      const yOff = t * -35;
      // Scale size and color by damage amount
      const dmg = Math.round(d.damage);
      const dmgScale = Math.min(2, 1 + dmg / 40); // bigger hits = bigger text
      const popScale = 1 + 0.4 * Math.max(0, 1 - t * 4);
      const size = Math.round(18 * dmgScale * popScale);
      ctx.font = `bold ${size}px monospace`;
      // Color shifts from yellow (low) → orange (mid) → red (high)
      let r, g, b;
      if (dmg < 15) {
        r = 255; g = 255; b = 100; // yellow
      } else if (dmg < 30) {
        const f = (dmg - 15) / 15;
        r = 255; g = Math.round(255 - f * 130); b = Math.round(100 - f * 80); // → orange
      } else {
        const f = Math.min(1, (dmg - 30) / 30);
        r = 255; g = Math.round(125 - f * 75); b = Math.round(20 + f * 20); // → red
      }
      // Outline for readability
      ctx.strokeStyle = `rgba(0, 0, 0, ${alpha * 0.8})`;
      ctx.lineWidth = 3;
      ctx.strokeText(`-${dmg}`, s.x, s.y + yOff);
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
      ctx.fillText(`-${dmg}`, s.x, s.y + yOff);
    }
  }

  drawDamageFlash(train) {
    if (train.damageFlash <= 0) return;
    const ctx = this.ctx;
    const alpha = Math.min(0.5, train.damageFlash);
    ctx.fillStyle = `rgba(255, 0, 0, ${alpha})`;
    ctx.fillRect(-10, -10, CANVAS_WIDTH + 20, CANVAS_HEIGHT + 20);
  }

  // =============================================
  // HUD
  // =============================================
  drawHUD(train) {
    const ctx = this.ctx;
    const pad = 12;

    // === HULL (HP) — top-left ===
    const hpBarW = 220;
    const hpBarH = 22;
    const hpX = pad;
    const hpY = pad;

    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    this.roundRect(hpX, hpY, hpBarW + 8, hpBarH + 8, 4);
    ctx.fill();

    ctx.fillStyle = '#8f8';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('HP', hpX + 4, hpY - 1);

    ctx.fillStyle = '#222';
    ctx.fillRect(hpX + 4, hpY + 4, hpBarW, hpBarH);

    const hpRatio = Math.max(0, train.hp / train.maxHp);
    const segW = 8;
    const segGap = 2;
    const totalSegs = Math.floor(hpBarW / (segW + segGap));
    const filledSegs = Math.ceil(totalSegs * hpRatio);
    for (let i = 0; i < filledSegs; i++) {
      const green = hpRatio > 0.5 ? '#4f4' : hpRatio > 0.25 ? '#fa3' : '#f44';
      ctx.fillStyle = green;
      ctx.fillRect(hpX + 4 + i * (segW + segGap), hpY + 5, segW, hpBarH - 2);
    }

    // HP bar damage flash — bright red overlay over the entire bar
    if (train.hpFlashTimer > 0) {
      train.hpFlashTimer -= 0.016; // decremented here; renderer runs each frame
      const flashAlpha = Math.min(0.9, (train.hpFlashTimer / 0.4) * 0.9);
      ctx.fillStyle = `rgba(255, 40, 40, ${flashAlpha})`;
      ctx.fillRect(hpX + 4, hpY + 4, hpBarW, hpBarH);
    }

    // HP bar green flash — "survived the surge" relief beat
    if (train.hpGreenFlashTimer > 0) {
      train.hpGreenFlashTimer -= 0.016;
      const greenAlpha = Math.min(0.7, (train.hpGreenFlashTimer / 0.5) * 0.7);
      ctx.fillStyle = `rgba(80, 255, 80, ${greenAlpha})`;
      ctx.fillRect(hpX + 4, hpY + 4, hpBarW, hpBarH);
    }

    // === XP BAR — top-center ===
    const xpBarW = 200;
    const xpBarH = 18;
    const xpX = CANVAS_WIDTH / 2 - xpBarW / 2 - 30;
    const xpY = pad;

    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    this.roundRect(xpX - 4, xpY, xpBarW + 80, xpBarH + 8, 4);
    ctx.fill();

    ctx.fillStyle = '#f66';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('XP', xpX, xpY - 1);

    ctx.fillStyle = '#333';
    ctx.fillRect(xpX, xpY + 4, xpBarW, xpBarH);

    const xpRatio = train.xp / train.xpToNextLevel;
    const xpGrad = ctx.createLinearGradient(xpX, 0, xpX + xpBarW * xpRatio, 0);
    xpGrad.addColorStop(0, '#e74c3c');
    xpGrad.addColorStop(1, '#f39c12');
    ctx.fillStyle = xpGrad;
    ctx.fillRect(xpX, xpY + 4, xpBarW * xpRatio, xpBarH);

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`Level ${train.level}`, xpX + xpBarW + 8, xpY + 18);

    // === GOLD — top-right (animated counter) ===
    const goldX = CANVAS_WIDTH - pad;
    const actualGold = train.runGold;

    // Animate displayed gold toward actual gold
    if (this._displayedGold !== actualGold) {
      const diff = actualGold - this._displayedGold;
      // Flash color on change
      if (this._goldFlashTimer <= 0) {
        this._goldFlashColor = diff > 0 ? '#4f4' : '#f44';
      }
      this._goldFlashTimer = 0.4;
      // Count speed: faster for bigger differences, minimum 1 per frame
      const step = Math.max(1, Math.ceil(Math.abs(diff) * 0.15));
      if (Math.abs(diff) <= step) {
        this._displayedGold = actualGold;
      } else {
        this._displayedGold += Math.sign(diff) * step;
      }
    }
    if (this._goldFlashTimer > 0) this._goldFlashTimer -= 0.016;

    // Background — flash tint when changing
    const flashAlpha = this._goldFlashTimer > 0 ? this._goldFlashTimer / 0.4 : 0;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    this.roundRect(goldX - 100, xpY, 96, 28, 4);
    ctx.fill();
    if (flashAlpha > 0) {
      ctx.fillStyle = this._goldFlashColor === '#4f4'
        ? `rgba(60,180,60,${flashAlpha * 0.3})`
        : `rgba(200,50,50,${flashAlpha * 0.3})`;
      this.roundRect(goldX - 100, xpY, 96, 28, 4);
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(goldX - 82, xpY + 14, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#f5a623';
    ctx.fill();
    ctx.strokeStyle = '#c88a1a';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Gold number — flash color then return to white
    const goldTextColor = flashAlpha > 0.1 ? this._goldFlashColor : '#fff';
    ctx.fillStyle = goldTextColor;
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${this._displayedGold}`, goldX - 10, xpY + 19);

    // === CARGO — below gold ===
    const cargoY = xpY + 32;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    this.roundRect(goldX - 100, cargoY, 96, 24, 4);
    ctx.fill();

    ctx.fillStyle = '#8B6914';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('CARGO', goldX - 96, cargoY + 10);

    const cargoMult = train.cargoMultiplier;
    ctx.fillStyle = '#c8a96e';
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`x${cargoMult.toFixed(1)}`, goldX - 10, cargoY + 17);

    // === MINI-MAP — bottom-right ===
    this.drawMiniMap(train.distance);

    this.drawMountDebug();
  }

  drawMountDebug() {
    if (!MD.enabled) return;
    const ctx = this.ctx;
    const dx = 10, dy = CANVAS_HEIGHT - 130;
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(dx, dy, 320, 120);
    ctx.strokeStyle = '#ff0';
    ctx.lineWidth = 1;
    ctx.strokeRect(dx, dy, 320, 120);
    ctx.fillStyle = '#ff0';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('MOUNT DEBUG (F4 toggle, Shift=1\u00B0)', dx + 6, dy + 14);
    ctx.fillStyle = '#fff';
    ctx.font = '11px monospace';
    ctx.fillText(`1/2  Upper cone: ${MD.upperConeAngle}\u00B0`, dx + 6, dy + 30);
    ctx.fillText(`3/4  Lower cone: ${MD.lowerConeAngle}\u00B0`, dx + 6, dy + 44);
    ctx.fillText(`5/6  Upper gun rot: ${MD.upperGunRot}\u00B0`, dx + 6, dy + 58);
    ctx.fillText(`7/8  Lower gun rot: ${MD.lowerGunRot}\u00B0`, dx + 6, dy + 72);
    ctx.fillText(`9/0  Cone half:  ${MD.coneHalf}\u00B0`, dx + 6, dy + 86);
    ctx.fillStyle = '#888';
    ctx.fillText('Copy these values when aligned!', dx + 6, dy + 100);
  }

  drawWaveHUD(waveInfo) {
    if (!waveInfo) return;
    const ctx = this.ctx;
    const now = performance.now();

    // Wave number display — bottom, right of slot boxes
    if (waveInfo.waveNumber > 0) {
      const waveX = 188;
      const waveY = CANVAS_HEIGHT - 60;

      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      this.roundRect(waveX, waveY, 110, 28, 4);
      ctx.fill();

      ctx.fillStyle = '#f5a623';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'left';
      ctx.fillText('WAVE', waveX + 6, waveY + 11);

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px monospace';
      ctx.fillText(`${waveInfo.waveNumber}`, waveX + 50, waveY + 20);
    }


  }

  drawMiniMap(distance) {
    const ctx = this.ctx;
    const mapW = 180;
    const mapH = 30;
    const mapX = CANVAS_WIDTH - mapW - 16;
    const mapY = CANVAS_HEIGHT - mapH - 16;

    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    this.roundRect(mapX - 8, mapY - 14, mapW + 16, mapH + 28, 6);
    ctx.fill();

    ctx.fillStyle = '#aaa';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('Depot', mapX, mapY + mapH + 12);
    ctx.textAlign = 'right';
    ctx.fillText('Delivery', mapX + mapW, mapY + mapH + 12);

    ctx.strokeStyle = '#666';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(mapX, mapY + mapH / 2);
    ctx.lineTo(mapX + mapW, mapY + mapH / 2);
    ctx.stroke();

    ctx.fillStyle = '#888';
    ctx.fillRect(mapX + mapW - 2, mapY + 4, 4, mapH - 8);

    const ratio = Math.min(1, distance / TARGET_DISTANCE);
    const trainX = mapX + mapW * ratio;

    ctx.fillStyle = '#f5a623';
    ctx.fillRect(trainX - 8, mapY + mapH / 2 - 4, 16, 8);
    ctx.fillStyle = '#e74c3c';
    ctx.fillRect(trainX - 12, mapY + mapH / 2 - 3, 5, 6);

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.floor(ratio * 100)}%`, mapX + mapW / 2, mapY - 2);
  }

  // =============================================
  // CREW PANEL
  // =============================================
  drawCrewPanel(crew, panelY) {
    const ctx = this.ctx;

    // Don't draw panel if all crew are assigned
    const unassigned = crew.filter(c => !c.assignment && !c.isMoving);
    if (unassigned.length === 0) return;

    const spacing = 70;
    const totalW = crew.length * spacing;
    const startX = CANVAS_WIDTH / 2 - totalW / 2;

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    this.roundRect(startX - 20, panelY - 35, totalW + 30, 75, 10);
    ctx.fill();
    ctx.strokeStyle = '#f5a623';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#f5a623';
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('CLICK CREW \u2192 CLICK SLOT', CANVAS_WIDTH / 2, panelY - 18);

    for (let i = 0; i < crew.length; i++) {
      const c = crew[i];
      const cx = startX + i * spacing + spacing / 2;
      const cy = panelY + 12;
      c.panelX = cx;
      c.panelY = cy;

      if (c.assignment || c.isMoving) continue;

      ctx.beginPath();
      ctx.arc(cx, cy, CREW_RADIUS + 4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fill();

      ctx.font = '18px serif';
      ctx.textAlign = 'center';
      ctx.fillText(crewEmoji(c), cx, cy + 6);

      // Role badge below crew circle
      if (c.role) {
        const roleColor = c.role === 'Gunner' ? '#ffb74d' : '#66bb6a';
        ctx.fillStyle = roleColor;
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(c.role.toUpperCase(), cx, cy + 26);
      }
    }
  }

  // =============================================
  // SETUP OVERLAY
  // =============================================
  drawMissionBrief() {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, 50);
    ctx.fillStyle = '#c8a96e';
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Crew ready! Depart when prepared.', CANVAS_WIDTH / 2, 22);
    ctx.fillStyle = '#8a7a5a';
    ctx.font = '13px monospace';
    ctx.fillText('Zombies will attack the train. Bandits will steal your gold.', CANVAS_WIDTH / 2, 42);
  }

  drawSetupOverlay() {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, 50);
    ctx.fillStyle = '#f5a623';
    ctx.font = 'bold 20px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Left-click crew to select, right-click slot to place', CANVAS_WIDTH / 2, 32);
  }

  // Helper: draw a labeled stat bar
  _drawStatBar(ctx, label, x, y, w, fill, maxFill, color) {
    const barH = 8;
    const labelW = 58;
    // Label
    ctx.fillStyle = '#999';
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(label, x + labelW - 4, y + 8);
    // Track
    const bx = x + labelW;
    const bw = w - labelW;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(bx, y, bw, barH);
    // Fill
    const fillW = (fill / maxFill) * bw;
    ctx.fillStyle = color;
    ctx.fillRect(bx, y, fillW, barH);
    // Notch marks
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    for (let n = 1; n < maxFill; n++) {
      ctx.fillRect(bx + (n / maxFill) * bw - 0.5, y, 1, barH);
    }
  }

  // Role pick UI — crew slots on top, character roster below, confirm button.
  drawRolePickUI(crew, hoveredBtn) {
    const ctx = this.ctx;
    const now = performance.now();

    const roles = [
      {
        id: 'Gunner', avatar: '\uD83D\uDC31',
        color: '#ffb74d', bg: 'rgba(255, 160, 50, 0.15)',
        title: 'GUNNER', tagline: 'Firepower specialist',
        stats: { damage: 4, banditSpeed: 1 }, // out of 5
      },
      {
        id: 'Brawler', avatar: '\u26C4\uFE0F',
        color: '#66bb6a', bg: 'rgba(80, 200, 90, 0.15)',
        title: 'BRAWLER', tagline: 'Bandit fighter',
        stats: { damage: 2, banditSpeed: 5 }, // out of 5
      },
    ];
    const roleMap = {};
    for (const r of roles) roleMap[r.id] = r;

    // Dark overlay
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Title
    ctx.fillStyle = '#f5a623';
    ctx.font = 'bold 22px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('CHOOSE YOUR CREW', CANVAS_WIDTH / 2, 50);

    // ========== YOUR LOADOUT SLOTS (top) ==========
    const slotW = 140;
    const slotH = 100;
    const slotGap = 20;
    const totalSlots = crew.length + 1; // +1 for weapon
    const slotsTotal = totalSlots * slotW + (totalSlots - 1) * slotGap;
    const slotsStartX = CANVAS_WIDTH / 2 - slotsTotal / 2;
    const slotsY = 70;

    const buttons = [];

    // --- Crew slots ---
    for (let ci = 0; ci < crew.length; ci++) {
      const c = crew[ci];
      const sx = slotsStartX + ci * (slotW + slotGap);
      const hasRole = c.role !== null;
      const role = hasRole ? roleMap[c.role] : null;
      const slotKey = `slot_${ci}`;
      const isHovered = hoveredBtn === slotKey;

      ctx.fillStyle = hasRole ? role.bg : 'rgba(40, 40, 60, 0.8)';
      ctx.beginPath();
      this.roundRect(sx, slotsY, slotW, slotH, 10);
      ctx.fill();

      ctx.strokeStyle = hasRole ? role.color : (isHovered ? '#888' : '#555');
      ctx.lineWidth = hasRole ? 2 : (isHovered ? 2 : 1);
      if (hasRole) { ctx.shadowColor = role.color; ctx.shadowBlur = 8; }
      ctx.beginPath();
      this.roundRect(sx, slotsY, slotW, slotH, 10);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Slot label
      ctx.fillStyle = '#888';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`CREW ${ci + 1}`, sx + slotW / 2, slotsY + 13);

      if (hasRole) {
        ctx.font = '32px serif';
        ctx.textAlign = 'center';
        ctx.fillText(role.avatar, sx + slotW / 2, slotsY + 48);

        ctx.fillStyle = role.color;
        ctx.font = 'bold 11px monospace';
        ctx.fillText(role.title, sx + slotW / 2, slotsY + 68);

        ctx.fillStyle = '#aaa';
        ctx.font = '10px monospace';
        ctx.fillText(c.name || '', sx + slotW / 2, slotsY + 82);

        if (isHovered) {
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.beginPath();
          this.roundRect(sx, slotsY, slotW, slotH, 10);
          ctx.fill();
          ctx.fillStyle = '#f44';
          ctx.font = 'bold 11px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('\u2715 REMOVE', sx + slotW / 2, slotsY + slotH / 2 + 4);
        }
      } else {
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = isHovered ? '#aaa' : '#555';
        ctx.lineWidth = 1;
        ctx.beginPath();
        this.roundRect(sx + 8, slotsY + 20, slotW - 16, slotH - 28, 6);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = '#555';
        ctx.font = '11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('Empty', sx + slotW / 2, slotsY + 52);
      }

      if (hasRole) {
        buttons.push({ type: 'slot', crewIdx: ci, x: sx, y: slotsY, w: slotW, h: slotH, key: slotKey });
      }
    }

    // --- Weapon slot (Garlic) ---
    const weapX = slotsStartX + crew.length * (slotW + slotGap);
    const weapColor = '#8ecae6';

    ctx.fillStyle = 'rgba(40, 50, 60, 0.8)';
    ctx.beginPath();
    this.roundRect(weapX, slotsY, slotW, slotH, 10);
    ctx.fill();

    ctx.strokeStyle = weapColor + '88';
    ctx.lineWidth = 2;
    ctx.beginPath();
    this.roundRect(weapX, slotsY, slotW, slotH, 10);
    ctx.stroke();

    ctx.fillStyle = '#888';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('WEAPON', weapX + slotW / 2, slotsY + 13);

    ctx.font = '28px serif';
    ctx.fillText('\uD83D\uDCA8', weapX + slotW / 2, slotsY + 46);

    ctx.fillStyle = weapColor;
    ctx.font = 'bold 11px monospace';
    ctx.fillText('GARLIC', weapX + slotW / 2, slotsY + 66);

    ctx.fillStyle = '#777';
    ctx.font = '9px monospace';
    ctx.fillText('AOE aura', weapX + slotW / 2, slotsY + 80);
    ctx.fillText('Place after confirm', weapX + slotW / 2, slotsY + 92);

    // ========== CHARACTER ROSTER (bottom) ==========
    const cardW = 200;
    const cardH = 200;
    const cardGap = 30;
    const rosterTotal = roles.length * cardW + (roles.length - 1) * cardGap;
    const rosterStartX = CANVAS_WIDTH / 2 - rosterTotal / 2;
    const rosterY = slotsY + slotH + 20;

    for (let ri = 0; ri < roles.length; ri++) {
      const role = roles[ri];
      const rx = rosterStartX + ri * (cardW + cardGap);
      const btnKey = `roster_${role.id}`;
      const isHovered = hoveredBtn === btnKey;
      const assignedCount = crew.filter(c => c.role === role.id).length;
      const hasEmptySlot = crew.some(c => c.role === null);

      // Card background
      ctx.fillStyle = isHovered && hasEmptySlot ? role.bg : 'rgba(20, 22, 35, 0.95)';
      ctx.beginPath();
      this.roundRect(rx, rosterY, cardW, cardH, 10);
      ctx.fill();

      // Border
      ctx.strokeStyle = isHovered && hasEmptySlot ? role.color : '#444';
      ctx.lineWidth = isHovered && hasEmptySlot ? 2.5 : 1;
      ctx.beginPath();
      this.roundRect(rx, rosterY, cardW, cardH, 10);
      ctx.stroke();

      // Avatar
      ctx.font = '40px serif';
      ctx.textAlign = 'center';
      ctx.fillText(role.avatar, rx + cardW / 2, rosterY + 44);

      // Title
      ctx.fillStyle = role.color;
      ctx.font = 'bold 15px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(role.title, rx + cardW / 2, rosterY + 66);

      // Tagline
      ctx.fillStyle = '#666';
      ctx.font = '10px monospace';
      ctx.fillText(role.tagline, rx + cardW / 2, rosterY + 80);

      // Stat bars — visual comparison
      const barX = rx + 10;
      const barW = cardW - 20;
      const barStartY = rosterY + 94;
      const barGap = 18;

      this._drawStatBar(ctx, 'DAMAGE',    barX, barStartY,            barW, role.stats.damage,      5, '#e57373');
      this._drawStatBar(ctx, 'VS BANDIT', barX, barStartY + barGap,  barW, role.stats.banditSpeed,  5, '#81c784');

      // Assigned count badge
      if (assignedCount > 0) {
        const badgeX = rx + cardW - 18;
        const badgeY = rosterY + 14;
        ctx.beginPath();
        ctx.arc(badgeX, badgeY, 10, 0, Math.PI * 2);
        ctx.fillStyle = role.color;
        ctx.fill();
        ctx.fillStyle = '#000';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${assignedCount}`, badgeX, badgeY + 4);
      }

      // Dim if no empty slots
      if (!hasEmptySlot) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.beginPath();
        this.roundRect(rx, rosterY, cardW, cardH, 10);
        ctx.fill();
      }

      buttons.push({ type: 'roster', roleId: role.id, x: rx, y: rosterY, w: cardW, h: cardH, key: btnKey });
    }

    // ========== BOTTOM: CONFIRM BUTTON or HINT ==========
    const allChosen = crew.every(c => c.role !== null);
    const bottomY = rosterY + cardH + 16;

    if (allChosen) {
      // Confirm button
      const btnW = 200;
      const btnH = 44;
      const btnX = CANVAS_WIDTH / 2 - btnW / 2;
      const confirmKey = 'confirm';
      const confirmHovered = hoveredBtn === confirmKey;
      const pulse = 0.85 + Math.sin(now * 0.006) * 0.15;

      ctx.fillStyle = confirmHovered ? '#e09520' : `rgba(245, 166, 35, ${pulse})`;
      ctx.beginPath();
      this.roundRect(btnX, bottomY, btnW, btnH, 8);
      ctx.fill();
      if (confirmHovered) {
        ctx.shadowColor = '#f5a623';
        ctx.shadowBlur = 12;
      }
      ctx.strokeStyle = '#f5a623';
      ctx.lineWidth = 2;
      ctx.beginPath();
      this.roundRect(btnX, bottomY, btnW, btnH, 8);
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.fillStyle = '#000';
      ctx.font = 'bold 18px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('CONFIRM', CANVAS_WIDTH / 2, bottomY + btnH / 2 + 6);

      buttons.push({ type: 'confirm', x: btnX, y: bottomY, w: btnW, h: btnH, key: confirmKey });
    } else {
      ctx.fillStyle = '#777';
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('You can pick the same role twice!', CANVAS_WIDTH / 2, bottomY + 6);

      // Composition examples
      ctx.fillStyle = '#555';
      ctx.font = '10px monospace';
      const tipY = bottomY + 22;
      ctx.fillText('\uD83D\uDC31\uD83D\uDC31 = Max damage    \uD83D\uDC31\u26C4 = Balanced    \u26C4\u26C4 = Bandit-proof', CANVAS_WIDTH / 2, tipY);
    }

    return buttons;
  }

  drawDepartButton(x, y, w, h, hovered, disabled = false) {
    const ctx = this.ctx;
    if (disabled) {
      ctx.fillStyle = '#444';
      this.roundRect(x, y, w, h, 8);
      ctx.fill();
      ctx.fillStyle = '#777';
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('PLACE CREW FIRST', x + w / 2, y + h / 2 + 5);
    } else {
      ctx.fillStyle = hovered ? '#e09520' : '#f5a623';
      this.roundRect(x, y, w, h, 8);
      ctx.fill();
      ctx.fillStyle = '#000';
      ctx.font = 'bold 18px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('DEPART', x + w / 2, y + h / 2 + 6);
    }
  }

  // =============================================
  // AUTO-WEAPON HUD
  // =============================================
  _drawLevelPips(ctx, x, y, level, color) {
    for (let l = 0; l < 5; l++) {
      ctx.fillStyle = l < level ? color : '#333';
      ctx.fillRect(x + 4 + l * 8, y + 28, 6, 3);
    }
  }

  _drawSlotBox(ctx, x, y, w, h, filled, borderColor) {
    ctx.fillStyle = filled ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.2)';
    this.roundRect(x, y, w, h, 4);
    ctx.fill();
    ctx.strokeStyle = borderColor || (filled ? '#555' : '#444');
    ctx.lineWidth = 1;
    if (!filled) ctx.setLineDash([3, 2]);
    this.roundRect(x, y, w, h, 4);
    ctx.stroke();
    if (!filled) ctx.setLineDash([]);
  }

  drawAutoWeaponHUD(train) {
    const ctx = this.ctx;
    const startX = 16;
    const slotW = 48;
    const slotH = 34;
    const gap = 6;
    // --- CREW ROW (top) ---
    const crewY = CANVAS_HEIGHT - 130;
    ctx.fillStyle = '#ccc';
    ctx.font = 'bold 8px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('CREW', startX, crewY - 3);

    for (let i = 0; i < train.crew.length; i++) {
      const x = startX + i * (slotW + gap);
      const c = train.crew[i];
      // Filled crew slot
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      this.roundRect(x, crewY, slotW, slotH, 4);
      ctx.fill();
      ctx.strokeStyle = c.color;
      ctx.lineWidth = 1.5;
      this.roundRect(x, crewY, slotW, slotH, 4);
      ctx.stroke();
      // Name
      ctx.font = 'bold 8px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = c.color;
      ctx.fillText(c.name ?? `Crew ${i}`, x + slotW / 2, crewY + 10);
      // Role name
      if (c.role) {
        ctx.font = '6px monospace';
        ctx.fillStyle = c.color;
        ctx.globalAlpha = 0.7;
        ctx.fillText(c.role.toUpperCase(), x + slotW / 2, crewY + 18);
        ctx.globalAlpha = 1;
      }
      // Gun icon + level
      ctx.font = '10px monospace';
      ctx.fillStyle = c.color;
      ctx.fillText('\uD83D\uDD2B', x + slotW / 2, crewY + 28);
      this._drawLevelPips(ctx, x + 2, crewY + 1, c.gunLevel, c.color);
    }

    // --- WEAPONS ROW (middle, auto-weapons only) ---
    const weapY = CANVAS_HEIGHT - 84;
    ctx.fillStyle = '#ccc';
    ctx.font = 'bold 8px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('WEAPONS', startX, weapY - 3);

    if (!train._autoWeaponEntries || train._autoWeaponEntriesLen !== train.autoWeaponCount) {
      train._autoWeaponEntries = Object.entries(train.autoWeapons);
      train._autoWeaponEntriesLen = train.autoWeaponCount;
    }
    const equippedAutos = train._autoWeaponEntries;
    for (let i = 0; i < train.maxAutoWeapons; i++) {
      const x = startX + i * (slotW + gap);
      const entry = equippedAutos[i];
      this._drawSlotBox(ctx, x, weapY, slotW, slotH, !!entry);
      if (entry) {
        const [id, w] = entry;
        const def = AUTO_WEAPONS[id];
        ctx.font = '14px monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = def.color;
        const autoIcon = id === 'turret' ? '\uD83E\uDD16' : def.icon;
        ctx.fillText(autoIcon, x + slotW / 2, weapY + 16);
        this._drawLevelPips(ctx, x + 2, weapY + 1, w.level, def.color);
      }
    }

    // --- DEFENSE ROW (bottom) ---
    const defY = CANVAS_HEIGHT - 40;
    ctx.fillStyle = '#ccc';
    ctx.font = 'bold 8px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('DEFENSE', startX, defY - 3);

    for (let i = 0; i < train.maxDefenseSlots; i++) {
      const x = startX + i * (slotW + gap);
      const def = train.defenseSlots[i];
      this._drawSlotBox(ctx, x, defY, slotW, slotH, !!def, def?.color);
      if (def) {
        ctx.font = '14px monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = def.color;
        ctx.fillText(def.icon, x + slotW / 2, defY + 16);
        this._drawLevelPips(ctx, x + 2, defY + 1, def.level, def.color);
      }
    }
  }

  // =============================================
  // LEVEL UP MENU
  // =============================================
  drawLevelUpMenu(level, powerups, hoveredIndex, train) {
    const ctx = this.ctx;

    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.fillStyle = '#f5a623';
    ctx.font = 'bold 32px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`LEVEL ${level}!`, CANVAS_WIDTH / 2, 120);

    ctx.fillStyle = '#ccc';
    ctx.font = '16px monospace';
    ctx.fillText('Choose a powerup:', CANVAS_WIDTH / 2, 155);

    const cardW = 200;
    const cardH = 200;
    const gap = 24;
    const totalW = powerups.length * cardW + (powerups.length - 1) * gap;
    const startX = CANVAS_WIDTH / 2 - totalW / 2;
    const cardY = 180;

    for (let i = 0; i < powerups.length; i++) {
      const p = powerups[i];
      const cx = startX + i * (cardW + gap);
      const isHovered = hoveredIndex === i;
      const hasCrew = !!p.crewColor;

      // Card background
      ctx.fillStyle = isHovered ? '#3a3a5a' : '#2a2a3a';
      this.roundRect(cx, cardY, cardW, cardH, 10);
      ctx.fill();

      // Border — use crew color for crew cards, default for others
      if (hasCrew) {
        ctx.strokeStyle = isHovered ? p.crewColor : p.crewColor + '88';
        ctx.lineWidth = isHovered ? 3 : 2;
      } else {
        ctx.strokeStyle = isHovered ? '#f5a623' : '#555';
        ctx.lineWidth = isHovered ? 3 : 1;
      }
      this.roundRect(cx, cardY, cardW, cardH, 10);
      ctx.stroke();

      // Crew color bar at top of card
      if (hasCrew) {
        ctx.fillStyle = p.crewColor;
        ctx.beginPath();
        this.roundRect(cx, cardY, cardW, 6, 10);
        ctx.fill();
      }

      // Icon
      ctx.font = '40px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = p.color;
      ctx.fillText(p.icon, cx + cardW / 2, cardY + 55);

      // Role label below icon (for crew cards)
      if (hasCrew && p.roleLabel) {
        const roleColor = p.roleLabel === 'Gunner' ? '#ffb74d' : '#66bb6a';
        ctx.fillStyle = roleColor;
        ctx.font = 'bold 9px monospace';
        ctx.fillText(p.roleLabel.toUpperCase(), cx + cardW / 2, cardY + 68);
      }

      // Name
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px monospace';
      ctx.fillText(p.name, cx + cardW / 2, cardY + 90);

      // Description (word-wrap)
      ctx.fillStyle = '#aaa';
      ctx.font = '12px monospace';
      const words = p.desc.split(' ');
      let line = '';
      let lineY = cardY + 115;
      for (const word of words) {
        const test = line + word + ' ';
        if (ctx.measureText(test).width > cardW - 20) {
          ctx.fillText(line.trim(), cx + cardW / 2, lineY);
          line = word + ' ';
          lineY += 16;
        } else {
          line = test;
        }
      }
      if (line.trim()) ctx.fillText(line.trim(), cx + cardW / 2, lineY);

      p._x = cx;
      p._y = cardY;
      p._w = cardW;
      p._h = cardH;
    }

    // Existing HUD slots (CREW/WEAPONS/DEFENSE) are drawn by caller via drawAutoWeaponHUD
  }

  // =============================================
  // GAME OVER
  // =============================================
  drawGameOver(won, train, goldEarned, buttons, input, gameOverType = 'death', totalGold = 0) {
    const ctx = this.ctx;
    const cx = CANVAS_WIDTH / 2;
    const cy = CANVAS_HEIGHT / 2;
    const t = performance.now() * 0.001;

    // Background
    if (gameOverType === 'world') {
      // Golden gradient background for world complete
      const grad = ctx.createRadialGradient(cx, cy, 50, cx, cy, 400);
      grad.addColorStop(0, 'rgba(80, 50, 0, 0.95)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0.95)');
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
    }
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    if (gameOverType === 'world') {
      // === WORLD COMPLETE — treasure celebration ===

      // Animated golden glow
      const glowR = 120 + Math.sin(t * 2) * 20;
      const glow = ctx.createRadialGradient(cx, cy - 60, 10, cx, cy - 60, glowR);
      glow.addColorStop(0, 'rgba(245, 166, 35, 0.3)');
      glow.addColorStop(1, 'rgba(245, 166, 35, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // Treasure chest
      const chestX = cx, chestY = cy - 40;
      // Chest body
      ctx.fillStyle = '#8B4513';
      this.roundRect(chestX - 40, chestY - 10, 80, 50, 6);
      ctx.fill();
      ctx.strokeStyle = '#5a2d0c';
      ctx.lineWidth = 2;
      this.roundRect(chestX - 40, chestY - 10, 80, 50, 6);
      ctx.stroke();
      // Chest lid
      ctx.fillStyle = '#a0522d';
      ctx.beginPath();
      ctx.moveTo(chestX - 42, chestY - 10);
      ctx.quadraticCurveTo(chestX, chestY - 35, chestX + 42, chestY - 10);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#5a2d0c';
      ctx.stroke();
      // Gold clasp
      ctx.fillStyle = '#f5a623';
      ctx.fillRect(chestX - 8, chestY - 5, 16, 12);
      ctx.strokeStyle = '#c88a1a';
      ctx.strokeRect(chestX - 8, chestY - 5, 16, 12);
      // Gold coins spilling out
      for (let i = 0; i < 8; i++) {
        const coinX = chestX - 30 + i * 9 + Math.sin(t * 2 + i) * 3;
        const coinY = chestY - 18 - Math.abs(Math.sin(t * 1.5 + i * 0.8)) * 6;
        ctx.beginPath();
        ctx.arc(coinX, coinY, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#f5a623';
        ctx.fill();
        ctx.strokeStyle = '#c88a1a';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Title
      const pulse = 1 + Math.sin(t * 3) * 0.05;
      ctx.save();
      ctx.translate(cx, cy - 100);
      ctx.scale(pulse, pulse);
      ctx.fillStyle = '#f5a623';
      ctx.font = 'bold 48px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('WORLD COMPLETE!', 0, 0);
      ctx.strokeStyle = '#c88a1a';
      ctx.lineWidth = 1;
      ctx.strokeText('WORLD COMPLETE!', 0, 0);
      ctx.restore();

      // Subtitle
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 20px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('All cargo delivered!', cx, cy + 20);
      ctx.fillStyle = '#c8a96e';
      ctx.font = '14px monospace';
      ctx.fillText(`The supplies reached Eastport. ${goldEarned} lives saved.`, cx, cy + 40);

      // Gold breakdown
      ctx.fillStyle = '#aaa';
      ctx.font = '14px monospace';
      ctx.fillText(`World completion bonus`, cx, cy + 65);

      ctx.fillStyle = '#f5a623';
      ctx.font = 'bold 24px monospace';
      ctx.fillText(`+${goldEarned} Gold`, cx, cy + 90);

      // Total treasury
      ctx.fillStyle = '#c8a96e';
      ctx.font = 'bold 18px monospace';
      ctx.fillText(`Treasury: ${totalGold} Gold`, cx, cy + 118);

    } else if (gameOverType === 'zone') {
      // === ZONE WIN — delivered celebration ===

      // Star burst behind title
      ctx.save();
      ctx.translate(cx, cy - 70);
      ctx.globalAlpha = 0.15;
      const rays = 12;
      for (let i = 0; i < rays; i++) {
        const angle = (i / rays) * Math.PI * 2 + t * 0.3;
        ctx.fillStyle = '#f5a623';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(angle - 0.08) * 200, Math.sin(angle - 0.08) * 200);
        ctx.lineTo(Math.cos(angle + 0.08) * 200, Math.sin(angle + 0.08) * 200);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.restore();

      // Title
      ctx.fillStyle = '#2ecc71';
      ctx.font = 'bold 44px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('DELIVERED!', cx, cy - 70);

      // Subtitle
      ctx.fillStyle = '#8fbc8f';
      ctx.font = '16px monospace';
      ctx.fillText('Cargo delivered safely through the wasteland!', cx, cy - 38);

      // Gold breakdown with animated counter effect
      const mult = train.cargoMultiplier;
      ctx.fillStyle = '#aaa';
      ctx.font = '14px monospace';
      ctx.fillText(`Gold collected: ${train.runGold}`, cx, cy - 8);
      ctx.fillText(`Cargo delivery bonus: x${mult.toFixed(1)}`, cx, cy + 12);

      ctx.fillStyle = '#f5a623';
      ctx.font = 'bold 28px monospace';
      ctx.fillText(`+${goldEarned} Gold`, cx, cy + 55);

      // Coal reward
      ctx.fillStyle = '#555';
      ctx.font = 'bold 14px monospace';
      ctx.fillText('+2 Coal', cx, cy + 78);

    } else if (gameOverType === 'combat') {
      // === COMBAT WIN ===
      ctx.fillStyle = '#f5a623';
      ctx.font = 'bold 40px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('STATION CLEARED!', cx, cy - 70);

      ctx.fillStyle = '#ccc';
      ctx.font = '16px monospace';
      ctx.fillText('The train pushes on through the wasteland.', cx, cy - 35);

      ctx.fillStyle = '#f5a623';
      ctx.font = 'bold 24px monospace';
      ctx.fillText(`+${goldEarned} Gold`, cx, cy + 10);

      ctx.fillStyle = '#555';
      ctx.font = 'bold 14px monospace';
      ctx.fillText('+2 Coal', cx, cy + 35);

    } else {
      // === DEATH ===
      ctx.fillStyle = '#e74c3c';
      ctx.font = 'bold 44px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('TRAIN DESTROYED', cx, cy - 70);

      ctx.fillStyle = '#cc8888';
      ctx.font = '15px monospace';
      ctx.fillText('The cargo was lost to the wasteland...', cx, cy - 38);

      ctx.fillStyle = '#aa6666';
      ctx.font = 'italic 14px monospace';
      ctx.fillText('The train never arrived.', cx, cy - 18);

      ctx.fillStyle = '#fff';
      ctx.font = '16px monospace';
      const pct = Math.floor(train.distance / TARGET_DISTANCE * 100);
      ctx.fillText(`Distance: ${pct}%  |  Level: ${train.level}`, cx, cy + 8);

      ctx.fillStyle = '#ccc';
      ctx.font = '14px monospace';
      ctx.fillText(`Gold salvaged: ${train.runGold}  (cargo lost)`, cx, cy + 28);

      ctx.fillStyle = '#f5a623';
      ctx.font = 'bold 24px monospace';
      ctx.fillText(`+${goldEarned} Gold`, cx, cy + 54);
    }

    const btnY = gameOverType === 'world' ? cy + 140 : cy + 70;

    if (gameOverType === 'zone') {
      const nextBtn = buttons.nextZone;
      nextBtn.x = cx - 80;
      nextBtn.y = btnY;
      nextBtn.w = 160;
      const h = input.hitRect(nextBtn.x, nextBtn.y, nextBtn.w, nextBtn.h);
      ctx.fillStyle = h ? '#e09520' : '#f5a623';
      ctx.strokeStyle = 'transparent';
      ctx.lineWidth = 0;
      this.roundRect(nextBtn.x, nextBtn.y, nextBtn.w, nextBtn.h, 8);
      ctx.fill();
      ctx.fillStyle = '#000';
      ctx.font = 'bold 15px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('NEXT ZONE', nextBtn.x + nextBtn.w / 2, nextBtn.y + nextBtn.h / 2 + 5);
    } else {
      const btn = buttons.continue;
      btn.y = btnY;
      const h = input.hitRect(btn.x, btn.y, btn.w, btn.h);
      ctx.fillStyle = h ? '#3a3a5a' : '#2a2a3a';
      ctx.strokeStyle = h ? '#f5a623' : '#555';
      ctx.lineWidth = h ? 2 : 1;
      this.roundRect(btn.x, btn.y, btn.w, btn.h, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = h ? '#f5a623' : '#ccc';
      ctx.font = 'bold 16px monospace';
      ctx.textAlign = 'center';
      const label = gameOverType === 'world' ? 'NEW WORLD' : gameOverType === 'combat' ? 'CONTINUE' : 'MAIN MENU';
      ctx.fillText(label, btn.x + btn.w / 2, btn.y + btn.h / 2 + 5);
    }
  }

  // =============================================
  // ARMORY — permanent upgrade screen (start-screen only)
  // =============================================
  drawArmory(save, upgradeKeys, hoveredIndex, closeBtn, input, kbOnDepart = false) {
    const ctx = this.ctx;
    const cx = CANVAS_WIDTH / 2;

    // Background — deep military/headquarters feel
    ctx.fillStyle = '#0c0e0a';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Subtle grid overlay
    ctx.strokeStyle = 'rgba(60,80,40,0.18)';
    ctx.lineWidth = 1;
    for (let x = 0; x < CANVAS_WIDTH; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CANVAS_HEIGHT); ctx.stroke(); }
    for (let y = 0; y < CANVAS_HEIGHT; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CANVAS_WIDTH, y); ctx.stroke(); }

    // Header bar
    ctx.fillStyle = '#141a10';
    ctx.fillRect(0, 0, CANVAS_WIDTH, 72);
    ctx.strokeStyle = '#3a5028';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, CANVAS_WIDTH, 72);

    ctx.fillStyle = '#8fcf60';
    ctx.font = 'bold 30px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('⚡ ARMORY', 32, 44);

    ctx.fillStyle = '#556644';
    ctx.font = '13px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('Permanent upgrades — persist across all runs', CANVAS_WIDTH - 32, 32);

    // Gold display
    ctx.fillStyle = '#f5a623';
    ctx.font = 'bold 18px monospace';
    ctx.fillText(`${save.gold} Gold`, CANVAS_WIDTH - 32, 56);

    // Upgrade rows
    const rowH = 52;
    const rowGap = 6;
    const startY = 90;
    const rowX = 32;
    const rowW = CANVAS_WIDTH - 64;

    for (let i = 0; i < upgradeKeys.length; i++) {
      const key = upgradeKeys[i];
      const u = save.upgrades[key];
      const y = startY + i * (rowH + rowGap);
      const isHovered = hoveredIndex === i;
      const maxed = u.level >= u.maxLevel;
      const cost = u.cost * (u.level + 1);
      const canAfford = !maxed && save.gold >= cost;

      u._y = y;

      // Row background with left accent stripe
      ctx.fillStyle = isHovered ? '#161e10' : '#101408';
      this.roundRect(rowX, y, rowW, rowH, 5);
      ctx.fill();
      ctx.strokeStyle = isHovered ? u.color : 'rgba(60,80,40,0.5)';
      ctx.lineWidth = isHovered ? 1.5 : 1;
      this.roundRect(rowX, y, rowW, rowH, 5);
      ctx.stroke();

      // Left accent stripe
      ctx.fillStyle = u.color;
      ctx.globalAlpha = isHovered ? 0.7 : 0.35;
      ctx.fillRect(rowX, y, 4, rowH);
      ctx.globalAlpha = 1;

      // Icon
      ctx.font = '20px monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = u.color;
      ctx.fillText(u.icon, rowX + 16, y + rowH / 2 + 7);

      // Name + description
      ctx.fillStyle = isHovered ? '#e0e8d0' : '#a0b080';
      ctx.font = `bold 14px monospace`;
      ctx.fillText(u.name, rowX + 50, y + 22);
      ctx.fillStyle = '#506040';
      ctx.font = '11px monospace';
      ctx.fillText(u.desc, rowX + 50, y + 38);

      // Level pips
      const pipX = rowX + rowW - 280;
      if (key === 'crewSlots') {
        ctx.fillStyle = u.color;
        ctx.font = 'bold 13px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${1 + u.level} crew`, pipX + 40, y + rowH / 2 + 5);
        ctx.textAlign = 'left';
      } else {
        for (let l = 0; l < u.maxLevel; l++) {
          const px = pipX + l * 22;
          const filled = l < u.level;
          ctx.fillStyle = filled ? u.color : '#1e2818';
          ctx.strokeStyle = filled ? u.color : '#2a3820';
          ctx.lineWidth = 1;
          this.roundRect(px, y + 16, 16, 16, 3);
          ctx.fill();
          ctx.stroke();
          if (filled) {
            ctx.fillStyle = '#000';
            ctx.font = 'bold 11px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('✓', px + 8, y + 28);
            ctx.textAlign = 'left';
          }
        }
      }

      // Cost / buy button on right
      const buyX = rowX + rowW - 90;
      const buyY = y + 10;
      const buyW = 78;
      const buyH = rowH - 20;
      if (maxed) {
        ctx.fillStyle = '#1a2214';
        this.roundRect(buyX, buyY, buyW, buyH, 4);
        ctx.fill();
        ctx.fillStyle = '#3a5030';
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('MAXED', buyX + buyW / 2, buyY + buyH / 2 + 5);
      } else {
        ctx.fillStyle = canAfford ? (isHovered ? '#1e3010' : '#162008') : '#200e08';
        ctx.strokeStyle = canAfford ? (isHovered ? '#8fcf60' : '#4a7030') : '#6a2010';
        ctx.lineWidth = canAfford && isHovered ? 1.5 : 1;
        this.roundRect(buyX, buyY, buyW, buyH, 4);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = canAfford ? (isHovered ? '#a0e060' : '#6a9040') : '#9a4020';
        ctx.font = 'bold 13px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${cost}g`, buyX + buyW / 2, buyY + buyH / 2 + 5);
      }
      ctx.textAlign = 'left';
    }

    // Close button
    const hClose = input.hitRect(closeBtn.x, closeBtn.y, closeBtn.w, closeBtn.h) || kbOnDepart;
    ctx.fillStyle = hClose ? '#1a1e28' : '#10121c';
    ctx.strokeStyle = hClose ? '#5588cc' : '#203050';
    ctx.lineWidth = hClose ? 2 : 1;
    this.roundRect(closeBtn.x, closeBtn.y, closeBtn.w, closeBtn.h, 7);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = hClose ? '#88aadd' : '#506070';
    ctx.font = 'bold 15px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('← BACK TO MENU', closeBtn.x + closeBtn.w / 2, closeBtn.y + closeBtn.h / 2 + 6);
  }

  // =============================================
  // SHOP (legacy — no longer used in main game)
  // =============================================
  drawShop(save, upgradeKeys, hoveredIndex, mapBtn, nextBtn, input, kbOnDepart = false) {
    const ctx = this.ctx;

    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.fillStyle = '#f5a623';
    ctx.font = 'bold 32px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('UPGRADE SHOP', CANVAS_WIDTH / 2, 50);

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px monospace';
    ctx.fillText(`Gold: ${save.gold}`, CANVAS_WIDTH / 2, 85);

    const rowH = 44;
    const startY = 110;
    const rowX = 80;
    const rowW = CANVAS_WIDTH - 160;

    for (let i = 0; i < upgradeKeys.length; i++) {
      const key = upgradeKeys[i];
      const u = save.upgrades[key];
      const y = startY + i * (rowH + 6);
      const isHovered = hoveredIndex === i;
      const maxed = u.level >= u.maxLevel;
      const cost = u.cost * (u.level + 1);
      const canAfford = !maxed && save.gold >= cost;

      u._y = y;

      ctx.fillStyle = isHovered ? '#2a2a4a' : '#1e1e2e';
      ctx.strokeStyle = isHovered ? '#f5a623' : '#333';
      ctx.lineWidth = isHovered ? 2 : 1;
      this.roundRect(rowX, y, rowW, rowH, 6);
      ctx.fill();
      ctx.stroke();

      ctx.font = '18px monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = u.color;
      ctx.fillText(u.icon, rowX + 12, y + 28);

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px monospace';
      ctx.fillText(u.name, rowX + 40, y + 20);

      ctx.fillStyle = '#888';
      ctx.font = '11px monospace';
      ctx.fillText(u.desc, rowX + 40, y + 35);

      const checkX = rowX + rowW - 200;
      if (key === 'crewSlots') {
        ctx.fillStyle = u.color;
        ctx.font = 'bold 13px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${1 + u.level} crew`, checkX + 20, y + 26);
        ctx.textAlign = 'left';
      } else {
        for (let l = 0; l < u.maxLevel; l++) {
          const cx = checkX + l * 22;
          ctx.fillStyle = l < u.level ? u.color : '#333';
          ctx.strokeStyle = l < u.level ? u.color : '#555';
          ctx.lineWidth = 1;
          this.roundRect(cx, y + 12, 18, 18, 3);
          ctx.fill();
          ctx.stroke();
          if (l < u.level) {
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 12px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('\u2713', cx + 9, y + 26);
            ctx.textAlign = 'left';
          }
        }
      }

      ctx.textAlign = 'right';
      if (maxed) {
        ctx.fillStyle = '#666';
        ctx.font = 'bold 12px monospace';
        ctx.fillText('MAX', rowX + rowW - 12, y + 28);
      } else {
        ctx.fillStyle = canAfford ? '#f5a623' : '#e74c3c';
        ctx.font = 'bold 12px monospace';
        ctx.fillText(`${cost}g`, rowX + rowW - 12, y + 28);
      }
      ctx.textAlign = 'left';
    }

    // Coal purchase row
    const coalY = startY + upgradeKeys.length * (rowH + 6);
    const coalIdx = upgradeKeys.length;
    const coalHovered = hoveredIndex === coalIdx;
    const coalFull = save.coal >= save.maxCoal;
    const coalCanAfford = !coalFull && save.gold >= COAL_SHOP_COST;

    ctx.fillStyle = coalHovered ? '#2a3a2a' : '#1e2e1e';
    ctx.strokeStyle = coalHovered ? '#f5a623' : '#333';
    ctx.lineWidth = coalHovered ? 2 : 1;
    this.roundRect(rowX, coalY, rowW, rowH, 6);
    ctx.fill();
    ctx.stroke();

    ctx.font = '18px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#555';
    ctx.fillText('\u2B1B', rowX + 12, coalY + 28);

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px monospace';
    ctx.fillText('Buy Coal', rowX + 40, coalY + 20);

    ctx.fillStyle = '#888';
    ctx.font = '11px monospace';
    ctx.fillText(`+${COAL_SHOP_AMOUNT} coal (${save.coal}/${save.maxCoal})`, rowX + 40, coalY + 35);

    ctx.textAlign = 'right';
    if (coalFull) {
      ctx.fillStyle = '#666';
      ctx.font = 'bold 12px monospace';
      ctx.fillText('FULL', rowX + rowW - 12, coalY + 28);
    } else {
      ctx.fillStyle = coalCanAfford ? '#f5a623' : '#e74c3c';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(`${COAL_SHOP_COST}g`, rowX + rowW - 12, coalY + 28);
    }
    ctx.textAlign = 'left';

    const mapH = input.hitRect(mapBtn.x, mapBtn.y, mapBtn.w, mapBtn.h);
    ctx.fillStyle = mapH ? '#555' : '#333';
    this.roundRect(mapBtn.x, mapBtn.y, mapBtn.w, mapBtn.h, 8);
    ctx.fill();
    ctx.fillStyle = mapH ? '#fff' : '#aaa';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('BACK TO MAP', mapBtn.x + mapBtn.w / 2, mapBtn.y + mapBtn.h / 2 + 5);

    const nextH = input.hitRect(nextBtn.x, nextBtn.y, nextBtn.w, nextBtn.h) || kbOnDepart;
    ctx.fillStyle = nextH ? '#e09520' : '#f5a623';
    ctx.strokeStyle = kbOnDepart ? '#fff' : 'transparent';
    ctx.lineWidth = 2;
    this.roundRect(nextBtn.x, nextBtn.y, nextBtn.w, nextBtn.h, 8);
    ctx.fill();
    if (kbOnDepart) ctx.stroke();
    ctx.fillStyle = '#000';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('NEXT ZONE', nextBtn.x + nextBtn.w / 2, nextBtn.y + nextBtn.h / 2 + 5);
  }

  // =============================================
  // PAUSE MENU
  // =============================================
  drawPauseMenu(buttons, input, kbIndex = 0) {
    const ctx = this.ctx;

    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.fillStyle = '#f5a623';
    ctx.font = 'bold 40px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('PAUSED', CANVAS_WIDTH / 2, 200);

    const btnDefs = [
      { key: 'resume',  label: 'RESUME',  btn: buttons.resume },
      { key: 'restart', label: 'RESTART', btn: buttons.restart },
      { key: 'quit',    label: 'QUIT',    btn: buttons.quit },
    ];

    for (let i = 0; i < btnDefs.length; i++) {
      const { label, btn } = btnDefs[i];
      const hovered = input.hitRect(btn.x, btn.y, btn.w, btn.h) || i === kbIndex;
      ctx.fillStyle = hovered ? '#3a3a5a' : '#2a2a3a';
      ctx.strokeStyle = hovered ? '#f5a623' : '#555';
      ctx.lineWidth = hovered ? 2 : 1;
      this.roundRect(btn.x, btn.y, btn.w, btn.h, 8);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = hovered ? '#f5a623' : '#ccc';
      ctx.font = 'bold 18px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(label, btn.x + btn.w / 2, btn.y + btn.h / 2 + 6);
    }

    ctx.fillStyle = '#666';
    ctx.font = '12px monospace';
    ctx.fillText('Press ESC to resume', CANVAS_WIDTH / 2, 470);
  }

  // =============================================
  // ZONE MAP
  // =============================================
  drawZoneMap(zone, input, save) {
    const ctx = this.ctx;
    const W = CANVAS_WIDTH;
    const H = CANVAS_HEIGHT;

    // Background — sandy terrain
    ctx.fillStyle = '#6b5c3e';
    ctx.fillRect(0, 0, W, H);
    // Subtle sand texture
    ctx.fillStyle = '#7a6b48';
    for (let i = 0; i < 80; i++) {
      const px = (i * 173 + 41) % W;
      const py = (i * 131 + i * i * 7) % H;
      ctx.fillRect(px, py, 30 + (i % 20), 20 + (i % 15));
    }

    // Title
    ctx.fillStyle = '#c8a96e';
    ctx.font = 'bold 24px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`ZONE ${zone.difficulty} \u2014 RAIL MAP`, W / 2, 28);

    // Flavor subtitle
    ctx.fillStyle = '#d4c4a0';
    ctx.font = '13px monospace';
    ctx.fillText('Deliver the cargo. Survive the wasteland.', W / 2, 46);

    // Coal display
    ctx.fillStyle = '#aaa';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'left';
    const coalFull = '\u2B1B'.repeat(zone.coal);
    const coalEmpty = '\u2B1C'.repeat(zone.maxCoal - zone.coal);
    ctx.fillText(`Coal ${coalFull}${coalEmpty} ${zone.coal}/${zone.maxCoal}`, 16, 32);

    // Gold display
    ctx.textAlign = 'right';
    ctx.fillStyle = '#f5a623';
    ctx.fillText(`Gold: ${this._zoneGold || 0}`, W - 16, 32);

    const pad = 60;
    const mapW = W - pad * 2;
    const mapH = H - 100;
    const mapY = 55;

    const sx = (s) => pad + s.x * mapW;
    const sy = (s) => mapY + s.y * mapH;

    // Precompute zombie positions once per zone difficulty
    if (!this._zombieCache || this._zombieCacheDiff !== zone.difficulty) {
      const count = 20 + zone.difficulty * 5;
      this._zombieCache = [];
      this._zombieCacheDiff = zone.difficulty;
      for (let i = 0; i < count; i++) {
        const seed1 = (i * 7919 + 1301) % 9973;
        const seed2 = (i * 6271 + 3571) % 9973;
        // Bias X toward the right (harder end) — more creatures near exit
        const rawX = seed1 / 9973;
        const biasedX = 1 - (1 - rawX) * (1 - rawX);
        const xPos = 20 + biasedX * (W - 40);
        this._zombieCache.push({
          x: xPos,
          y: 60 + (seed2 / 9973) * (H - 100),
          alpha: 0.6 + (i % 5) * 0.08,
          font: `${10 + (i % 4) * 3}px serif`,
          emoji: (seed1 + seed2) % 5 === 0 ? '\uD83E\uDD9F' : '\uD83E\uDDDF',
          swayOffset: i * 1.7,
        });
      }
    }
    ctx.textAlign = 'center';
    const t = performance.now() * 0.001;
    for (const z of this._zombieCache) {
      const sway = Math.sin(t * 0.8 + z.swayOffset) * 2;
      ctx.globalAlpha = z.alpha;
      ctx.font = z.font;
      ctx.fillText(z.emoji, z.x + sway, z.y);
    }
    ctx.globalAlpha = 1;

    // Draw rail tracks (connections)
    for (const station of zone.stations) {
      for (const cid of station.connections) {
        if (cid <= station.id) continue;
        const other = zone.stations[cid];
        const x1 = sx(station), y1 = sy(station);
        const x2 = sx(other), y2 = sy(other);
        const visited = station.visited && other.visited;
        const canReach = (station.id === zone.currentStation && zone.canTravelTo(cid)) ||
                         (other.id === zone.currentStation && zone.canTravelTo(station.id));

        ctx.strokeStyle = visited ? '#6b5a3e' : canReach ? '#5a4a30' : '#3a3020';
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
        ctx.stroke();

        const dx = x2 - x1, dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 1) continue;
        const nx = -dy / len * 2.5, ny = dx / len * 2.5;
        ctx.strokeStyle = visited ? '#999' : canReach ? '#777' : '#555';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x1 + nx, y1 + ny); ctx.lineTo(x2 + nx, y2 + ny);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x1 - nx, y1 - ny); ctx.lineTo(x2 - nx, y2 - ny);
        ctx.stroke();

        const sleeperSpacing = 14;
        const steps = Math.floor(len / sleeperSpacing);
        ctx.strokeStyle = visited ? '#7a6a4e' : '#4a3a28';
        ctx.lineWidth = 2;
        for (let s = 1; s < steps; s++) {
          const t = s / steps;
          const px = x1 + dx * t, py = y1 + dy * t;
          ctx.beginPath();
          ctx.moveTo(px + nx * 2, py + ny * 2);
          ctx.lineTo(px - nx * 2, py - ny * 2);
          ctx.stroke();
        }
      }
    }

    // Draw stations as buildings
    const hoveredStation = this._findHoveredStation(zone, input, sx, sy);

    for (const station of zone.stations) {
      const x = sx(station);
      const y = sy(station);
      const isCurrent = station.id === zone.currentStation;
      const isHovered = station.id === hoveredStation || station.id === this._kbHighlightStation;
      const canTravel = zone.canTravelTo(station.id);
      const isEnd = station.type === 'exit';
      const isStart = station.type === 'start';

      const bw = isEnd ? 28 : isStart ? 24 : 20;
      const bh = isEnd ? 22 : isStart ? 18 : 16;

      if (canTravel && !isCurrent) {
        ctx.shadowColor = isHovered ? '#f5a623' : '#f5a62366';
        ctx.shadowBlur = isHovered ? 16 : 8;
      }

      if (isCurrent) {
        ctx.fillStyle = '#f5a623';
      } else if (station.visited) {
        ctx.fillStyle = '#5a5040';
      } else {
        ctx.fillStyle = '#6b5a48';
      }
      ctx.fillRect(x - bw / 2, y - bh / 2, bw, bh);

      ctx.fillStyle = isCurrent ? '#c88a1a' : station.visited ? '#4a4030' : '#8b7355';
      ctx.beginPath();
      ctx.moveTo(x - bw / 2 - 3, y - bh / 2);
      ctx.lineTo(x, y - bh / 2 - 8);
      ctx.lineTo(x + bw / 2 + 3, y - bh / 2);
      ctx.closePath();
      ctx.fill();

      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;

      ctx.strokeStyle = isCurrent ? '#fff' : canTravel ? '#f5a623' : '#555';
      ctx.lineWidth = isCurrent ? 2 : 1;
      ctx.strokeRect(x - bw / 2, y - bh / 2, bw, bh);

      if (isEnd) {
        ctx.fillStyle = '#2ecc71';
        ctx.fillRect(x + bw / 2 + 2, y - bh / 2 - 8, 2, 18);
        ctx.fillRect(x + bw / 2 + 4, y - bh / 2 - 8, 8, 6);
      }

      ctx.fillStyle = isCurrent ? '#000' : '#ddd';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      if (isStart) ctx.fillText('DEP', x, y + 3);
      else if (isEnd) ctx.fillText('ARR', x, y + 3);
      else if (station.type === 'empty' && !station.visited) {
        ctx.fillStyle = '#888';
        ctx.fillText('?', x, y + 3);
      }

      if (isCurrent) {
        ctx.fillStyle = '#e74c3c';
        ctx.font = '12px monospace';
        ctx.fillText('\uD83D\uDE82', x, y - bh / 2 - 12);
      }

      // Modifier label below combat stations (only if revealed)
      if (station.modifier && station.revealed && station.type === 'combat') {
        const mod = station.modifier;
        ctx.font = 'bold 8px monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = station.visited ? '#666' : mod.color;
        ctx.fillText(mod.name.toUpperCase(), x, y + bh / 2 + 10);
      }
    }

    // Settings button
    const settingsBtn = { x: W - 110, y: 44, w: 90, h: 30 };
    const settingsHovered = input.hitRect(settingsBtn.x, settingsBtn.y, settingsBtn.w, settingsBtn.h);
    ctx.fillStyle = settingsHovered ? '#777' : '#555';
    this.roundRect(settingsBtn.x, settingsBtn.y, settingsBtn.w, settingsBtn.h, 5);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('SETTINGS', settingsBtn.x + settingsBtn.w / 2, settingsBtn.y + settingsBtn.h / 2 + 4);

    // Train stats panel
    if (save) {
      const u = save.upgrades;
      const panelX = 12;
      const panelY = H - 100;
      const panelW = 180;
      const panelH = 82;

      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      this.roundRect(panelX, panelY, panelW, panelH, 6);
      ctx.fill();

      ctx.fillStyle = '#c8a96e';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'left';
      ctx.fillText('TRAIN STATS', panelX + 8, panelY + 14);

      ctx.fillStyle = '#aaa';
      ctx.font = '10px monospace';
      const stats = [
        `Crew: ${1 + u.crewSlots.level}`,
        `Dmg: +${u.damage.level * 15}%  Shield: ${u.shield.level}`,
        `Cool-off: -${u.coolOff.level * 10}%  Range: +${u.baseArea.level * 15}%`,
        `HP: +${u.maxHp.level * 15}  Greed: +${u.greed.level * 20}%`,
      ];
      stats.forEach((s, i) => {
        ctx.fillText(s, panelX + 8, panelY + 28 + i * 14);
      });
    }

    // Instructions
    ctx.fillStyle = '#e0d4b8';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Select a station to travel  \u2022  Each hop costs 1 coal', W / 2, H - 16);

    return hoveredStation;
  }

  _findHoveredStation(zone, input, sx, sy) {
    for (const s of zone.stations) {
      const dx = input.mouseX - sx(s);
      const dy = input.mouseY - sy(s);
      if (dx * dx + dy * dy <= 20 * 20) return s.id;
    }
    return -1;
  }

  drawStationArrival(arrival) {
    const ctx = this.ctx;
    const W = CANVAS_WIDTH;
    const H = CANVAS_HEIGHT;
    const cx = W / 2, cy = H / 2;

    if (arrival.isPreBoss) {
      // Boss fight — ominous red overlay
      const t = performance.now() * 0.003;
      const pulse = 0.6 + Math.sin(t) * 0.15;
      ctx.fillStyle = `rgba(60, 0, 0, ${pulse})`;
      ctx.fillRect(0, 0, W, H);

      // Vignette
      const grad = ctx.createRadialGradient(cx, cy, 50, cx, cy, 400);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.5)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      ctx.fillStyle = '#e74c3c';
      ctx.font = 'bold 40px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(arrival.label, cx, cy - 10);

      ctx.fillStyle = '#ff6b6b';
      ctx.font = 'bold 16px monospace';
      ctx.fillText('The horde is stronger here...', cx, cy + 20);
      ctx.fillStyle = '#aa4444';
      ctx.font = '13px monospace';
      ctx.fillText('Protect the cargo at all costs!', cx, cy + 42);
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, W, H);

      const colors = {
        combat: '#e74c3c',
        empty: '#888',
        exit: '#2ecc71',
      };
      ctx.fillStyle = colors[arrival.type] || '#fff';
      ctx.font = 'bold 32px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(arrival.label, cx, cy);

      ctx.fillStyle = '#aaa';
      ctx.font = '14px monospace';
      const subtitles = {
        combat: 'Defend the train! Deliver the cargo!',
        empty: 'The wasteland is quiet... for now.',
        exit: 'Cargo delivered! Time to resupply.',
      };
      ctx.fillText(subtitles[arrival.type] || '', cx, cy + 30);
    }
  }

  // =============================================
  // CONFETTI
  // =============================================
  spawnConfetti() {
    const colors = ['#f5a623', '#e74c3c', '#3498db', '#2ecc71', '#9b59b6', '#fff', '#ff69b4'];
    for (let i = 0; i < 60; i++) {
      this.confetti.push({
        x: CANVAS_WIDTH / 2 + (Math.random() - 0.5) * 400,
        y: -10 - Math.random() * 40,
        vx: (Math.random() - 0.5) * 200,
        vy: 80 + Math.random() * 150,
        rot: Math.random() * Math.PI * 2,
        rotV: (Math.random() - 0.5) * 8,
        w: 4 + Math.random() * 6,
        h: 3 + Math.random() * 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        life: 2 + Math.random() * 1.5,
      });
    }
  }

  updateAndDrawConfetti(dt) {
    const ctx = this.ctx;
    for (let i = this.confetti.length - 1; i >= 0; i--) {
      const c = this.confetti[i];
      c.x += c.vx * dt;
      c.vy += 60 * dt;
      c.y += c.vy * dt;
      c.rot += c.rotV * dt;
      c.life -= dt;
      if (c.life <= 0 || c.y > CANVAS_HEIGHT + 20) {
        this.confetti.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      ctx.globalAlpha = Math.min(1, c.life);
      ctx.fillStyle = c.color;
      ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }

  spawnFirework() {
    const colors = ['#f5a623', '#e74c3c', '#ff69b4', '#3498db', '#2ecc71', '#fff', '#f39c12'];
    const cx = 100 + Math.random() * (CANVAS_WIDTH - 200);
    const cy = 80 + Math.random() * (CANVAS_HEIGHT / 2);
    const color = colors[Math.floor(Math.random() * colors.length)];
    const sparks = 20 + Math.floor(Math.random() * 15);
    for (let i = 0; i < sparks; i++) {
      const angle = (i / sparks) * Math.PI * 2 + Math.random() * 0.3;
      const speed = 80 + Math.random() * 120;
      this.confetti.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 40,
        rot: 0,
        rotV: 0,
        w: 2 + Math.random() * 3,
        h: 2 + Math.random() * 3,
        color,
        life: 0.8 + Math.random() * 0.6,
      });
    }
  }

  // =============================================
  // MISC
  // =============================================
  setZoneGold(gold) { this._zoneGold = gold; }

  drawCone(x, y, angle, halfAngle, range, color) {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, range, angle - halfAngle, angle + halfAngle);
    ctx.closePath();
    ctx.fill();
  }

  // =============================================
  // START SCREEN
  // =============================================
  drawStartScreen(btn, input) {
    const ctx = this.ctx;
    const cx = CANVAS_WIDTH / 2;
    const t = performance.now() * 0.001;

    // Hide all gameplay 3D objects so only the train shows
    for (const mesh of this.enemyPool) mesh.visible = false;
    for (const entry of this.mountGroups) entry.group.visible = false;
    for (const mesh of this.coinPool) mesh.visible = false;
    for (const mesh of this.banditPool) mesh.visible = false;
    for (const mesh of this.projectilePool) mesh.visible = false;
    if (this.railGroup) this.railGroup.visible = false;

    // Dark 3D background for start screen
    this._savedBg = this.scene.background;
    this.scene.background = new THREE.Color(0x0a0804);

    // Show 3D train model (static, no rotation)
    if (this.trainMesh) {
      this.trainMesh.visible = true;
      this.trainMesh.position.set(0, 0, 0);
      if (this._trainOrigRotY !== undefined) {
        this.trainMesh.rotation.y = this._trainOrigRotY;
      }
    }

    // Semi-transparent overlay so 3D train shows through
    ctx.fillStyle = 'rgba(10, 8, 4, 0.55)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Vignette: darken edges, keep center lighter for train visibility
    const vig = ctx.createRadialGradient(cx, CANVAS_HEIGHT * 0.42, 100, cx, CANVAS_HEIGHT * 0.42, 460);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.7)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Animated dust/star particles (simple dots)
    ctx.fillStyle = 'rgba(200,180,120,0.25)';
    for (let i = 0; i < 40; i++) {
      const px = ((i * 137.5 + t * 8) % CANVAS_WIDTH);
      const py = ((i * 97.3 + t * 3) % CANVAS_HEIGHT);
      ctx.fillRect(px, py, 1.5, 1.5);
    }

    // Title (static, no animation)
    ctx.fillStyle = '#f5a623';
    ctx.font = 'bold 64px monospace';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#c88a1a';
    ctx.shadowBlur = 24;
    ctx.fillText('TRAIN DEFENSE', cx, 180);
    ctx.shadowBlur = 0;

    // Buttons — all same style, stacked vertically
    const buttons = [
      { key: 'start', label: 'START GAME' },
      { key: 'powerups', label: '⚡ POWER UPS' },
      { key: 'settings', label: '⚙ SETTINGS' },
    ];
    const glow = 0.6 + Math.sin(t * 3) * 0.4;
    for (const b of buttons) {
      const r = btn[b.key];
      const hover = input.hitRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = hover ? '#3a2800' : '#2a1c00';
      ctx.strokeStyle = hover ? `rgba(245,166,35,${0.9 + glow * 0.1})` : `rgba(245,166,35,${0.5 + glow * 0.5})`;
      ctx.lineWidth = hover ? 2.5 : 2;
      this.roundRect(r.x, r.y, r.w, r.h, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = hover ? '#f5a623' : '#c8a96e';
      ctx.font = 'bold 18px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(b.label, r.x + r.w / 2, r.y + r.h / 2 + 6);
    }

    ctx.fillStyle = '#444';
    ctx.font = '11px monospace';
    ctx.fillText('v1.0  —  Train Defense', cx, CANVAS_HEIGHT - 16);
  }

  // =============================================
  // WORLD SELECT
  // =============================================
  drawWorldSelect(worlds, card, getCardX, hoveredIndex, input) {
    const ctx = this.ctx;
    const cx = CANVAS_WIDTH / 2;
    const cardY = CANVAS_HEIGHT / 2 - card.h / 2;

    // Background
    ctx.fillStyle = '#0d0d18';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.fillStyle = '#f5a623';
    ctx.font = 'bold 32px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('SELECT WORLD', cx, 70);

    ctx.fillStyle = '#776040';
    ctx.font = '14px monospace';
    ctx.fillText('Each world is a full run across 3 zones.', cx, 100);

    for (let i = 0; i < worlds.length; i++) {
      const w = worlds[i];
      const x = getCardX(i);
      const isHovered = hoveredIndex === i;

      // Card background
      ctx.fillStyle = isHovered ? 'rgba(40,30,10,0.9)' : 'rgba(20,15,5,0.85)';
      this.roundRect(x, cardY, card.w, card.h, 10);
      ctx.fill();

      // Card border
      ctx.strokeStyle = isHovered ? w.accent : 'rgba(100,80,40,0.6)';
      ctx.lineWidth = isHovered ? 2.5 : 1.5;
      this.roundRect(x, cardY, card.w, card.h, 10);
      ctx.stroke();

      // World name
      ctx.fillStyle = w.color;
      ctx.font = 'bold 18px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(w.name, x + card.w / 2, cardY + 36);

      // Subtitle
      ctx.fillStyle = 'rgba(200,180,140,0.7)';
      ctx.font = '11px monospace';
      ctx.fillText(w.subtitle, x + card.w / 2, cardY + 56);

      // Divider
      ctx.strokeStyle = 'rgba(100,80,40,0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 16, cardY + 70);
      ctx.lineTo(x + card.w - 16, cardY + 70);
      ctx.stroke();

      // Difficulty stars
      ctx.font = '22px monospace';
      ctx.textAlign = 'center';
      const stars = '★'.repeat(w.stars) + '☆'.repeat(3 - w.stars);
      ctx.fillStyle = w.accent;
      ctx.fillText(stars, x + card.w / 2, cardY + 102);
      ctx.fillStyle = 'rgba(200,180,140,0.5)';
      ctx.font = '11px monospace';
      ctx.fillText('DIFFICULTY', x + card.w / 2, cardY + 118);

      // Zone count
      ctx.fillStyle = 'rgba(200,180,140,0.6)';
      ctx.font = '12px monospace';
      ctx.fillText('3 zones  •  Destination: Eastport', x + card.w / 2, cardY + 148);

      // Multiplier badge
      ctx.fillStyle = isHovered ? w.accent : 'rgba(160,130,60,0.7)';
      ctx.font = 'bold 13px monospace';
      ctx.fillText(`×${w.difficulty.toFixed(1)} enemy strength`, x + card.w / 2, cardY + 170);

      // SELECT button at bottom of card
      const selBtnY = cardY + card.h - 54;
      ctx.fillStyle = isHovered ? '#2a1c00' : '#181008';
      ctx.strokeStyle = isHovered ? w.accent : 'rgba(120,90,30,0.5)';
      ctx.lineWidth = isHovered ? 2 : 1;
      this.roundRect(x + 20, selBtnY, card.w - 40, 36, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = isHovered ? w.accent : '#886030';
      ctx.font = 'bold 14px monospace';
      ctx.fillText('SELECT', x + card.w / 2, selBtnY + 23);
    }

    ctx.fillStyle = '#444';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Press Esc to go back', cx, CANVAS_HEIGHT - 20);
  }

  // =============================================
  // WORLD MAP
  // =============================================
  drawWorldMap(zones, world, zoneNumber, input) {
    const ctx = this.ctx;
    const cx = CANVAS_WIDTH / 2;
    const t = performance.now() * 0.001;

    // Background
    ctx.fillStyle = '#0d0d18';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Header
    ctx.fillStyle = world ? world.color : '#c8a96e';
    ctx.font = 'bold 28px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(world ? world.name.toUpperCase() : 'WORLD MAP', cx, 60);
    ctx.fillStyle = '#776040';
    ctx.font = '13px monospace';
    ctx.fillText('World Map  —  Select your zone', cx, 82);

    // Draw railroad track between zones
    if (zones.length > 1) {
      for (let i = 0; i < zones.length - 1; i++) {
        const a = zones[i], b = zones[i + 1];
        const trackY = a.cy;
        // Rail ties
        ctx.strokeStyle = 'rgba(100,80,40,0.4)';
        ctx.lineWidth = 1;
        for (let tx = a.cx + a.r + 4; tx < b.cx - b.r - 4; tx += 14) {
          ctx.beginPath();
          ctx.moveTo(tx, trackY - 5);
          ctx.lineTo(tx + 8, trackY - 5);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(tx, trackY + 5);
          ctx.lineTo(tx + 8, trackY + 5);
          ctx.stroke();
        }
        // Rails
        ctx.strokeStyle = a.completed ? 'rgba(200,160,60,0.6)' : 'rgba(80,65,35,0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(a.cx + a.r, trackY - 5);
        ctx.lineTo(b.cx - b.r, trackY - 5);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(a.cx + a.r, trackY + 5);
        ctx.lineTo(b.cx - b.r, trackY + 5);
        ctx.stroke();
      }
    }

    // Zone labels above nodes
    const ZONE_NAMES = ['The Approach', 'The Heartlands', 'Final Stretch'];

    for (const z of zones) {
      const pulse = z.isCurrent ? 0.7 + Math.sin(t * 3) * 0.3 : 1;

      // Node circle
      if (z.completed) {
        ctx.fillStyle = 'rgba(180,140,40,0.25)';
      } else if (z.isCurrent) {
        ctx.fillStyle = `rgba(40,30,10,${0.7 + Math.sin(t * 2) * 0.15})`;
      } else {
        ctx.fillStyle = 'rgba(10,10,10,0.6)';
      }
      ctx.beginPath();
      ctx.arc(z.cx, z.cy, z.r, 0, Math.PI * 2);
      ctx.fill();

      // Node border
      if (z.completed) {
        ctx.strokeStyle = '#c8a96e';
        ctx.lineWidth = 2;
      } else if (z.isCurrent) {
        ctx.strokeStyle = world ? world.accent : '#f5a623';
        ctx.globalAlpha = pulse;
        ctx.lineWidth = 2.5;
      } else {
        ctx.strokeStyle = 'rgba(60,50,30,0.5)';
        ctx.lineWidth = 1.5;
      }
      ctx.beginPath();
      ctx.arc(z.cx, z.cy, z.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Zone icon / content
      if (z.completed) {
        ctx.fillStyle = '#c8a96e';
        ctx.font = '28px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('✓', z.cx, z.cy + 10);
      } else if (z.isCurrent) {
        ctx.fillStyle = world ? world.accent : '#f5a623';
        ctx.font = 'bold 16px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`ZONE ${z.number}`, z.cx, z.cy - 6);
        ctx.font = '11px monospace';
        ctx.fillStyle = 'rgba(200,180,140,0.8)';
        ctx.fillText('click to enter', z.cx, z.cy + 10);
      } else {
        ctx.fillStyle = 'rgba(80,65,35,0.6)';
        ctx.font = 'bold 14px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`ZONE ${z.number}`, z.cx, z.cy + 5);
      }

      // Zone name below node
      const name = ZONE_NAMES[z.index] || `Zone ${z.number}`;
      ctx.fillStyle = z.isLocked ? 'rgba(100,80,40,0.4)' : z.completed ? '#9a7a3a' : (world ? world.color : '#c8a96e');
      ctx.font = `${z.isCurrent ? 'bold ' : ''}13px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(name, z.cx, z.cy + z.r + 20);

      // "COMPLETED" tag on finished zones
      if (z.completed) {
        ctx.fillStyle = 'rgba(180,140,40,0.5)';
        ctx.font = '10px monospace';
        ctx.fillText('COMPLETED', z.cx, z.cy + z.r + 36);
      }
    }

    // Destination marker (Eastport)
    const lastZone = zones[zones.length - 1];
    const destX = lastZone.cx + lastZone.r + 60;
    const destY = lastZone.cy;
    ctx.fillStyle = 'rgba(245,166,35,0.15)';
    ctx.beginPath();
    ctx.arc(destX, destY, 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(245,166,35,0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(destX, destY, 28, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#f5a623';
    ctx.font = '13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('🏥', destX, destY + 4);
    ctx.fillStyle = 'rgba(200,160,60,0.7)';
    ctx.font = '10px monospace';
    ctx.fillText('EASTPORT', destX, destY + 28 + 14);

    ctx.fillStyle = '#444';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Press Esc to change world', cx, CANVAS_HEIGHT - 20);
  }

  roundRect(x, y, w, h, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}
