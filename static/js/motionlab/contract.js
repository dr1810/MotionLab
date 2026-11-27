// MotionLab shared contract, version 1.
// Pure data + validation. No Blockly, DOM or engine types live here.
// See docs/CONTRACT.md for the human-readable specification.

export const CONTRACT_VERSION = 1;
export const PROGRAM_VERSION = 1;

/** Fixed physics step in seconds. step() always advances exactly this much. */
export const DT = 1 / 120;

/** World y-coordinate of the static floor (meters). Renderers read this constant. */
export const FLOOR_Y = 0;

/** Gravity used when a program contains no setGravity command (m/s^2). */
export const DEFAULT_GRAVITY = Object.freeze({ x: 0, y: -9.81 });

export const LIMITS = Object.freeze({
  maxCommands: 200,
  maxBodies: 50,
  maxBlockIdLength: 64,
  maxBodyIdLength: 32,
  position: 1000, // |x|, |y| <= 1000 m
  radius: Object.freeze({ min: 0.01, max: 100 }), // m
  size: Object.freeze({ min: 0.01, max: 200 }), // box width/height, m
  mass: Object.freeze({ min: 0.001, max: 10000 }), // kg
  restitution: Object.freeze({ min: 0, max: 1 }),
  gravity: 100, // |gx|, |gy| <= 100 m/s^2
  velocity: 500, // |vx|, |vy| <= 500 m/s
  force: 1e6, // |fx|, |fy| <= 1e6 N
});

export const BODY_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

export const ERROR_CODES = Object.freeze({
  INVALID_DOCUMENT: 'INVALID_DOCUMENT',
  UNSUPPORTED_VERSION: 'UNSUPPORTED_VERSION',
  TOO_MANY_COMMANDS: 'TOO_MANY_COMMANDS',
  INVALID_COMMAND: 'INVALID_COMMAND',
  DUPLICATE_BLOCK_ID: 'DUPLICATE_BLOCK_ID',
  UNKNOWN_OP: 'UNKNOWN_OP',
  MISSING_FIELD: 'MISSING_FIELD',
  UNKNOWN_FIELD: 'UNKNOWN_FIELD',
  INVALID_TYPE: 'INVALID_TYPE',
  OUT_OF_RANGE: 'OUT_OF_RANGE',
  INVALID_ID: 'INVALID_ID',
  DUPLICATE_BODY_ID: 'DUPLICATE_BODY_ID',
  TOO_MANY_BODIES: 'TOO_MANY_BODIES',
  UNKNOWN_BODY: 'UNKNOWN_BODY',
  STATIC_BODY_TARGET: 'STATIC_BODY_TARGET',
  BODY_BELOW_FLOOR: 'BODY_BELOW_FLOOR',
  // Workspace compiler (compile.js) codes:
  NO_START_BLOCK: 'NO_START_BLOCK',
  MULTIPLE_START_BLOCKS: 'MULTIPLE_START_BLOCKS',
  UNKNOWN_BLOCK_TYPE: 'UNKNOWN_BLOCK_TYPE',
});

const L = LIMITS;
const sym = (m) => ({ min: -m, max: m });

// Field specs per op, in payload order. kind: 'id' | 'number' | 'boolean'.
export const OPS = Object.freeze({
  createCircle: [
    ['id', 'id'],
    ['x', 'number', sym(L.position)],
    ['y', 'number', sym(L.position)],
    ['radius', 'number', L.radius],
    ['mass', 'number', L.mass],
    ['restitution', 'number', L.restitution],
    ['static', 'boolean'],
  ],
  createBox: [
    ['id', 'id'],
    ['x', 'number', sym(L.position)],
    ['y', 'number', sym(L.position)],
    ['width', 'number', L.size],
    ['height', 'number', L.size],
    ['mass', 'number', L.mass],
    ['restitution', 'number', L.restitution],
    ['static', 'boolean'],
  ],
  setGravity: [
    ['x', 'number', sym(L.gravity)],
    ['y', 'number', sym(L.gravity)],
  ],
  setVelocity: [
    ['id', 'id'],
    ['vx', 'number', sym(L.velocity)],
    ['vy', 'number', sym(L.velocity)],
  ],
  applyForce: [
    ['id', 'id'],
    ['fx', 'number', sym(L.force)],
    ['fy', 'number', sym(L.force)],
  ],
});

/** Error thrown by createSimulation() for an invalid program. */
export class ProgramError extends Error {
  constructor(errors) {
    super(errors.length ? `${errors[0].code}: ${errors[0].message}` : 'Invalid program');
    this.name = 'ProgramError';
    this.errors = errors;
  }
}

const err = (code, message, blockId = null) => ({ code, message, blockId });
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Validate a program v1 document.
 * Returns { ok: true, errors: [] } or { ok: false, errors: [{code, message, blockId}] }.
 * Document-level errors (blockId null) stop validation; command errors are all collected,
 * in command order. Never throws, never mutates the input.
 */
