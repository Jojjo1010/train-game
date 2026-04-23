import {
  CANVAS_WIDTH, CANVAS_HEIGHT, MOUNT_RADIUS, CREW_RADIUS,
  WEAPON_RANGE, WEAPON_CONE_HALF_ANGLE, TARGET_DISTANCE, COIN_RADIUS,
  AUTO_WEAPONS
} from './constants.js';

export class Renderer {
  constructor(ctx) {
    this.ctx = ctx;
    this.shakeX = 0;
    this.shakeY = 0;
    this.confetti = [];
  }

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
      c.vy += 60 * dt; // gravity
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

  clear() {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }

  applyShake(train, dt) {
    if (train.shakeTimer > 0) {
      train.shakeTimer -= dt;
      const intensity = train.shakeTimer * 30;
      this.shakeX = (Math.random() - 0.5) * intensity;
      this.shakeY = (Math.random() - 0.5) * intensity;
      this.ctx.setTransform(1, 0, 0, 1, this.shakeX, this.shakeY);
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    if (train.damageFlash > 0) train.damageFlash -= dt;
  }

  // --- Terrain ---
  drawTerrain(scrollOffset) {
    const ctx = this.ctx;

    // Base ground
    ctx.fillStyle = '#3d5c2e';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Dirt patches (parallax)
    ctx.fillStyle = '#4a6b35';
    const patchSize = 120;
    for (let row = 0; row < CANVAS_HEIGHT / patchSize + 1; row++) {
      for (let col = 0; col < CANVAS_WIDTH / patchSize + 2; col++) {
        const x = (col * patchSize - (scrollOffset * 0.3) % patchSize) + ((row % 2) * 60);
        const y = row * patchSize;
        ctx.fillRect(x + 10, y + 10, patchSize - 40, patchSize - 40);
      }
    }

    // Track rails
    ctx.strokeStyle = '#8b7355';
    ctx.lineWidth = 3;
    const railY1 = CANVAS_HEIGHT / 2 - 20;
    const railY2 = CANVAS_HEIGHT / 2 + 20;
    ctx.beginPath();
    ctx.moveTo(0, railY1);
    ctx.lineTo(CANVAS_WIDTH, railY1);
    ctx.moveTo(0, railY2);
    ctx.lineTo(CANVAS_WIDTH, railY2);
    ctx.stroke();

    // Sleepers
    ctx.fillStyle = '#6b5a3e';
    const sleeperSpacing = 30;
    for (let x = -(scrollOffset % sleeperSpacing); x < CANVAS_WIDTH; x += sleeperSpacing) {
      ctx.fillRect(x, railY1 - 8, 6, railY2 - railY1 + 16);
    }
  }

  // --- Train ---
  drawTrain(train) {
    const ctx = this.ctx;

    for (const car of train.cars) {
      const x = car.worldX;
      const y = car.worldY;

      switch (car.type) {
        case 'locomotive':
          ctx.fillStyle = '#2c3e50';
          ctx.strokeStyle = '#f5a623';
          ctx.lineWidth = 3;
          this.roundRect(x, y, car.width, car.height, 6);
          ctx.fill();
          ctx.stroke();
          // Front arrow
          ctx.fillStyle = '#f5a623';
          ctx.beginPath();
          ctx.moveTo(x + car.width, y + 10);
          ctx.lineTo(x + car.width + 15, y + car.height / 2);
          ctx.lineTo(x + car.width, y + car.height - 10);
          ctx.closePath();
          ctx.fill();
          break;
        case 'cargo':
          ctx.fillStyle = '#555';
          ctx.strokeStyle = '#777';
          ctx.lineWidth = 2;
          this.roundRect(x, y, car.width, car.height, 4);
          ctx.fill();
          ctx.stroke();
          // Cargo boxes inside
          this.drawCargoBoxes(x, y, car.width, car.height, train.cargoBoxes);
          break;
        case 'weapon':
          ctx.fillStyle = '#2c2c2c';
          ctx.strokeStyle = '#555';
          ctx.lineWidth = 2;
          this.roundRect(x, y, car.width, car.height, 4);
          ctx.fill();
          ctx.stroke();
          // Diagonal stripes
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, y, car.width, car.height);
          ctx.clip();
          ctx.strokeStyle = '#3a3a3a';
          ctx.lineWidth = 1;
          for (let s = -car.height; s < car.width + car.height; s += 12) {
            ctx.beginPath();
            ctx.moveTo(x + s, y);
            ctx.lineTo(x + s - car.height, y + car.height);
            ctx.stroke();
          }
          ctx.restore();
          break;
      }

      // Connector + door between cars
      if (car.index < train.cars.length - 1) {
        const nextCar = train.cars[car.index + 1];
        const connX = x + car.width;
        const connW = nextCar.worldX - connX;
        const connY = y + car.height / 2;

        // Connector bar
        ctx.fillStyle = '#555';
        ctx.fillRect(connX, connY - 5, connW, 10);

        // Door (opens/closes)
        const door = car.doorRight;
        const doorW = 6;
        const doorH = 14;
        const doorX = connX + connW / 2 - doorW / 2;
        const openOffset = door.openAmount * 8;

        // Left door half
        ctx.fillStyle = door.openAmount > 0.5 ? '#888' : '#666';
        ctx.fillRect(doorX, connY - doorH / 2 - openOffset, doorW, doorH / 2);
        // Right door half
        ctx.fillRect(doorX, connY + openOffset, doorW, doorH / 2);

        // Door frame
        ctx.strokeStyle = '#999';
        ctx.lineWidth = 1;
        ctx.strokeRect(doorX - 1, connY - doorH / 2 - 1, doorW + 2, doorH + 2);
      }

      // Driver seat
      if (car.driverSeat) {
        const ds = car.driverSeat;
        ctx.beginPath();
        ctx.arc(ds.worldX, ds.worldY, CREW_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = ds.crew ? ds.crew.color : '#444';
        ctx.fill();
        ctx.strokeStyle = '#f5a623';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(ds.crew ? '★' : '⊕', ds.worldX, ds.worldY + 4);
      }
    }
  }

  drawWeaponMounts(train, aimingMount) {
    const ctx = this.ctx;
    for (const car of train.cars) {
      for (const mount of car.mounts) {
        const isAiming = mount === aimingMount;

        const hasAuto = mount.hasAutoWeapon;
        const active = mount.isManned || hasAuto;

        // No cone visual

        // Aiming highlight
        if (isAiming) {
          ctx.beginPath();
          ctx.arc(mount.worldX, mount.worldY, MOUNT_RADIUS + 6, 0, Math.PI * 2);
          ctx.strokeStyle = '#f5a623';
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // Mount circle — different color for auto-weapons
        ctx.beginPath();
        ctx.arc(mount.worldX, mount.worldY, MOUNT_RADIUS, 0, Math.PI * 2);
        if (hasAuto) {
          const awDef = AUTO_WEAPONS[mount.autoWeaponId];
          ctx.fillStyle = awDef ? awDef.color : '#888';
        } else {
          ctx.fillStyle = isAiming ? '#f5a623' : mount.isManned ? '#f5a623' : '#555';
        }
        ctx.fill();
        ctx.strokeStyle = isAiming ? '#fff' : active ? '#fff' : '#777';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Auto-weapon icon only
        if (hasAuto) {
          const awDef = AUTO_WEAPONS[mount.autoWeaponId];
          ctx.fillStyle = '#fff';
          ctx.font = '11px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(awDef ? awDef.icon : '?', mount.worldX, mount.worldY + 4);
        }

        // Crew color dot + direction arrow
        if (mount.crew) {
          ctx.beginPath();
          ctx.arc(mount.worldX, mount.worldY, 5, 0, Math.PI * 2);
          ctx.fillStyle = mount.crew.color;
          ctx.fill();

          // Small arrow showing facing direction
          const arrowLen = MOUNT_RADIUS + 8;
          const ax = Math.cos(mount.coneDirection) * arrowLen;
          const ay = Math.sin(mount.coneDirection) * arrowLen;
          const tipX = mount.worldX + ax;
          const tipY = mount.worldY + ay;
          // Arrow line
          ctx.strokeStyle = mount.crew.color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(mount.worldX + Math.cos(mount.coneDirection) * (MOUNT_RADIUS - 2),
                     mount.worldY + Math.sin(mount.coneDirection) * (MOUNT_RADIUS - 2));
          ctx.lineTo(tipX, tipY);
          ctx.stroke();
          // Arrow head
          const headLen = 5;
          const headAngle = 0.5;
          ctx.fillStyle = mount.crew.color;
          ctx.beginPath();
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(tipX - Math.cos(mount.coneDirection - headAngle) * headLen,
                     tipY - Math.sin(mount.coneDirection - headAngle) * headLen);
          ctx.lineTo(tipX - Math.cos(mount.coneDirection + headAngle) * headLen,
                     tipY - Math.sin(mount.coneDirection + headAngle) * headLen);
          ctx.closePath();
          ctx.fill();
        }
      }
    }
  }

  drawCone(x, y, angle, halfAngle, range, color) {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, range, angle - halfAngle, angle + halfAngle);
    ctx.closePath();
    ctx.fill();
  }

  // --- Crew panel ---
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
    ctx.fillText('CLICK CREW → CLICK SLOT', CANVAS_WIDTH / 2, panelY - 18);

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

      ctx.beginPath();
      ctx.arc(cx, cy, CREW_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = c.color;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('' + (i + 1), cx, cy + 4);
    }
  }

