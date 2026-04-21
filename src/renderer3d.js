import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { toWorld, toWorldX, toWorldZ, toPixelX, toPixelZ } from './coordMap.js';
import {
  CANVAS_WIDTH, CANVAS_HEIGHT, MOUNT_RADIUS, CREW_RADIUS,
  WEAPON_RANGE, TARGET_DISTANCE, COIN_RADIUS,
  AUTO_WEAPONS, MANUAL_GUN, COAL_SHOP_COST, COAL_SHOP_AMOUNT,
  MAX_ENEMIES, MAX_PROJECTILES, MAX_RICOCHET_BOLTS,
  MAX_COINS, MAX_FLYING_COINS, MAX_BANDITS
} from './constants.js';

export class Renderer3D {
  constructor(threeCanvas, overlayCtx) {
    this.ctx = overlayCtx;

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
    this.scene.add(placeholderTrain);

    // Fixed 3D mount positions ON the train (offsets from train center)
    // 8 weapon mounts: 4 on rear weapon car, 4 on front weapon car
    // Train layout (along X): rear weapon (-80) | cargo (-27) | front weapon (27) | locomotive (80)
    this.mountOffsets3D = [
      // Rear weapon car (4 mounts: corners)
      { x: -95, y: 16, z: -15 },  // rear-left-back
      { x: -65, y: 16, z: -15 },  // rear-right-back
      { x: -95, y: 16, z: 15 },   // rear-left-front
      { x: -65, y: 16, z: 15 },   // rear-right-front
      // Front weapon car (4 mounts: corners)
      { x: 10, y: 16, z: -15 },   // front-left-back
      { x: 40, y: 16, z: -15 },   // front-right-back
      { x: 10, y: 16, z: 15 },    // front-left-front
      { x: 40, y: 16, z: 15 },    // front-right-front
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
      const intensity = train.shakeTimer * 30;
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

  drawTerrain(scrollOffset) {
    // Scroll only by one sleeper spacing cycle so track never disappears
    const sleeperSpacing = 15;
    const offset = (scrollOffset * 0.5) % sleeperSpacing;
    this.railGroup.position.x = -offset;
  }

  drawTrain(train) {
    if (!this.trainMesh) return;
    // Train always at scene origin
    this.trainMesh.position.set(0, 0, 0);
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
        group.rotation.y = -mount.coneDirection + Math.PI / 2;

        // Determine which model to show
        let desiredType = null;
        if (mount.hasAutoWeapon) {
          const modelMap = { turret: 'AutoGun', steamBlast: 'Garlic', ricochetShot: 'Laser' };
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
        mountIdx++;
      }

      // Project to screen for overlay + input
      const screenPos = this._project(offset.x, offset.z);
      const sx = screenPos.x;
      const sy = screenPos.y;

      // Slot indicator on overlay
      const hasAuto = mount.hasAutoWeapon;
      const active = mount.isManned || hasAuto;
      if (!hasAuto && !mount.isManned) {
        // Empty box to show "weapon slot available"
        const boxSize = MOUNT_RADIUS * 2;
        ctx.fillStyle = 'rgba(60, 60, 60, 0.5)';
        ctx.fillRect(sx - boxSize / 2, sy - boxSize / 2, boxSize, boxSize);
        ctx.strokeStyle = showEmptySlots ? 'rgba(200,200,200,0.7)' : 'rgba(120,120,120,0.5)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(sx - boxSize / 2, sy - boxSize / 2, boxSize, boxSize);
        ctx.setLineDash([]);
      }

      if (mount.crew) {
        ctx.font = '12px serif';
        ctx.textAlign = 'center';
        ctx.fillText('\uD83D\uDC31', sx, sy + 4);

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

        // Project a point offset in the shooting direction to get screen-space angle
        const dirDist = 30; // 3D offset distance
        const dirX = offset.x + Math.cos(mount.coneDirection) * dirDist;
        const dirZ = offset.z + Math.sin(mount.coneDirection) * dirDist;
        const dirScreen = this._project(dirX, dirZ);
        const screenAngle = Math.atan2(dirScreen.y - sy, dirScreen.x - sx);

        const arrowLen = MOUNT_RADIUS + 8;
        const tipX = sx + Math.cos(screenAngle) * arrowLen;
        const tipY = sy + Math.sin(screenAngle) * arrowLen;
        ctx.strokeStyle = mount.crew.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sx + Math.cos(screenAngle) * (MOUNT_RADIUS - 2),
                   sy + Math.sin(screenAngle) * (MOUNT_RADIUS - 2));
        ctx.lineTo(tipX, tipY);
        ctx.stroke();
        const headLen = 5, headAngle = 0.5;
        ctx.fillStyle = mount.crew.color;
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX - Math.cos(screenAngle - headAngle) * headLen,
                   tipY - Math.sin(screenAngle - headAngle) * headLen);
        ctx.lineTo(tipX - Math.cos(screenAngle + headAngle) * headLen,
                   tipY - Math.sin(screenAngle + headAngle) * headLen);
        ctx.closePath();
        ctx.fill();
      }

      // Screen coords for input hit-testing + overlay drawing
      mount.screenX = sx;
      mount.screenY = sy;
      // Set pixel coords from 3D offset so combat fires from turret position
      mount.worldX = toPixelX(offset.x);
      mount.worldY = toPixelZ(offset.z);
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
    let idx = 0;
    for (const b of bolts) {
      if (idx >= this.ricochetPool.length) break;
      const line = this.ricochetPool[idx];
      if (!b.active) {
        line.visible = false;
        idx++;
        continue;
      }
      const trailLen = 30;
      const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
      const tailX = b.x - (b.vx / speed) * trailLen;
      const tailY = b.y - (b.vy / speed) * trailLen;

      const wHead = toWorld(b.x, b.y);
      const wTail = toWorld(tailX, tailY);

      const positions = line.geometry.attributes.position;
      positions.setXYZ(0, wTail.x, 5, wTail.z);
      positions.setXYZ(1, wHead.x, 5, wHead.z);
      positions.needsUpdate = true;
      line.visible = true;
      idx++;
    }
    for (let i = idx; i < this.ricochetPool.length; i++) {
      this.ricochetPool[i].visible = false;
    }
  }

