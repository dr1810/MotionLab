// MotionLab physics engine (contract v1). Dependency-free, deterministic.
// SI units, +x right, +y up, body-centred coordinates, static floor at y = FLOOR_Y.
// Bodies do not rotate: boxes stay axis-aligned. No friction or air drag in v1.

import {
  DT, FLOOR_Y, DEFAULT_GRAVITY, ProgramError, validateProgram,
} from './contract.js';

/** Approach speeds below this (m/s) collide inelastically, so resting bodies do not jitter. */
export const REST_SPEED = 0.1;
/** Collision solver passes per step. */
export const SOLVER_ITERATIONS = 4;
/** Restitution of the floor. A contact uses max(restitutionA, restitutionB). */
export const FLOOR_RESTITUTION = 0;

/**
 * Compile a program v1 into a simulation.
 * Throws ProgramError (with .errors = [{code, message, blockId}]) if the program is invalid.
 * An empty command list is valid: no bodies, default gravity.
 */
export function createSimulation(program) {
  const result = validateProgram(program);
  if (!result.ok) throw new ProgramError(result.errors);

  const initial = buildScene(program.commands);
  let bodies;
  let tick;

  function reset() {
    bodies = initial.bodies.map((b) => ({ ...b }));
    tick = 0;
    return snapshot();
  }

  function snapshot() {
    return {
      tick,
      time: tick * DT,
      bodies: bodies.map(toSnapshotBody),
    };
  }

  function step() {
    const firstTick = tick === 0;
    const { x: gx, y: gy } = initial.gravity;
    for (const b of bodies) {
      if (b.static) continue;
      let ax = gx;
      let ay = gy;
      if (firstTick) {
        ax += b.fx * b.invMass;
        ay += b.fy * b.invMass;
      }
      b.vx += ax * DT;
      b.vy += ay * DT;
      b.x += b.vx * DT;
      b.y += b.vy * DT;
    }
    for (let it = 0; it < SOLVER_ITERATIONS; it++) {
      for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) collide(bodies[i], bodies[j]);
      }
      for (const b of bodies) collideFloor(b);
    }
    tick += 1;
    return snapshot();
  }

  reset();
  return { step, reset, snapshot };
}

function buildScene(commands) {
  const gravity = { ...DEFAULT_GRAVITY };
  const bodies = [];
  const byId = new Map();
  for (const c of commands) {
    switch (c.op) {
      case 'createCircle':
      case 'createBox': {
        const body = {
          id: c.id,
          shape: c.op === 'createCircle' ? 'circle' : 'box',
          x: c.x, y: c.y, vx: 0, vy: 0,
          radius: c.radius, width: c.width, height: c.height,
          static: c.static,
          invMass: c.static ? 0 : 1 / c.mass,
          restitution: c.restitution,
          fx: 0, fy: 0,
        };
        bodies.push(body);
        byId.set(c.id, body);
        break;
      }
      case 'setGravity':
        gravity.x = c.x;
        gravity.y = c.y;
        break;
      case 'setVelocity': {
        const b = byId.get(c.id);
        b.vx = c.vx;
        b.vy = c.vy;
        break;
      }
      case 'applyForce': {
        const b = byId.get(c.id);
        b.fx += c.fx;
        b.fy += c.fy;
        break;
      }
      default:
        throw new Error(`unreachable op ${c.op}`); // validateProgram rejects unknown ops
    }
  }
  return { gravity, bodies };
}

function toSnapshotBody(b) {
  return {
    id: b.id,
    shape: b.shape,
    position: { x: b.x, y: b.y },
    velocity: { x: b.vx, y: b.vy },
    dimensions: b.shape === 'circle'
      ? { radius: b.radius }
      : { width: b.width, height: b.height },
    static: b.static,
  };
}

function halfHeight(b) {
  return b.shape === 'circle' ? b.radius : b.height / 2;
}

function collideFloor(b) {
  if (b.static) return;
  const pen = FLOOR_Y - (b.y - halfHeight(b));
  if (pen <= 0) return;
  b.y += pen;
  if (b.vy < 0) {
    const e = -b.vy < REST_SPEED ? 0 : Math.max(b.restitution, FLOOR_RESTITUTION);
    b.vy = -e * b.vy;
  }
}

// Contact normal n always points from a to b.
function collide(a, b) {
  if (a.static && b.static) return;
  let contact;
  if (a.shape === 'circle' && b.shape === 'circle') contact = circleCircle(a, b);
  else if (a.shape === 'box' && b.shape === 'box') contact = boxBox(a, b);
  else if (a.shape === 'circle') contact = flip(circleBox(a, b));
  else contact = circleBox(b, a);
  if (contact) resolve(a, b, contact.nx, contact.ny, contact.pen);
}

function flip(c) {
  return c && { nx: -c.nx, ny: -c.ny, pen: c.pen };
}

function circleCircle(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const r = a.radius + b.radius;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return null;
  const d = Math.sqrt(d2);
  if (d === 0) return { nx: 0, ny: 1, pen: r };
  return { nx: dx / d, ny: dy / d, pen: r - d };
}

function boxBox(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const ox = (a.width + b.width) / 2 - Math.abs(dx);
  const oy = (a.height + b.height) / 2 - Math.abs(dy);
  if (ox <= 0 || oy <= 0) return null;
  if (ox < oy) return { nx: dx < 0 ? -1 : 1, ny: 0, pen: ox };
  return { nx: 0, ny: dy < 0 ? -1 : 1, pen: oy };
}

// Returns a contact whose normal points from the box to the circle.
function circleBox(c, box) {
  const hw = box.width / 2;
  const hh = box.height / 2;
  const dx = c.x - box.x;
  const dy = c.y - box.y;
  const inside = Math.abs(dx) <= hw && Math.abs(dy) <= hh;
  if (inside) {
    const ox = hw - Math.abs(dx);
    const oy = hh - Math.abs(dy);
    if (ox < oy) return { nx: dx < 0 ? -1 : 1, ny: 0, pen: ox + c.radius };
    return { nx: 0, ny: dy < 0 ? -1 : 1, pen: oy + c.radius };
  }
  const px = Math.max(-hw, Math.min(hw, dx));
  const py = Math.max(-hh, Math.min(hh, dy));
  const ex = dx - px;
  const ey = dy - py;
  const d2 = ex * ex + ey * ey;
  if (d2 >= c.radius * c.radius) return null;
  const d = Math.sqrt(d2);
  return { nx: ex / d, ny: ey / d, pen: c.radius - d };
}

function resolve(a, b, nx, ny, pen) {
  const invSum = a.invMass + b.invMass;
  if (invSum === 0) return;
  const ka = a.invMass / invSum;
  const kb = b.invMass / invSum;
  a.x -= nx * pen * ka;
  a.y -= ny * pen * ka;
  b.x += nx * pen * kb;
  b.y += ny * pen * kb;
  const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (vn >= 0) return; // separating
  const e = -vn < REST_SPEED ? 0 : Math.max(a.restitution, b.restitution);
  const j = (-(1 + e) * vn) / invSum;
  a.vx -= j * a.invMass * nx;
  a.vy -= j * a.invMass * ny;
  b.vx += j * b.invMass * nx;
  b.vy += j * b.invMass * ny;
}