  // --- Enemies ---
  drawEnemies(enemies) {
    const ctx = this.ctx;
    for (const e of enemies) {
      if (!e.active) continue;
      // Body
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
      ctx.fillStyle = e.flashTimer > 0 ? '#fff' : e.color;
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.stroke();

      // HP bar (always visible)
      const barW = e.radius * 2.5;
      const barH = 4;
      const barX = e.x - barW / 2;
      const barY = e.y - e.radius - 7;
      ctx.fillStyle = '#222';
      ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
      const hpRatio = Math.max(0, e.hp / e.maxHp);
      ctx.fillStyle = hpRatio > 0.5 ? '#e74c3c' : hpRatio > 0.25 ? '#f39c12' : '#ff4444';
      ctx.fillRect(barX, barY, barW * hpRatio, barH);
    }
  }

  // --- Floating damage numbers ---
  drawDamageNumbers(numbers) {
    const ctx = this.ctx;
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    for (const d of numbers) {
      if (!d.active) continue;
      const alpha = Math.max(0, d.life / d.maxLife);
      ctx.fillStyle = `rgba(255, 255, 100, ${alpha})`;
      ctx.fillText(`-${Math.round(d.damage)}`, d.x, d.y);
    }
  }

  // --- Projectiles ---
  drawProjectiles(projectiles) {
    const ctx = this.ctx;
    for (const p of projectiles) {
      if (!p.active) continue;
      if (p.source === 'auto') {
        // Auto-weapon: orange diamond
        ctx.fillStyle = '#ff8800';
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.atan2(p.vy, p.vx));
        ctx.fillRect(-4, -2, 8, 4);
        ctx.restore();
      } else {
        // Crew: small white-yellow round bullet
        ctx.fillStyle = '#ffeeaa';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // --- HUD (matching mockup: HULL top-left, XP top-center, Gold top-right, Minimap bottom-right) ---
  drawHUD(train) {
    const ctx = this.ctx;
    const pad = 12;

    // === HULL (HP) — top-left ===
    const hpBarW = 220;
    const hpBarH = 22;
    const hpX = pad;
    const hpY = pad;

    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    this.roundRect(hpX, hpY, hpBarW + 8, hpBarH + 8, 4);
    ctx.fill();

    // Label
    ctx.fillStyle = '#8f8';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('HP', hpX + 4, hpY - 1);

    // Bar background
    ctx.fillStyle = '#222';
    ctx.fillRect(hpX + 4, hpY + 4, hpBarW, hpBarH);

    // Segmented green bar
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

    // Bar background
    ctx.fillStyle = '#333';
    ctx.fillRect(xpX, xpY + 4, xpBarW, xpBarH);

    // XP fill (red-orange gradient)
    const xpRatio = train.xp / train.xpToNextLevel;
    const xpGrad = ctx.createLinearGradient(xpX, 0, xpX + xpBarW * xpRatio, 0);
    xpGrad.addColorStop(0, '#e74c3c');
    xpGrad.addColorStop(1, '#f39c12');
    ctx.fillStyle = xpGrad;
    ctx.fillRect(xpX, xpY + 4, xpBarW * xpRatio, xpBarH);

    // Level text
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`Level ${train.level}`, xpX + xpBarW + 8, xpY + 18);

    // === GOLD — top-right ===
    const goldX = CANVAS_WIDTH - pad;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    this.roundRect(goldX - 100, xpY, 96, 28, 4);
    ctx.fill();

    // Coin circle
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

    // === MINI-MAP — bottom-right ===
    this.drawMiniMap(train.distance);
  }

  drawMiniMap(distance) {
    const ctx = this.ctx;
    const mapW = 180;
    const mapH = 30;
    const mapX = CANVAS_WIDTH - mapW - 16;
    const mapY = CANVAS_HEIGHT - mapH - 16;

    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    this.roundRect(mapX - 8, mapY - 14, mapW + 16, mapH + 28, 6);
    ctx.fill();

    // Labels
    ctx.fillStyle = '#aaa';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('Start', mapX, mapY + mapH + 12);
    ctx.textAlign = 'right';
    ctx.fillText('Finish', mapX + mapW, mapY + mapH + 12);

    // Track line
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(mapX, mapY + mapH / 2);
    ctx.lineTo(mapX + mapW, mapY + mapH / 2);
    ctx.stroke();

    // Finish marker
    ctx.fillStyle = '#888';
    ctx.fillRect(mapX + mapW - 2, mapY + 4, 4, mapH - 8);

    // Train position
    const ratio = Math.min(1, distance / TARGET_DISTANCE);
    const trainX = mapX + mapW * ratio;

    // Train icon (small rectangle)
    ctx.fillStyle = '#f5a623';
    ctx.fillRect(trainX - 8, mapY + mapH / 2 - 4, 16, 8);
    ctx.fillStyle = '#e74c3c';
    ctx.fillRect(trainX - 12, mapY + mapH / 2 - 3, 5, 6);

    // Distance percentage
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.floor(ratio * 100)}%`, mapX + mapW / 2, mapY - 2);
  }

  // --- Setup overlay ---
  drawSetupOverlay() {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, 50);
    ctx.fillStyle = '#f5a623';
    ctx.font = 'bold 20px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Click crew to select, click slot to place, hold to aim', CANVAS_WIDTH / 2, 32);
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

  // --- Level up overlay ---
  drawLevelUpMenu(level, powerups, hoveredIndex) {
    const ctx = this.ctx;

    // Dim background
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Title
    ctx.fillStyle = '#f5a623';
    ctx.font = 'bold 32px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`LEVEL ${level}!`, CANVAS_WIDTH / 2, 120);

    ctx.fillStyle = '#ccc';
    ctx.font = '16px monospace';
    ctx.fillText('Choose a powerup:', CANVAS_WIDTH / 2, 155);

    // Powerup cards
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

      // Card
      ctx.fillStyle = isHovered ? '#3a3a5a' : '#2a2a3a';
      ctx.strokeStyle = isHovered ? '#f5a623' : '#555';
      ctx.lineWidth = isHovered ? 3 : 1;
      this.roundRect(cx, cardY, cardW, cardH, 10);
      ctx.fill();
      ctx.stroke();

      // Icon
      ctx.font = '40px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = p.color;
      ctx.fillText(p.icon, cx + cardW / 2, cardY + 55);

      // Name
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px monospace';
      ctx.fillText(p.name, cx + cardW / 2, cardY + 90);

      // Description (word wrap)
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

      // Store hit area
      p._x = cx;
      p._y = cardY;
      p._w = cardW;
      p._h = cardH;
    }
  }

  // --- Game over ---
  drawGameOver(won, train, goldEarned, buttons, input) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.fillStyle = won ? '#2ecc71' : '#e74c3c';
    ctx.font = 'bold 44px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(won ? 'DELIVERED!' : 'TRAIN DESTROYED', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 70);

    ctx.fillStyle = '#fff';
    ctx.font = '18px monospace';
    const pct = Math.floor(train.distance / TARGET_DISTANCE * 100);
    ctx.fillText(`Distance: ${pct}%  |  Level: ${train.level}`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 25);

    // Gold breakdown
    const mult = 1.0 + train.cargoBoxes * 0.25;
    ctx.fillStyle = '#ccc';
    ctx.font = '16px monospace';
    if (won) {
      ctx.fillText(`Gold collected: ${train.runGold}  x  ${mult.toFixed(1)} cargo bonus`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 5);
    } else {
      ctx.fillText(`Gold collected: ${train.runGold}  (no cargo bonus)`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 5);
    }

    ctx.fillStyle = '#f5a623';
    ctx.font = 'bold 24px monospace';
    ctx.fillText(`+${goldEarned} Gold`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 38);

    // Buttons
    for (const [key, btn] of Object.entries(buttons)) {
      const hovered = input.hitRect(btn.x, btn.y, btn.w, btn.h);
      ctx.fillStyle = hovered ? '#3a3a5a' : '#2a2a3a';
      ctx.strokeStyle = hovered ? '#f5a623' : '#555';
      ctx.lineWidth = hovered ? 2 : 1;
      this.roundRect(btn.x, btn.y, btn.w, btn.h, 8);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = hovered ? '#f5a623' : '#ccc';
      ctx.font = 'bold 16px monospace';
      ctx.textAlign = 'center';
      const label = key === 'continue' ? 'CONTINUE' : key.toUpperCase();
      ctx.fillText(label, btn.x + btn.w / 2, btn.y + btn.h / 2 + 5);
    }
  }

  // --- Shop screen ---
  drawShop(save, upgradeKeys, hoveredIndex, departBtn, input, kbOnDepart = false) {
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

    // Upgrade rows
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

      // Store y for mouse hit-testing
      u._y = y;

      // Row background
      ctx.fillStyle = isHovered ? '#2a2a4a' : '#1e1e2e';
      ctx.strokeStyle = isHovered ? '#f5a623' : '#333';
      ctx.lineWidth = isHovered ? 2 : 1;
      this.roundRect(rowX, y, rowW, rowH, 6);
      ctx.fill();
      ctx.stroke();

      // Icon
      ctx.font = '18px monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = u.color;
      ctx.fillText(u.icon, rowX + 12, y + 28);

      // Name
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px monospace';
      ctx.fillText(u.name, rowX + 40, y + 20);

      // Description
      ctx.fillStyle = '#888';
      ctx.font = '11px monospace';
      ctx.fillText(u.desc, rowX + 40, y + 35);

      // Level checkmarks
      const checkX = rowX + rowW - 200;
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
          ctx.fillText('✓', cx + 9, y + 26);
          ctx.textAlign = 'left';
        }
      }

      // Cost
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

    // Depart button
    const hovered = input.hitRect(departBtn.x, departBtn.y, departBtn.w, departBtn.h) || kbOnDepart;
    ctx.fillStyle = hovered ? '#e09520' : '#f5a623';
    ctx.strokeStyle = kbOnDepart ? '#fff' : 'transparent';
    ctx.lineWidth = 2;
    this.roundRect(departBtn.x, departBtn.y, departBtn.w, departBtn.h, 8);
    ctx.fill();
    if (kbOnDepart) ctx.stroke();
    ctx.fillStyle = '#000';
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('BACK TO MAP', departBtn.x + departBtn.w / 2, departBtn.y + departBtn.h / 2 + 6);
  }

  // --- Pause menu ---
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

    // Hint
    ctx.fillStyle = '#666';
    ctx.font = '12px monospace';
    ctx.fillText('Press ESC to resume', CANVAS_WIDTH / 2, 470);
  }

  // --- Dragging crew ---
  // --- Cargo coins visual (inside the cargo car) ---
  drawCargoBoxes(x, y, w, h, boxes) {
    const ctx = this.ctx;
    const cols = 2;
    const rows = Math.ceil(boxes / cols);
    const boxW = 18;
    const boxH = 14;
    const gap = 4;
    const totalW = cols * boxW + (cols - 1) * gap;
    const totalH = rows * boxH + (rows - 1) * gap;
    const startX = x + (w - totalW) / 2;
    const startY = y + (h - totalH) / 2 - 2;

    for (let i = 0; i < boxes; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const bx = startX + col * (boxW + gap);
      const by = startY + row * (boxH + gap);

      // Box
      ctx.fillStyle = '#8B6914';
      ctx.fillRect(bx, by, boxW, boxH);
      ctx.strokeStyle = '#5a4510';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx, by, boxW, boxH);
      // Cross strap
      ctx.strokeStyle = '#6b5a20';
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + boxW, by + boxH);
      ctx.moveTo(bx + boxW, by);
      ctx.lineTo(bx, by + boxH);
      ctx.stroke();
    }

    // Multiplier label
    const mult = 1.0 + boxes * 0.25;
    ctx.fillStyle = '#f5a623';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`x${mult.toFixed(1)}`, x + w / 2, y + h - 2);
  }

  // --- World coins (scattered on the map) ---
  drawWorldCoins(coins) {
    const ctx = this.ctx;
    const t = performance.now() * 0.003;
    for (const c of coins) {
      if (!c.active) continue;
      const bobY = Math.sin(t + c.bobPhase) * 3;

      // Glow
      ctx.beginPath();
      ctx.arc(c.x, c.y + bobY, COIN_RADIUS + 4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(245, 166, 35, 0.15)';
      ctx.fill();

      // Coin body
      ctx.beginPath();
      ctx.arc(c.x, c.y + bobY, COIN_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = '#f5a623';
      ctx.fill();
      ctx.strokeStyle = '#c88a1a';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // $ symbol
      ctx.fillStyle = '#8a6010';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('$', c.x, c.y + bobY + 3.5);
    }
  }

  // --- Flying coins (animating from pickup to cargo) ---
  drawFlyingCoins(flyingCoins) {
    const ctx = this.ctx;
    for (const fc of flyingCoins) {
      if (!fc.active) continue;
      // Trail
      ctx.beginPath();
      ctx.arc(fc.x, fc.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(245, 166, 35, 0.4)';
      ctx.fill();

      // Coin
      ctx.beginPath();
      ctx.arc(fc.x, fc.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#f5a623';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // --- Brawler garlic aura ---
  drawSteamBlastAura(train) {
    const m = train.allMounts.find(mt => mt.isManned && mt.crew && mt.crew.role === 'Brawler');
    if (!m) return;
    const ctx = this.ctx;
    const cx = m.worldX;
    const cy = m.worldY;
    const pulse = 1 + Math.sin(performance.now() * 0.004) * 0.05;
    const r = 50 * (train.totalAreaMultiplier || 1) * pulse; // BRAWLER_GARLIC.radius

    // Outer glow
    const grad = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r);
    grad.addColorStop(0, 'rgba(142, 202, 230, 0.02)');
    grad.addColorStop(0.7, 'rgba(142, 202, 230, 0.06)');
    grad.addColorStop(1, 'rgba(142, 202, 230, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // Ring
    ctx.strokeStyle = `rgba(142, 202, 230, ${0.15 + Math.sin(performance.now() * 0.006) * 0.05})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // --- Ricochet bolts ---
  drawRicochetBolts(bolts) {
    const ctx = this.ctx;
    for (const b of bolts) {
      if (!b.active) continue;

      // Beam line from prev position to current
      const trailLen = 30;
      const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
      const tailX = b.x - (b.vx / speed) * trailLen;
      const tailY = b.y - (b.vy / speed) * trailLen;

      // Glow line (wide, transparent)
      ctx.strokeStyle = 'rgba(179, 136, 255, 0.3)';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      // Core beam (bright, thin)
      ctx.strokeStyle = '#d4b8ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      // Bright tip
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.lineCap = 'butt';
    }
  }

  // --- Auto-weapon HUD icons ---
  drawAutoWeaponHUD(train) {
    const ctx = this.ctx;
    const startX = 16;
    const y = CANVAS_HEIGHT - 36;

    // Weapon slots only (passives are now shop upgrades)
    const weaponIds = Object.keys(AUTO_WEAPONS);
    const maxSlots = weaponIds.length;
    const display = weaponIds.map(id => {
      const def = AUTO_WEAPONS[id];
      return { icon: def.icon, color: def.color, hasIt: train.hasAutoWeapon(id), level: train.autoWeaponLevel(id), maxLevel: 5 };
    });

    for (let i = 0; i < maxSlots; i++) {
      const x = startX + i * 50;
      if (i < display.length) {
        const s = display[i];
        // Background
        ctx.fillStyle = s.hasIt ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.2)';
        this.roundRect(x, y, 42, 30, 4);
        ctx.fill();

        // Icon
        ctx.font = '14px monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = s.hasIt ? s.color : '#444';
        ctx.fillText(s.icon, x + 21, y + 15);

        // Level pips
        if (s.hasIt) {
          for (let l = 0; l < s.maxLevel; l++) {
            ctx.fillStyle = l < s.level ? s.color : '#333';
            ctx.fillRect(x + 4 + l * 8, y + 22, 6, 3);
          }
        }
      } else {
        // Empty slot
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        this.roundRect(x, y, 42, 30, 4);
        ctx.fill();
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1;
        this.roundRect(x, y, 42, 30, 4);
        ctx.stroke();
      }
    }
  }

