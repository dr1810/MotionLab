// MotionLab engine: interprets a program v1 into a deterministic 2D scene and steps it.
// Own minimal engine (no Matter.js): SI units, +x right, +y up, body-centered positions,
// axis-aligned boxes and circles, no rotation, no friction. Spec: docs/CONTRACT.md

import { DT, FLOOR_Y, DEFAULT_GRAVITY, ProgramError, validateProgram } from './contract.js';

/** Contacts closing slower than this (m/s) do not bounce. Stops resting bodies from jittering. */
export const REST_SPEED = 0.2;
/** Velocity (impulse) solver passes per step. */
export const SOLVER_ITERATIONS = 8;
/** Position-correction passes per step. */
export const POSITION_ITERATIONS = 4;
const BODY_CORRECTION = 0.8; // share of body-body overlap removed per pass
const BODY_SLOP = 0.0005; // m of body-body overlap tolerated
/** The floor as an immovable contact partner. */
const FLOOR = Object.freeze({ vx: 0, vy: 0, restitution: 0 });

/**
 * Interpret program commands in stack order into the initial scene. Assumes a validated program.
 * Returns plain data that the step loop copies; the program object is never retained.
 */
function interpret(program) {
  const scene = { gravity: { x: DEFAULT_GRAVITY.x, y: DEFAULT_GRAVITY.y }, bodies: [] };
  const byId = new Map();
  for (const cmd of program.commands) {
    switch (cmd.op) {
      case 'createCircle':
      case 'createBox': {
        const circle = cmd.op === 'createCircle';
        const body = {
          id: cmd.id,
          shape: circle ? 'circle' : 'box',
          x: cmd.x,
          y: cmd.y,
          vx: 0,
          vy: 0,
          radius: circle ? cmd.radius : 0,
          width: circle ? 0 : cmd.width,
          height: circle ? 0 : cmd.height,
          mass: cmd.mass,
          restitution: cmd.restitution,
          static: cmd.static,
          fx: 0, // force accumulated for the first tick only
          fy: 0,
        };
        scene.bodies.push(body);
        byId.set(body.id, body);
        break;
      }
      case 'setGravity':
        scene.gravity = { x: cmd.x, y: cmd.y };
        break;
      case 'setVelocity': {
        const body = byId.get(cmd.id);
        body.vx = cmd.vx;
        body.vy = cmd.vy;
        break;
      }
      case 'applyForce': {
        const body = byId.get(cmd.id);
        body.fx += cmd.fx;
        body.fy += cmd.fy;
        break;
      }
      default:
        throw new Error(`unreachable op ${cmd.op}`);
    }
  }
  return scene;
}

const cloneBodies = (bodies) => bodies.map((b) => ({ ...b }));
const clean = (n) => (n === 0 ? 0 : n); // normalize -0 so snapshots compare and serialize cleanly
const halfHeight = (b) => (b.shape === 'circle' ? b.radius : b.height / 2);

/** Contact between a and b: normal (nx, ny) points from a to b; depth > 0 means overlap. Null if apart. */
function contact(a, b) {
  if (a.shape === 'circle' && b.shape === 'circle') {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const r = a.radius + b.radius;
    const d2 = dx * dx + dy * dy;
    if (d2 >= r * r) return null;
    const d = Math.sqrt(d2);
    return d === 0 ? { nx: 0, ny: 1, depth: r } : { nx: dx / d, ny: dy / d, depth: r - d };
  }
  if (a.shape === 'box' && b.shape === 'box') {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const ox = a.width / 2 + b.width / 2 - Math.abs(dx);
    const oy = a.height / 2 + b.height / 2 - Math.abs(dy);
    if (ox <= 0 || oy <= 0) return null;
    return ox < oy ? { nx: dx < 0 ? -1 : 1, ny: 0, depth: ox } : { nx: 0, ny: dy < 0 ? -1 : 1, depth: oy };
  }
  if (a.shape === 'circle') {
    const c = contact(b, a);
    return c && { nx: -c.nx, ny: -c.ny, depth: c.depth };
  }
  // a is a box, b is a circle.
  const hw = a.width / 2;
  const hh = a.height / 2;
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  if (Math.abs(rx) <= hw && Math.abs(ry) <= hh) {
    // Circle center inside the box: push out through the nearest face.
    const fx = hw - Math.abs(rx);
    const fy = hh - Math.abs(ry);
    return fx < fy
      ? { nx: rx < 0 ? -1 : 1, ny: 0, depth: b.radius + fx }
      : { nx: 0, ny: ry < 0 ? -1 : 1, depth: b.radius + fy };
  }
  const dx = rx - Math.max(-hw, Math.min(hw, rx));
  const dy = ry - Math.max(-hh, Math.min(hh, ry));
  const d2 = dx * dx + dy * dy;
  if (d2 >= b.radius * b.radius) return null;
  const d = Math.sqrt(d2);
  return { nx: dx / d, ny: dy / d, depth: b.radius - d };
}

