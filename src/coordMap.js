// Maps 2D game pixel coordinates to Three.js world coordinates
// Game uses (0..960, 0..640), Three.js uses centered coordinates
// X maps to X, Y maps to Z (Three.js Y is up/elevation)

export const CANVAS_WIDTH = 960;
export const CANVAS_HEIGHT = 640;

export function toWorld(px, py) {
  return {
    x: px - CANVAS_WIDTH / 2,
    z: py - CANVAS_HEIGHT / 2,
  };
}

export function toWorldX(px) { return px - CANVAS_WIDTH / 2; }
export function toWorldZ(py) { return py - CANVAS_HEIGHT / 2; }

// Inverse: 3D world coords back to pixel coords
export function toPixelX(wx) { return wx + CANVAS_WIDTH / 2; }
export function toPixelZ(wz) { return wz + CANVAS_HEIGHT / 2; }
