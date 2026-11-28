// Canvas renderer: draws a snapshot through a view (view.js). Only uses the 2D context API passed in,
// so it can be tested with a recording fake context.

import { FLOOR_Y } from './contract.js';

export const THEME = Object.freeze({
  // Matches the block lab's "lab notebook" palette (static/css/lab.css).
  background: '#fffdf8',
  grid: '#ece6d6',
  gridLabel: '#8a8f9c',
  floor: '#efe9da',
  floorLine: '#545b6e',
  dynamic: '#0f766e',
  dynamicStroke: '#0b5b55',
  static: '#bdb6a6',
  staticStroke: '#7d7668',
  label: '#1f2638',
  velocity: '#d97706',
});

/** Grid spacing in meters so lines are at least ~28 px apart. */
export function gridStep(scale) {
  for (const step of [0.5, 1, 2, 5, 10, 20, 50, 100]) if (step * scale >= 28) return step;
  return 200;
}

/**
 * @param {CanvasRenderingContext2D} ctx  already scaled so 1 unit = 1 CSS px
 * @param {{bodies: object[]}} snapshot
 * @param {ReturnType<import('./view.js').createView>} view
 * @param {{velocities?: boolean, labels?: boolean, theme?: typeof THEME}} [opts]
 */
export function drawScene(ctx, snapshot, view, opts = {}) {
  const { velocities = true, labels = true, theme = THEME } = opts;
  const { width, height, floorPx } = view;

  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, height);

  // Grid (meters), with x labels under the floor.
  const step = gridStep(view.scale);
  const left = view.toWorld(0, 0).x;
  const right = view.toWorld(width, 0).x;
  const top = view.toWorld(0, 0).y;
  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = Math.ceil(left / step) * step; x <= right; x += step) {
    const px = Math.round(view.toCanvas(x, 0).x) + 0.5;
    ctx.moveTo(px, 0);
    ctx.lineTo(px, floorPx);
  }
  for (let y = step; y <= top; y += step) {
    const py = Math.round(view.toCanvas(0, y).y) + 0.5;
    ctx.moveTo(0, py);
    ctx.lineTo(width, py);
  }
  ctx.stroke();

  // Floor: the canvas row of world y = FLOOR_Y is view.floorPx.
  ctx.fillStyle = theme.floor;
  ctx.fillRect(0, floorPx, width, height - floorPx);
  ctx.strokeStyle = theme.floorLine;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, floorPx);
  ctx.lineTo(width, floorPx);
  ctx.stroke();

  ctx.fillStyle = theme.gridLabel;
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const labelEvery = step * Math.max(1, Math.ceil(48 / (step * view.scale)));
  for (let x = Math.ceil(left / labelEvery) * labelEvery; x <= right; x += labelEvery) {
    const px = view.toCanvas(x, FLOOR_Y).x;
    if (px < 20 || px > width - 20) continue; // would be clipped at the canvas edge
    ctx.fillText(`${+x.toFixed(2)} m`, px, floorPx + 6);
  }

  for (const b of snapshot.bodies) {
    const c = view.toCanvas(b.position.x, b.position.y);
    ctx.fillStyle = b.static ? theme.static : theme.dynamic;
    ctx.strokeStyle = b.static ? theme.staticStroke : theme.dynamicStroke;
    ctx.lineWidth = 1.5;
    let halfH;
    if (b.shape === 'circle') {
      const r = view.length(b.dimensions.radius);
      halfH = r;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      const w = view.length(b.dimensions.width);
      const h = view.length(b.dimensions.height);
      halfH = h / 2;
      ctx.fillRect(c.x - w / 2, c.y - h / 2, w, h);
      ctx.strokeRect(c.x - w / 2, c.y - h / 2, w, h);
    }
    if (velocities && !b.static) {
      const vx = b.velocity.x;
      const vy = b.velocity.y;
      if (Math.hypot(vx, vy) > 0.05) {
        // 0.25 s of travel, so the arrow length is meaningful in meters.
        const tip = view.toCanvas(b.position.x + vx * 0.25, b.position.y + vy * 0.25);
        drawArrow(ctx, c.x, c.y, tip.x, tip.y, theme.velocity);
      }
    }
    if (labels) {
      ctx.fillStyle = theme.label;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(b.id, c.x, c.y - halfH - 4);
    }
  }
}

function drawArrow(ctx, x0, y0, x1, y1, colour) {
  const angle = Math.atan2(y1 - y0, x1 - x0);
  const head = Math.min(8, Math.hypot(x1 - x0, y1 - y0) / 2);
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - head * Math.cos(angle - 0.45), y1 - head * Math.sin(angle - 0.45));
  ctx.lineTo(x1 - head * Math.cos(angle + 0.45), y1 - head * Math.sin(angle + 0.45));
  ctx.closePath();
  ctx.fill();
}