export function validateProgram(program) {
  if (!isPlainObject(program)) {
    return fail([err(ERROR_CODES.INVALID_DOCUMENT, 'Program must be an object {version, commands}.')]);
  }
  for (const key of Object.keys(program)) {
    if (key !== 'version' && key !== 'commands') {
      return fail([err(ERROR_CODES.INVALID_DOCUMENT, `Unknown top-level field "${key}".`)]);
    }
  }
  if (program.version !== PROGRAM_VERSION) {
    return fail([err(ERROR_CODES.UNSUPPORTED_VERSION,
      `Unsupported program version ${JSON.stringify(program.version)}; expected ${PROGRAM_VERSION}.`)]);
  }
  if (!Array.isArray(program.commands)) {
    return fail([err(ERROR_CODES.INVALID_DOCUMENT, '"commands" must be an array.')]);
  }
  if (program.commands.length > L.maxCommands) {
    return fail([err(ERROR_CODES.TOO_MANY_COMMANDS,
      `Program has ${program.commands.length} commands; the limit is ${L.maxCommands}.`)]);
  }

  const errors = [];
  const blockIds = new Set();
  const bodies = new Map(); // id -> { static }
  let bodyCount = 0;

  program.commands.forEach((cmd, index) => {
    if (!isPlainObject(cmd)) {
      errors.push(err(ERROR_CODES.INVALID_COMMAND, `Command ${index} must be an object.`));
      return;
    }
    const { blockId } = cmd;
    if (typeof blockId !== 'string' || blockId.length === 0 || blockId.length > L.maxBlockIdLength) {
      errors.push(err(ERROR_CODES.INVALID_COMMAND,
        `Command ${index} needs a blockId string of 1-${L.maxBlockIdLength} characters.`));
      return;
    }
    if (blockIds.has(blockId)) {
      errors.push(err(ERROR_CODES.DUPLICATE_BLOCK_ID, `blockId "${blockId}" is used more than once.`, blockId));
      return;
    }
    blockIds.add(blockId);

    const spec = Object.prototype.hasOwnProperty.call(OPS, cmd.op) ? OPS[cmd.op] : null;
    if (!spec) {
      errors.push(err(ERROR_CODES.UNKNOWN_OP, `Unknown op ${JSON.stringify(cmd.op)}.`, blockId));
      return;
    }

    const allowed = new Set(['op', 'blockId', ...spec.map((f) => f[0])]);
    let bad = false;
    for (const key of Object.keys(cmd)) {
      if (!allowed.has(key)) {
        errors.push(err(ERROR_CODES.UNKNOWN_FIELD, `${cmd.op} does not take field "${key}".`, blockId));
        bad = true;
      }
    }
    for (const [name, kind, range] of spec) {
      if (!(name in cmd)) {
        errors.push(err(ERROR_CODES.MISSING_FIELD, `${cmd.op} is missing "${name}".`, blockId));
        bad = true;
        continue;
      }
      const v = cmd[name];
      if (kind === 'id') {
        if (typeof v !== 'string' || v.length === 0 || v.length > L.maxBodyIdLength || !BODY_ID_PATTERN.test(v)) {
          errors.push(err(ERROR_CODES.INVALID_ID,
            `Body id must start with a letter, use letters, digits, "_" or "-", and be 1-${L.maxBodyIdLength} characters.`,
            blockId));
          bad = true;
        }
      } else if (kind === 'boolean') {
        if (typeof v !== 'boolean') {
          errors.push(err(ERROR_CODES.INVALID_TYPE, `"${name}" must be true or false.`, blockId));
          bad = true;
        }
      } else if (typeof v !== 'number' || !Number.isFinite(v)) {
        errors.push(err(ERROR_CODES.INVALID_TYPE, `"${name}" must be a finite number.`, blockId));
        bad = true;
      } else if (v < range.min || v > range.max) {
        errors.push(err(ERROR_CODES.OUT_OF_RANGE,
          `"${name}" is ${v}; allowed range is ${range.min} to ${range.max}.`, blockId));
        bad = true;
      }
    }
    if (bad) {
      // A create block with a bad value still declares its body, so blocks below that
      // reference it are not also reported as UNKNOWN_BODY.
      const isCreate = cmd.op === 'createCircle' || cmd.op === 'createBox';
      if (isCreate && typeof cmd.id === 'string' && BODY_ID_PATTERN.test(cmd.id) && !bodies.has(cmd.id)) {
        bodies.set(cmd.id, { static: cmd.static === true });
        bodyCount += 1;
      }
      return;
    }

    // Semantic checks, in stack order.
    if (cmd.op === 'createCircle' || cmd.op === 'createBox') {
      if (bodies.has(cmd.id)) {
        errors.push(err(ERROR_CODES.DUPLICATE_BODY_ID, `A body named "${cmd.id}" already exists.`, blockId));
        return;
      }
      bodyCount += 1;
      if (bodyCount > L.maxBodies) {
        errors.push(err(ERROR_CODES.TOO_MANY_BODIES, `More than ${L.maxBodies} bodies.`, blockId));
        return;
      }
      const halfHeight = cmd.op === 'createCircle' ? cmd.radius : cmd.height / 2;
      if (!cmd.static && cmd.y - halfHeight < FLOOR_Y) {
        errors.push(err(ERROR_CODES.BODY_BELOW_FLOOR,
          `Body "${cmd.id}" starts below the floor (its bottom is at y=${cmd.y - halfHeight}).`, blockId));
        // Still register it so later references are not reported as unknown.
      }
      bodies.set(cmd.id, { static: cmd.static });
    } else if (cmd.op === 'setVelocity' || cmd.op === 'applyForce') {
      const body = bodies.get(cmd.id);
      if (!body) {
        errors.push(err(ERROR_CODES.UNKNOWN_BODY,
          `No body named "${cmd.id}" has been created above this block.`, blockId));
      } else if (body.static) {
        errors.push(err(ERROR_CODES.STATIC_BODY_TARGET,
          `Body "${cmd.id}" is static and cannot be moved by ${cmd.op}.`, blockId));
      }
    }
  });

  return errors.length ? fail(errors) : { ok: true, errors: [] };
}

function fail(errors) {
  return { ok: false, errors };
}
