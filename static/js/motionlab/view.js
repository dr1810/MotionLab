// Canvas camera: meter <-> CSS-pixel transform. Physics is +y up in meters; canvas is +y down in pixels.
// The renderer gets the floor from here: view.floorPx is the canvas row of world y = FLOOR_Y.

import { FLOOR_Y } from './contract.js';

/**
 * @param {{width: number, height: number, scale: number, worldLeft?: number, floorOffset?: number}} opts
 *   width/height: canvas size in CSS px; scale: px per meter; worldLeft: world x at the canvas left edge;
 *   floorOffset: px between the canvas bottom and the floor line.
 */
export function createView({ width, height, scale, worldLeft = 0, floorOffset = 40 }) {
  const floorPx = height - floorOffset;
  return Object.freeze({
    width,
    height,
    scale,
    worldLeft,
    floorPx,
    toCanvas: (x, y) => ({ x: (x - worldLeft) * scale, y: floorPx - (y - FLOOR_Y) * scale }),
    toWorld: (px, py) => ({ x: px / scale + worldLeft, y: (floorPx - py) / scale + FLOOR_Y }),
    length: (meters) => meters * scale,
  });
}

/**
 * Fit a view so every body in the snapshot (and the floor) is visible with `padding` meters around it.
 * The scene is centered horizontally. Scale is clamped to [minScale, maxScale] px/m.
 */
export function fitView(snapshot, { width, height, padding = 1, floorOffset = 40, minScale = 5, maxScale = 160 }) {
  let left = -1;
  let right = 1;
  let top = 1;
  for (const b of snapshot.bodies) {
    const hw = b.shape === 'circle' ? b.dimensions.radius : b.dimensions.width / 2;
    const hh = b.shape === 'circle' ? b.dimensions.radius : b.dimensions.height / 2;
    left = Math.min(left, b.position.x - hw);
    right = Math.max(right, b.position.x + hw);
    top = Math.max(top, b.position.y + hh);
  }
  const spanX = right - left + 2 * padding;
  const spanY = top - FLOOR_Y + padding;
  const usableH = Math.max(1, height - floorOffset);
  const scale = Math.min(maxScale, Math.max(minScale, Math.min(width / spanX, usableH / spanY)));
  const worldLeft = (left + right) / 2 - width / scale / 2;
  return createView({ width, height, scale, worldLeft, floorOffset });
}