  // --- Damage flash overlay (red flash when train takes damage) ---
  drawDamageFlash(train) {
    if (train.damageFlash <= 0) return;
    const ctx = this.ctx;
    const alpha = Math.min(0.35, train.damageFlash);
    ctx.fillStyle = `rgba(255, 0, 0, ${alpha})`;
    ctx.fillRect(-10, -10, CANVAS_WIDTH + 20, CANVAS_HEIGHT + 20);
  }


  // --- Selected crew indicator ---
  drawSelectedIndicator(crew) {
    const ctx = this.ctx;
    let x, y;
    if (crew.isMoving) {
      x = crew.moveX;
      y = crew.moveY;
    } else if (crew.assignment) {
      x = crew.assignment.worldX;
      y = crew.assignment.worldY;
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
    // Top-left
    ctx.beginPath(); ctx.moveTo(x - s, y - s + l); ctx.lineTo(x - s, y - s); ctx.lineTo(x - s + l, y - s); ctx.stroke();
    // Top-right
    ctx.beginPath(); ctx.moveTo(x + s - l, y - s); ctx.lineTo(x + s, y - s); ctx.lineTo(x + s, y - s + l); ctx.stroke();
    // Bottom-left
    ctx.beginPath(); ctx.moveTo(x - s, y + s - l); ctx.lineTo(x - s, y + s); ctx.lineTo(x - s + l, y + s); ctx.stroke();
    // Bottom-right
    ctx.beginPath(); ctx.moveTo(x + s - l, y + s); ctx.lineTo(x + s, y + s); ctx.lineTo(x + s, y + s - l); ctx.stroke();

    // "SELECTED" label
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('SELECTED', x, y - r - 8);
  }

  // --- Moving crew (animated dots walking between positions) ---
  drawMovingCrew(crew) {
    const ctx = this.ctx;
    for (const c of crew) {
      if (!c.isMoving) continue;
      // Pulsing glow
      const pulse = 0.6 + Math.sin(performance.now() * 0.008) * 0.15;
      ctx.globalAlpha = pulse;
      ctx.beginPath();
      ctx.arc(c.moveX, c.moveY, CREW_RADIUS + 3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fill();
      ctx.globalAlpha = 1;

      // Crew dot
      ctx.beginPath();
      ctx.arc(c.moveX, c.moveY, CREW_RADIUS - 2, 0, Math.PI * 2);
      ctx.fillStyle = c.color;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  // --- Zone Map (train rails + stations) ---
  drawZoneMap(zone, input, save) {
    const ctx = this.ctx;
    const W = CANVAS_WIDTH;
    const H = CANVAS_HEIGHT;

    // Background — earthy terrain
    ctx.fillStyle = '#2d3a1e';
    ctx.fillRect(0, 0, W, H);
    // Subtle grass texture
    ctx.fillStyle = '#334420';
    for (let i = 0; i < 80; i++) {
      const px = (i * 173 + 41) % W;
      const py = (i * 131 + i * i * 7) % H;
      ctx.fillRect(px, py, 30 + (i % 20), 20 + (i % 15));
    }

    // Title
    ctx.fillStyle = '#c8a96e';
    ctx.font = 'bold 24px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`ZONE ${zone.difficulty} — RAIL MAP`, W / 2, 32);

    // Coal display
    ctx.fillStyle = '#aaa';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'left';
    const coalFull = '🟫'.repeat(zone.coal);
    const coalEmpty = '⬛'.repeat(zone.maxCoal - zone.coal);
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

        // Rail bed (brown strip)
        ctx.strokeStyle = visited ? '#6b5a3e' : canReach ? '#5a4a30' : '#3a3020';
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
        ctx.stroke();

        // Two rails
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

        // Sleepers
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

      // Station building
      const bw = isEnd ? 28 : isStart ? 24 : 20;
      const bh = isEnd ? 22 : isStart ? 18 : 16;

      // Glow for reachable
      if (canTravel && !isCurrent) {
        ctx.shadowColor = isHovered ? '#f5a623' : '#f5a62366';
        ctx.shadowBlur = isHovered ? 16 : 8;
      }

      // Building body
      if (isCurrent) {
        ctx.fillStyle = '#f5a623';
      } else if (station.visited) {
        ctx.fillStyle = '#5a5040';
      } else {
        ctx.fillStyle = '#6b5a48';
      }
      ctx.fillRect(x - bw / 2, y - bh / 2, bw, bh);

      // Roof
      ctx.fillStyle = isCurrent ? '#c88a1a' : station.visited ? '#4a4030' : '#8b7355';
      ctx.beginPath();
      ctx.moveTo(x - bw / 2 - 3, y - bh / 2);
      ctx.lineTo(x, y - bh / 2 - 8);
      ctx.lineTo(x + bw / 2 + 3, y - bh / 2);
      ctx.closePath();
      ctx.fill();

      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;

      // Border
      ctx.strokeStyle = isCurrent ? '#fff' : canTravel ? '#f5a623' : '#555';
      ctx.lineWidth = isCurrent ? 2 : 1;
      ctx.strokeRect(x - bw / 2, y - bh / 2, bw, bh);

      // End station flag
      if (isEnd) {
        ctx.fillStyle = '#2ecc71';
        ctx.fillRect(x + bw / 2 + 2, y - bh / 2 - 8, 2, 18);
        ctx.fillRect(x + bw / 2 + 4, y - bh / 2 - 8, 8, 6);
      }

      // Station name/number
      ctx.fillStyle = isCurrent ? '#000' : '#ddd';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      if (isStart) ctx.fillText('DEP', x, y + 3);
      else if (isEnd) ctx.fillText('ARR', x, y + 3);
      else ctx.fillText(`${station.id}`, x, y + 3);

      // Train icon on current station
      if (isCurrent) {
        ctx.fillStyle = '#e74c3c';
        ctx.font = '12px monospace';
        ctx.fillText('🚂', x, y - bh / 2 - 12);
      }
    }

    // Shop button (top-right)
    const shopBtn = { x: W - 110, y: 44, w: 90, h: 30 };
    const shopHovered = input.hitRect(shopBtn.x, shopBtn.y, shopBtn.w, shopBtn.h);
    ctx.fillStyle = shopHovered ? '#c88a1a' : '#8b7355';
    this.roundRect(shopBtn.x, shopBtn.y, shopBtn.w, shopBtn.h, 5);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('SHOP', shopBtn.x + shopBtn.w / 2, shopBtn.y + shopBtn.h / 2 + 4);

    // Train stats panel (bottom-left)
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
        `Gun Power: +${u.damage.level * 15}%`,
        `Kick Force: Lv${u.kickForce ? u.kickForce.level : 0}`,
        `HP: +${u.maxHp.level * 25}`,
      ];
      stats.forEach((s, i) => {
        ctx.fillText(s, panelX + 8, panelY + 28 + i * 14);
      });
    }

    // Instructions
    ctx.fillStyle = '#88785a';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Select a station to travel  •  Each hop costs 1 coal', W / 2, H - 16);

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

    // Dim overlay
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, W, H);

    // Label
    const colors = {
      combat: '#e74c3c',
      empty: '#888',
      exit: '#2ecc71',
    };
    ctx.fillStyle = colors[arrival.type] || '#fff';
    ctx.font = 'bold 32px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(arrival.label, W / 2, H / 2);

    // Subtitle
    ctx.fillStyle = '#aaa';
    ctx.font = '14px monospace';
    const subtitles = {
      combat: 'Zombies incoming...',
      empty: 'Nothing here...',
      exit: 'Shop time!',
    };
    ctx.fillText(subtitles[arrival.type] || '', W / 2, H / 2 + 30);
  }