const invMass = (b) => (b === FLOOR || b.static ? 0 : 1 / b.mass);

/**
 * Collect this step's contacts (body pairs in creation order, then the floor) after integration.
 * Each contact fixes its target separation speed from the velocities before solving, so a bounce
 * survives being solved together with other contacts (e.g. a ball landing on a box that rests on the floor).
 */
function collectContacts(bodies) {
  const contacts = [];
  const add = (a, b, nx, ny) => {
    const ia = invMass(a);
    const ib = invMass(b);
    if (ia + ib === 0) return;
    const vn0 = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    const e = Math.max(a.restitution, b.restitution);
    contacts.push({ a, b, ia, ib, nx, ny, target: vn0 < -REST_SPEED ? -e * vn0 : 0, impulse: 0 });
  };
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const c = contact(bodies[i], bodies[j]);
      if (c) add(bodies[i], bodies[j], c.nx, c.ny);
    }
  }
  for (const b of bodies) {
    if (!b.static && b.y - halfHeight(b) < FLOOR_Y) add(FLOOR, b, 0, 1);
  }
  return contacts;
}

/** One sequential-impulse pass. Accumulated impulse per contact is clamped >= 0 (contacts only push). */
function solveVelocities(contacts) {
  for (const c of contacts) {
    const { a, b, ia, ib, nx, ny } = c;
    const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    const total = Math.max(c.impulse + (c.target - vn) / (ia + ib), 0);
    const j = total - c.impulse;
    c.impulse = total;
    if (j === 0) continue;
    if (ia) {
      a.vx -= j * ia * nx;
      a.vy -= j * ia * ny;
    }
    b.vx += j * ib * nx;
    b.vy += j * ib * ny;
  }
}

/** Push overlapping bodies apart (split by inverse mass), then put every dynamic body back on or above the floor. */
function correctPositions(bodies) {
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i];
      const b = bodies[j];
      const ia = invMass(a);
      const ib = invMass(b);
      if (ia + ib === 0) continue;
      const c = contact(a, b);
      if (!c) continue;
      const corr = (Math.max(c.depth - BODY_SLOP, 0) * BODY_CORRECTION) / (ia + ib);
      a.x -= c.nx * corr * ia;
      a.y -= c.ny * corr * ia;
      b.x += c.nx * corr * ib;
      b.y += c.ny * corr * ib;
    }
  }
  for (const b of bodies) {
    if (!b.static && b.y - halfHeight(b) < FLOOR_Y) b.y = FLOOR_Y + halfHeight(b);
  }
}

function bodySnapshot(b) {
  return {
    id: b.id,
    shape: b.shape,
    position: { x: clean(b.x), y: clean(b.y) },
    velocity: { x: clean(b.vx), y: clean(b.vy) },
    dimensions: b.shape === 'circle' ? { radius: b.radius } : { width: b.width, height: b.height },
    static: b.static,
  };
}

/**
 * Compile and start a simulation.
 * @param {{version: 1, commands: object[]}} program  program v1 (see docs/CONTRACT.md)
 * @returns {{step: () => Snapshot, reset: () => Snapshot, snapshot: () => Snapshot}}
 * @throws {ProgramError} with .code 'INVALID_PROGRAM' and .errors (validateProgram list) when invalid
 */
export function createSimulation(program) {
  const { ok, errors } = validateProgram(program);
  if (!ok) throw new ProgramError(errors);

  const initial = interpret(program);
  const gravity = initial.gravity;
  let bodies;
  let tick;

  function snapshot() {
    return { tick, time: tick * DT, bodies: bodies.map(bodySnapshot) };
  }

  function reset() {
    bodies = cloneBodies(initial.bodies);
    tick = 0;
    return snapshot();
  }

  function step() {
    const firstTick = tick === 0;
    for (const b of bodies) {
      if (b.static) continue;
      let ax = gravity.x;
      let ay = gravity.y;
      if (firstTick) {
        ax += b.fx / b.mass;
        ay += b.fy / b.mass;
      }
      // Semi-implicit Euler: velocity first, then position with the new velocity.
      b.vx += ax * DT;
      b.vy += ay * DT;
      b.x += b.vx * DT;
      b.y += b.vy * DT;
    }
    const contacts = collectContacts(bodies);
    for (let pass = 0; pass < SOLVER_ITERATIONS; pass++) solveVelocities(contacts);
    for (let pass = 0; pass < POSITION_ITERATIONS; pass++) correctPositions(bodies);
    tick += 1;
    return snapshot();
  }

  reset();
  return Object.freeze({ step, reset, snapshot });
}

