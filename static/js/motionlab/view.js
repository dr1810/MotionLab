// World (meters, +y up) <-> canvas (CSS pixels, +y down) transform. No DOM access.
// The renderer obtains the floor's canvas row as view.floorPx, i.e. toCanvas(0, FLOOR_Y).y.

import { FLOOR_Y } from './contract.js';

/**
 * @param {object} o
 * @param {number} o.heightPx       canvas height in CSS pixels
 * @param {number} o.pixelsPerMeter scale
 * @param {number} [o.originXPx=0]  canvas x of world x = 0
 * @param {number} [o.floorMarginPx=40] gap between the floor line and the canvas bottom
 */
export function createViewTransform({ heightPx, pixelsPerMeter, originXPx = 0, floorMarginPx = 40 }) {
  const floorPx = heightPx - floorMarginPx;
  const s = pixelsPerMeter;
  return {
    pixelsPerMeter: s,
    floorPx,
    toCanvas: (x, y) => ({ x: originXPx + x * s, y: floorPx - (y - FLOOR_Y) * s }),
    toWorld: (px, py) => ({ x: (px - originXPx) / s, y: FLOOR_Y + (floorPx - py) / s }),
    lengthToPx: (m) => m * s,
  };
}

/**
 * Choose a transform that fits every body of a snapshot (normally the initial scene) with a
 * 1 m margin, showing at least minWidthM x minHeightM above the floor. The camera is fixed:
 * call it once per compile/reset, not per frame.
 */
export function fitView(snapshot, { widthPx, heightPx, floorMarginPx = 40, minWidthM = 8, minHeightM = 4 }) {
  let minX = 0;
  let maxX = 0;
  let maxY = 0;
  for (const b of snapshot.bodies) {
    const hw = b.shape === 'circle' ? b.dimensions.radius : b.dimensions.width / 2;
    const hh = b.shape === 'circle' ? b.dimensions.radius : b.dimensions.height / 2;
    minX = Math.min(minX, b.position.x - hw);
    maxX = Math.max(maxX, b.position.x + hw);
    maxY = Math.max(maxY, b.position.y + hh);
  }
  minX -= 1;
  maxX += 1;
  const spanX = Math.max(minWidthM, maxX - minX);
  const spanY = Math.max(minHeightM, maxY - FLOOR_Y + 1);
  const usableH = Math.max(1, heightPx - floorMarginPx);
  const s = Math.max(1e-6, Math.min(widthPx / spanX, usableH / spanY));
  const centreX = (minX + maxX) / 2;
  return createViewTransform({ heightPx, pixelsPerMeter: s, originXPx: widthPx / 2 - centreX * s, floorMarginPx });
}
