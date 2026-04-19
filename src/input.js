import { MOUNT_RADIUS, CREW_RADIUS } from './constants.js';

export class InputManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.mouseX = 0;
    this.mouseY = 0;

    this._clickThisFrame = false;
    this._isMouseDown = false;

    // Keyboard
    this.keysDown = new Set();
    this._keysPressed = new Set(); // pressed this frame

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('mousemove', (e) => {
      const pos = this.getCanvasPos(e);
      this.mouseX = pos.x;
      this.mouseY = pos.y;
    });

    canvas.addEventListener('mousedown', (e) => {
      const pos = this.getCanvasPos(e);
      this.mouseX = pos.x;
      this.mouseY = pos.y;
      this._clickThisFrame = true;
      this._isMouseDown = true;
    });

    canvas.addEventListener('mouseup', () => {
      this._isMouseDown = false;
    });

    // Touch
    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const pos = this.getCanvasPos(e.touches[0]);
      this.mouseX = pos.x;
      this.mouseY = pos.y;
      this._clickThisFrame = true;
      this._isMouseDown = true;
    });

    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const pos = this.getCanvasPos(e.touches[0]);
      this.mouseX = pos.x;
      this.mouseY = pos.y;
    });

    canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      this._isMouseDown = false;
    });

    // Keyboard
    window.addEventListener('keydown', (e) => {
      if (!this.keysDown.has(e.code)) {
        this._keysPressed.add(e.code);
      }
      this.keysDown.add(e.code);
    });

    window.addEventListener('keyup', (e) => {
      this.keysDown.delete(e.code);
    });
  }

  getCanvasPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  endFrame() {
    this._clickThisFrame = false;
    this._keysPressed.clear();
  }

  get clicked() { return this._clickThisFrame; }
  get mouseDown() { return this._isMouseDown; }

  keyPressed(code) { return this._keysPressed.has(code); }
  keyDown(code) { return this.keysDown.has(code); }

  hitCircle(tx, ty, radius) {
    const dx = this.mouseX - tx;
    const dy = this.mouseY - ty;
    return dx * dx + dy * dy <= radius * radius;
  }

  hitRect(x, y, w, h) {
    return this.mouseX >= x && this.mouseX <= x + w &&
           this.mouseY >= y && this.mouseY <= y + h;
  }

  findSlotAtMouse(train) {
    for (const slot of train.allSlots) {
      const r = slot.isDriverSeat ? CREW_RADIUS + 4 : MOUNT_RADIUS + 6;
      // Use projected screen coords if available (3D mode), otherwise pixel coords (2D mode)
      const sx = slot.screenX !== undefined ? slot.screenX : slot.worldX;
      const sy = slot.screenY !== undefined ? slot.screenY : slot.worldY;
      if (this.hitCircle(sx, sy, r)) return slot;
    }
    return null;
  }

  findCrewInPanel(crew) {
    for (const c of crew) {
      if (c.assignment) continue;
      if (c.panelX !== undefined && this.hitCircle(c.panelX, c.panelY, CREW_RADIUS + 6)) return c;
    }
    return null;
  }
}
