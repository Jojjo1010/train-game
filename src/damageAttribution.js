/**
 * Floating damage attribution numbers — shows the player WHY they're losing HP/gold.
 * Drawn on the 2D overlay canvas, floats upward and fades out.
 */

const POOL_SIZE = 20;
const FLOAT_DURATION = 1.5; // seconds
const FLOAT_SPEED = 30;     // pixels/sec upward

class FloatingNumber {
  constructor() {
    this.active = false;
    this.text = '';
    this.x = 0;
    this.y = 0;
    this.color = '#ff0000';
    this.alpha = 1;
    this.timer = 0;
    this.offsetY = 0;
  }

  spawn(text, x, y, color) {
    this.active = true;
    this.text = text;
    this.x = x + (Math.random() - 0.5) * 16; // slight horizontal jitter
    this.y = y;
    this.color = color;
    this.alpha = 1;
    this.timer = FLOAT_DURATION;
    this.offsetY = 0;
  }

  update(dt) {
    if (!this.active) return;
    this.timer -= dt;
    this.offsetY -= FLOAT_SPEED * dt;
    this.alpha = Math.max(0, this.timer / FLOAT_DURATION);
    if (this.timer <= 0) this.active = false;
  }
}

// Pool
const pool = [];
for (let i = 0; i < POOL_SIZE; i++) {
  pool.push(new FloatingNumber());
}

// Throttle tracking for continuous damage sources (keyed by source type)
const throttleTimers = {};
const THROTTLE_INTERVAL = 1.0; // seconds between numbers for continuous sources

/**
 * Spawn a floating damage number at a screen position.
 * @param {string} text - e.g. "-6", "-0.5", "-1g"
 * @param {number} x - screen X
 * @param {number} y - screen Y
 * @param {string} color - CSS color
 * @param {string} [throttleKey] - optional key to throttle continuous sources
 */
export function spawnDamageNumber(text, x, y, color, throttleKey) {
  if (throttleKey) {
    const now = performance.now() / 1000;
    if (throttleTimers[throttleKey] && now - throttleTimers[throttleKey] < THROTTLE_INTERVAL) {
      return; // skip, too soon
    }
    throttleTimers[throttleKey] = now;
  }

  const num = pool.find(n => !n.active);
  if (num) num.spawn(text, x, y, color);
}

/**
 * Update all active floating numbers.
 * @param {number} dt - delta time in seconds
 */
export function updateDamageAttribution(dt) {
  for (const n of pool) {
    if (n.active) n.update(dt);
  }
}

/**
 * Draw all active floating numbers on the 2D overlay canvas.
 * @param {CanvasRenderingContext2D} ctx
 */
export function drawDamageAttribution(ctx) {
  ctx.save();
  ctx.font = 'bold 13px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const n of pool) {
    if (!n.active) continue;
    const drawY = n.y + n.offsetY;

    // Pop scale at start
    const t = 1 - n.timer / FLOAT_DURATION;
    const popScale = 1 + 0.3 * Math.max(0, 1 - t * 5);
    const size = Math.round(13 * popScale);
    ctx.font = `bold ${size}px monospace`;

    // Outline for readability
    ctx.globalAlpha = n.alpha * 0.8;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.strokeText(n.text, n.x, drawY);

    // Fill
    ctx.globalAlpha = n.alpha;
    ctx.fillStyle = n.color;
    ctx.fillText(n.text, n.x, drawY);
  }

  ctx.restore();
}

/**
 * Reset all floating numbers and throttle timers (call on combat reset).
 */
export function resetDamageAttribution() {
  for (const n of pool) n.active = false;
  for (const k of Object.keys(throttleTimers)) delete throttleTimers[k];
}