  setZoneGold(gold) { this._zoneGold = gold; }

  // --- Bandits ---
  drawBandits(bandits) {
    const ctx = this.ctx;
    for (const b of bandits) {
      if (!b.active) continue;

      const x = b.x;
      const y = b.y;

      switch (b.state) {
        case 0: // RUNNING
        case 1: { // JUMPING
          // Running bandit — dark figure with hat
          const bobY = b.state === 0 ? Math.sin(performance.now() * 0.015) * 2 : 0;
          ctx.save();
          ctx.translate(x, y + bobY);

          // Body
          ctx.fillStyle = '#4a2a0a';
          ctx.fillRect(-4, -4, 8, 10);
          // Head
          ctx.beginPath();
          ctx.arc(0, -7, 5, 0, Math.PI * 2);
          ctx.fillStyle = '#6b3a1a';
          ctx.fill();
          // Hat (bandana)
          ctx.fillStyle = '#c0392b';
          ctx.fillRect(-6, -11, 12, 3);
          // Mask
          ctx.fillStyle = '#222';
          ctx.fillRect(-4, -7, 8, 3);

          ctx.restore();
          break;
        }

        case 2: // ON_TRAIN
        case 3: { // FIGHTING
          const fighting = b.state === 3;
          const flash = fighting && b.flashTimer % 0.3 < 0.15;

          // Bandit on slot
          ctx.save();
          ctx.translate(x, y);

          // Shaking when fighting
          if (fighting) {
            ctx.translate((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4);
          }

          // Body
          ctx.fillStyle = flash ? '#fff' : '#4a2a0a';
          ctx.fillRect(-4, -4, 8, 10);
          // Head
          ctx.beginPath();
          ctx.arc(0, -7, 5, 0, Math.PI * 2);
          ctx.fillStyle = flash ? '#fff' : '#6b3a1a';
          ctx.fill();
          // Hat
          ctx.fillStyle = flash ? '#fff' : '#c0392b';
          ctx.fillRect(-6, -11, 12, 3);
          // Mask
          ctx.fillStyle = flash ? '#ddd' : '#222';
          ctx.fillRect(-4, -7, 8, 3);

          ctx.restore();

          // Gold coins flying away
          if (!fighting && !b.targetSlot?.autoWeaponId) {
            const t = performance.now() * 0.004;
            for (let i = 0; i < 5; i++) {
              const age = (t + i * 0.7) % 2;
              if (age > 1.2) continue;
              const px = x + Math.sin(i * 2.3) * 8 + Math.sin(t + i) * 4;
              const py = y - 10 - age * 30;
              const alpha = Math.max(0, 1 - age / 1.2);
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
            if (b.stealFlash > 0) {
              ctx.fillStyle = `rgba(231, 76, 60, ${Math.min(1, b.stealFlash * 2)})`;
              ctx.font = 'bold 12px monospace';
              ctx.textAlign = 'center';
              ctx.fillText(`-${b.totalStolen}g`, x, y - 34);
            }
            const pulse = 0.7 + Math.sin(performance.now() * 0.008) * 0.3;
            ctx.fillStyle = `rgba(245, 166, 35, ${pulse})`;
            ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('STEALING!', x, y - 22);
          }

          // Disabled weapon — red X
          if (!fighting && b.targetSlot?.autoWeaponId) {
            const pulse = 0.6 + Math.sin(performance.now() * 0.008) * 0.4;
            ctx.strokeStyle = `rgba(231, 76, 60, ${pulse})`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(x - 8, y - 8); ctx.lineTo(x + 8, y + 8);
            ctx.moveTo(x + 8, y - 8); ctx.lineTo(x - 8, y + 8);
            ctx.stroke();
            ctx.fillStyle = '#e74c3c';
            ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('DISABLED!', x, y - 18);
          }

          // "Send crew" prompt
          if (!fighting) {
            const bounce = Math.sin(performance.now() * 0.006) * 3;
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('▼ SEND CREW ▼', x, y + 18 + bounce);
          }

          // Fight effect
          if (fighting) {
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 10px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('⚔ FIGHT!', x, y - 20);
          }
          break;
        }

        case 4: { // DEAD
          const alpha = Math.max(0, b.timer / 0.6);
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.translate(x, y);
          ctx.rotate(performance.now() * 0.02); // spinning

          // Body
          ctx.fillStyle = '#4a2a0a';
          ctx.fillRect(-4, -4, 8, 10);
          // Head
          ctx.beginPath();
          ctx.arc(0, -7, 5, 0, Math.PI * 2);
          ctx.fillStyle = '#6b3a1a';
          ctx.fill();

          ctx.restore();
          break;
        }
      }
    }
  }

  // --- Utility ---
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
