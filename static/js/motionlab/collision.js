// Contact detection for rotation-free circles and axis-aligned boxes. Pure functions, no state.
// Bodies here are the engine's internal records: { shape: 'circle'|'box', x, y, radius, width, height }.
//
// Convention for every contact: { nx, ny, depth }
//   - (nx, ny) is a unit normal pointing FROM the first body TO the second (for the floor: from the floor up, (0, 1)).
//   - depth > 0 is the penetration along that normal. Touching (depth exactly 0) is NOT a contact.
//   - Swapping the bodies negates the normal and keeps the depth.
// Degenerate cases (documented in docs/CONTRACT.md):
//   - Coincident circle centers: normal (0, 1), depth rA + rB.
//   - Box-box: separate along the axis of least overlap; an exact tie picks y. A zero center offset on the
//     chosen axis points +x / +y.
//   - Circle center inside a box: push out through the nearest face, depth = radius + distance to that face;
//     a tie between x and y faces picks y; a zero offset points +x / +y.

import { DT, FLOOR_Y } from './contract.js';

/** Half extents { hx, hy } of a body (radius for circles). */
export function halfExtents(b) {
  return b.shape === 'circle' ? { hx: b.radius, hy: b.radius } : { hx: b.width / 2, hy: b.height / 2 };
}

const sign = (v) => (v < 0 ? -1 : 1); // zero counts as positive

function circleCircle(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const r = a.radius + b.radius;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return null;
  const d = Math.sqrt(d2);
  return d === 0 ? { nx: 0, ny: 1, depth: r } : { nx: dx / d, ny: dy / d, depth: r - d };
}

function boxBox(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const ox = a.width / 2 + b.width / 2 - Math.abs(dx);
  const oy = a.height / 2 + b.height / 2 - Math.abs(dy);
  if (ox <= 0 || oy <= 0) return null;
  return ox < oy ? { nx: sign(dx), ny: 0, depth: ox } : { nx: 0, ny: sign(dy), depth: oy };
}

/** a is a box, b is a circle. */
function boxCircle(a, b) {
  const hw = a.width / 2;
  const hh = a.height / 2;
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  if (Math.abs(rx) <= hw && Math.abs(ry) <= hh) {
    const fx = hw - Math.abs(rx); // distance from the center to the nearest x face
    const fy = hh - Math.abs(ry);
    return fx < fy ? { nx: sign(rx), ny: 0, depth: b.radius + fx } : { nx: 0, ny: sign(ry), depth: b.radius + fy };
  }
  // Center outside: vector from the closest point on the box to the center (never zero here).
  const dx = rx - Math.max(-hw, Math.min(hw, rx));
  const dy = ry - Math.max(-hh, Math.min(hh, ry));
  const d2 = dx * dx + dy * dy;
  if (d2 >= b.radius * b.radius) return null;
  const d = Math.sqrt(d2);
  return { nx: dx / d, ny: dy / d, depth: b.radius - d };
}

/** Contact from body a to body b, or null if they do not overlap. */
export function contactBetween(a, b) {
  if (a.shape === 'circle' && b.shape === 'circle') return circleCircle(a, b);
  if (a.shape === 'box' && b.shape === 'box') return boxBox(a, b);
  if (a.shape === 'box') return boxCircle(a, b);
  const c = boxCircle(b, a);
  return c && { nx: -c.nx, ny: -c.ny, depth: c.depth };
}

/** Contact from the floor (y = FLOOR_Y, infinitely thick below) up to body b, or null. */
export function floorContact(b) {
  const depth = FLOOR_Y - (b.y - halfExtents(b).hy);
  return depth > 0 ? { nx: 0, ny: 1, depth } : null;
}

/**
 * Largest relative speed (m/s) at which a and b are guaranteed not to tunnel through each other or resolve the
 * wrong way: per step, the relative displacement must stay below the smallest half extent of either body.
 * The floor is an infinite half-plane and cannot be tunneled through.
 */
export function maxSafeRelativeSpeed(a, b) {
  const ea = halfExtents(a);
  const eb = halfExtents(b);
  return Math.min(ea.hx, ea.hy, eb.hx, eb.hy) / DT;
}