  drawSteamBlastAura(train) {
    if (!train.autoWeapons.steamBlast) {
      this.steamRing.visible = false;
      return;
    }
    const stats = train.getAutoWeaponStats('steamBlast');
    if (!stats) { this.steamRing.visible = false; return; }

    const m = train.getAutoWeaponMount('steamBlast');
    if (m && m._bandit) { this.steamRing.visible = false; return; }
    const cx = m ? m.worldX : train.centerX;
    const cy = m ? m.worldY : train.centerY;
    const pulse = 1 + Math.sin(performance.now() * 0.004) * 0.05;
    const r = stats.radius * (train.totalAreaMultiplier || 1) * pulse;

    const w = toWorld(cx, cy);
    this.steamRing.position.x = w.x;
    this.steamRing.position.z = w.z;
    // Scale ring to match radius (base geometry is ~40 units)
    const scale = r / 40;
    this.steamRing.scale.set(scale, scale, scale);
    this.steamRing.visible = true;

    // Also draw on 2D overlay for the subtle glow
    const ctx = this.ctx;
    ctx.strokeStyle = `rgba(142, 202, 230, ${0.15 + Math.sin(performance.now() * 0.006) * 0.05})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
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
      ctx.fillText('\uD83D\uDC31', sx, sy + 6);
      ctx.globalAlpha = 1;
    }
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
            // Gold coins flying away
            const t = performance.now() * 0.004;
            for (let i = 0; i < 5; i++) {
              const age = (t + i * 0.7) % 2;
              if (age > 1.2) continue;
              const px = sx + Math.sin(i * 2.3) * 8 + Math.sin(t + i) * 4;
              const py = sy - 10 - age * 30;
              const alpha = Math.max(0, 1 - age / 1.2);
              // Gold coin
              ctx.globalAlpha = alpha;
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
    const alpha = Math.min(0.35, train.damageFlash);
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
    ctx.fillText('HULL', hpX + 4, hpY - 1);

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

    // === GOLD — top-right ===
    const goldX = CANVAS_WIDTH - pad;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    this.roundRect(goldX - 100, xpY, 96, 28, 4);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(goldX - 82, xpY + 14, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#f5a623';
    ctx.fill();
    ctx.strokeStyle = '#c88a1a';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${train.runGold}`, goldX - 10, xpY + 19);

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
      ctx.fillText('\uD83D\uDC31', cx, cy + 6);
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
      ctx.fillRect(x + 4 + l * 8, y + 22, 6, 3);
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
    const crewNames = ['Orb', 'Davie', 'Punk'];

    // --- CREW ROW (top) ---
    const crewY = CANVAS_HEIGHT - 116;
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
      ctx.fillText(crewNames[i], x + slotW / 2, crewY + 10);
      // Gun icon + level
      ctx.font = '12px monospace';
      ctx.fillText('\uD83D\uDD2B', x + slotW / 2, crewY + 23);
      this._drawLevelPips(ctx, x + 2, crewY + 1, c.gunLevel, c.color);
    }

    // --- WEAPONS ROW (middle, auto-weapons only) ---
    const weapY = CANVAS_HEIGHT - 74;
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
    const defY = CANVAS_HEIGHT - 36;
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
  drawLevelUpMenu(level, powerups, hoveredIndex) {
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

      ctx.fillStyle = isHovered ? '#3a3a5a' : '#2a2a3a';
      ctx.strokeStyle = isHovered ? '#f5a623' : '#555';
      ctx.lineWidth = isHovered ? 3 : 1;
      this.roundRect(cx, cardY, cardW, cardH, 10);
      ctx.fill();
      ctx.stroke();

      ctx.font = '40px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = p.color;
      ctx.fillText(p.icon, cx + cardW / 2, cardY + 55);

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px monospace';
      ctx.fillText(p.name, cx + cardW / 2, cardY + 90);

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
      ctx.fillText('The wasteland couldn\'t stop this train.', cx, cy + 40);

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

      ctx.fillStyle = '#fff';
      ctx.font = '16px monospace';
      const pct = Math.floor(train.distance / TARGET_DISTANCE * 100);
      ctx.fillText(`Distance: ${pct}%  |  Level: ${train.level}`, cx, cy - 10);

      ctx.fillStyle = '#ccc';
      ctx.font = '14px monospace';
      ctx.fillText(`Gold salvaged: ${train.runGold}  (cargo lost)`, cx, cy + 12);

      ctx.fillStyle = '#f5a623';
      ctx.font = 'bold 24px monospace';
      ctx.fillText(`+${goldEarned} Gold`, cx, cy + 38);
    }

    const btnY = gameOverType === 'world' ? cy + 140 : cy + 70;

    if (gameOverType === 'zone') {
      // Two buttons: SHOP and NEXT ZONE
      const shopBtn = buttons.shop;
      const nextBtn = buttons.nextZone;
      shopBtn.y = btnY;
      nextBtn.y = btnY;

      for (const [btn, label] of [[shopBtn, 'SHOP'], [nextBtn, 'NEXT ZONE']]) {
        const h = input.hitRect(btn.x, btn.y, btn.w, btn.h);
        ctx.fillStyle = h ? '#3a3a5a' : '#2a2a3a';
        ctx.strokeStyle = h ? '#f5a623' : '#555';
        ctx.lineWidth = h ? 2 : 1;
        this.roundRect(btn.x, btn.y, btn.w, btn.h, 8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = h ? '#f5a623' : '#ccc';
        ctx.font = 'bold 14px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(label, btn.x + btn.w / 2, btn.y + btn.h / 2 + 5);
      }
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
      const label = gameOverType === 'world' ? 'NEW WORLD' : gameOverType === 'combat' ? 'CONTINUE' : 'TRY AGAIN';
      ctx.fillText(label, btn.x + btn.w / 2, btn.y + btn.h / 2 + 5);
    }
  }

  // =============================================
  // SHOP
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
        `Hull: +${u.maxHp.level * 15}  Greed: +${u.greed.level * 20}%`,
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
