// MotionLab shared contract, version 1.
// Pure data + validation. No Blockly, DOM or engine imports, so it loads the same in Node and the browser.
// Spec: docs/CONTRACT.md

export const CONTRACT_VERSION = 1;
export const PROGRAM_VERSION = 1;

/** Fixed physics step in seconds. step() always advances exactly this much. */
export const DT = 1 / 120;
/** World y of the static floor (meters). The floor is not a body and never appears in snapshots. */
export const FLOOR_Y = 0;
/** Gravity used when no setGravity command runs (m/s², +y up). */
export const DEFAULT_GRAVITY = Object.freeze({ x: 0, y: -9.81 });

export const LIMITS = Object.freeze({
  maxCommands: 256,
  maxBodies: 32,
  maxBlockIdLength: 64,
  /** Body ids: letter or underscore first, then letters, digits, _ or -, 1..32 chars. */
  bodyIdPattern: /^[A-Za-z_][A-Za-z0-9_-]{0,31}$/,
  // Inclusive numeric ranges, by value kind.
  position: Object.freeze([-1000, 1000]), // m
  size: Object.freeze([0.01, 100]), // m (radius, width, height)
  mass: Object.freeze([0.001, 10000]), // kg (required even for static bodies)
  restitution: Object.freeze([0, 1]),
  gravity: Object.freeze([-100, 100]), // m/s²
  velocity: Object.freeze([-1000, 1000]), // m/s
  force: Object.freeze([-100000, 100000]), // N
});

/**
 * Command payloads. Each command is { op, blockId, ...fields }.
 * Value kinds: bodyId (new body), bodyRef (existing dynamic body), boolean, or a LIMITS range name.
 */
export const OPS = Object.freeze({
  createCircle: Object.freeze({ id: 'bodyId', x: 'position', y: 'position', radius: 'size', mass: 'mass', restitution: 'restitution', static: 'boolean' }),
  createBox: Object.freeze({ id: 'bodyId', x: 'position', y: 'position', width: 'size', height: 'size', mass: 'mass', restitution: 'restitution', static: 'boolean' }),
  setGravity: Object.freeze({ x: 'gravity', y: 'gravity' }),
  setVelocity: Object.freeze({ id: 'bodyRef', vx: 'velocity', vy: 'velocity' }),
  applyForce: Object.freeze({ id: 'bodyRef', fx: 'force', fy: 'force' }),
});

/** Every error code the contract, compiler and engine can produce. */
export const ERROR_CODES = Object.freeze({
  // Document level (blockId is always null)
  INVALID_DOCUMENT: 'INVALID_DOCUMENT',
  UNSUPPORTED_VERSION: 'UNSUPPORTED_VERSION',
  INVALID_COMMANDS: 'INVALID_COMMANDS',
  TOO_MANY_COMMANDS: 'TOO_MANY_COMMANDS',
  // Command level (blockId of the command, or null if the command has no usable blockId)
  INVALID_COMMAND: 'INVALID_COMMAND',
  INVALID_BLOCK_ID: 'INVALID_BLOCK_ID',
  DUPLICATE_BLOCK_ID: 'DUPLICATE_BLOCK_ID',
  UNKNOWN_OP: 'UNKNOWN_OP',
  UNKNOWN_FIELD: 'UNKNOWN_FIELD',
  MISSING_FIELD: 'MISSING_FIELD',
  INVALID_TYPE: 'INVALID_TYPE',
  INVALID_NUMBER: 'INVALID_NUMBER',
  OUT_OF_RANGE: 'OUT_OF_RANGE',
  INVALID_BODY_ID: 'INVALID_BODY_ID',
  DUPLICATE_BODY_ID: 'DUPLICATE_BODY_ID',
  UNKNOWN_BODY: 'UNKNOWN_BODY',
  STATIC_BODY: 'STATIC_BODY',
  TOO_MANY_BODIES: 'TOO_MANY_BODIES',
  BELOW_FLOOR: 'BELOW_FLOOR',
  // Workspace compiler (compile.js)
  INVALID_WORKSPACE: 'INVALID_WORKSPACE',
  NO_START_BLOCK: 'NO_START_BLOCK',
  MULTIPLE_START_BLOCKS: 'MULTIPLE_START_BLOCKS',
  UNKNOWN_BLOCK_TYPE: 'UNKNOWN_BLOCK_TYPE',
  // Thrown by createSimulation (ProgramError.code)
  INVALID_PROGRAM: 'INVALID_PROGRAM',
});

/** Build a contract error. blockId is null for document-level errors. */
export function makeError(code, message, blockId = null) {
  return { code, message, blockId: typeof blockId === 'string' ? blockId : null };
}

/** Thrown by createSimulation for an invalid program. `errors` is the validateProgram() list. */
export class ProgramError extends Error {
  constructor(errors) {
    const first = errors[0];
    super(first ? `Invalid program: ${first.message}${errors.length > 1 ? ` (+${errors.length - 1} more)` : ''}` : 'Invalid program');
    this.name = 'ProgramError';
    this.code = ERROR_CODES.INVALID_PROGRAM;
    this.errors = errors;
  }
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function validBlockId(v) {
  return typeof v === 'string' && v.length > 0 && v.length <= LIMITS.maxBlockIdLength;
}

/**
 * Validate a program v1 document. Never throws.
 * Errors are collected (not first-only) in a stable order: document errors, then commands in stack order,
 * and fields in OPS order within a command.
 * @returns {{ok: boolean, errors: Array<{code: string, message: string, blockId: string|null}>}}
 */
export function validateProgram(program) {
  const errors = [];
  const E = ERROR_CODES;

  if (!isPlainObject(program)) {
    errors.push(makeError(E.INVALID_DOCUMENT, 'Program must be a JSON object like {"version": 1, "commands": [...]}.'));
    return { ok: false, errors };
  }
  if (program.version !== PROGRAM_VERSION) {
    errors.push(makeError(E.UNSUPPORTED_VERSION, `Program version must be ${PROGRAM_VERSION}, got ${JSON.stringify(program.version)}. Set "version": ${PROGRAM_VERSION}.`));
  }
  for (const key of Object.keys(program)) {
    if (key !== 'version' && key !== 'commands') {
      errors.push(makeError(E.INVALID_DOCUMENT, `Unknown top-level field "${key}". A program has only "version" and "commands"; remove "${key}".`));
    }
  }
  if (!Array.isArray(program.commands)) {
    errors.push(makeError(E.INVALID_COMMANDS, 'Program "commands" must be an array of commands (use [] for an empty program).'));
    return { ok: false, errors };
  }
  if (program.commands.length > LIMITS.maxCommands) {
    errors.push(makeError(E.TOO_MANY_COMMANDS, `A program may have at most ${LIMITS.maxCommands} commands (got ${program.commands.length}). Remove ${program.commands.length - LIMITS.maxCommands} or more.`));
    return { ok: false, errors };
  }

  const seenBlockIds = new Set();
  /** Every body id any create command declares, to tell "created later" from "never created". */
  const createdIds = new Set(program.commands
    .filter((c) => isPlainObject(c) && (c.op === 'createCircle' || c.op === 'createBox') && typeof c.id === 'string')
    .map((c) => c.id));
  /** body id -> { static } for bodies created so far (stack order). */
  const bodies = new Map();

  program.commands.forEach((cmd, index) => {
    const where = `Command ${index + 1}`;
    if (!isPlainObject(cmd)) {
      errors.push(makeError(E.INVALID_COMMAND, `${where} must be an object with "op" and "blockId".`));
      return;
    }
    const blockId = validBlockId(cmd.blockId) ? cmd.blockId : null;
    const err = (code, message) => errors.push(makeError(code, message, blockId));

    if (blockId === null) {
      err(E.INVALID_BLOCK_ID, `${where} needs a "blockId" string of 1-${LIMITS.maxBlockIdLength} characters.`);
    } else if (seenBlockIds.has(blockId)) {
      err(E.DUPLICATE_BLOCK_ID, `${where} reuses blockId "${blockId}". Every command needs its own blockId.`);
    } else {
      seenBlockIds.add(blockId);
    }

    const spec = typeof cmd.op === 'string' && hasOwn(OPS, cmd.op) ? OPS[cmd.op] : null;
    if (!spec) {
      err(E.UNKNOWN_OP, `${where} has unknown op ${JSON.stringify(cmd.op)}. Use one of: ${Object.keys(OPS).join(', ')}.`);
      return;
    }
    const label = `${cmd.op} (${where.toLowerCase()})`;

    for (const key of Object.keys(cmd)) {
      if (key !== 'op' && key !== 'blockId' && !hasOwn(spec, key)) {
        err(E.UNKNOWN_FIELD, `${label}: unknown field "${key}". Allowed: ${Object.keys(spec).join(', ')}.`);
      }
    }

    let fieldsOk = true;
    for (const [field, kind] of Object.entries(spec)) {
      if (!hasOwn(cmd, field) || cmd[field] === undefined) {
        err(E.MISSING_FIELD, `${label}: missing "${field}". Add a value for "${field}".`);
        fieldsOk = false;
        continue;
      }
      const value = cmd[field];
      if (kind === 'boolean') {
        if (typeof value !== 'boolean') {
          err(E.INVALID_TYPE, `${label}: "${field}" must be true or false.`);
          fieldsOk = false;
        }
      } else if (kind === 'bodyId' || kind === 'bodyRef') {
        if (typeof value !== 'string') {
          err(E.INVALID_TYPE, `${label}: "${field}" must be a string body id.`);
          fieldsOk = false;
        } else if (!LIMITS.bodyIdPattern.test(value)) {
          err(E.INVALID_BODY_ID, `${label}: body id "${value}" must start with a letter or _ and use only letters, digits, _ or - (max 32).`);
          fieldsOk = false;
        }
      } else {
        const [min, max] = LIMITS[kind];
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          err(E.INVALID_NUMBER, `${label}: "${field}" must be a finite number (got ${JSON.stringify(value) ?? String(value)}).`);
          fieldsOk = false;
        } else if (value < min || value > max) {
          err(E.OUT_OF_RANGE, `${label}: "${field}" must be between ${min} and ${max} (got ${value}). Use a value in that range.`);
          fieldsOk = false;
        }
      }
    }

    // Cross-command rules (stack order matters).
    if (cmd.op === 'createCircle' || cmd.op === 'createBox') {
      if (typeof cmd.id === 'string' && LIMITS.bodyIdPattern.test(cmd.id)) {
        if (bodies.has(cmd.id)) {
          err(E.DUPLICATE_BODY_ID, `${label}: body id "${cmd.id}" is already used by a block above. Give this body a different name.`);
        } else if (bodies.size >= LIMITS.maxBodies) {
          err(E.TOO_MANY_BODIES, `${label}: a program may create at most ${LIMITS.maxBodies} bodies. Remove this or another body block.`);
        } else {
          bodies.set(cmd.id, { static: cmd.static === true });
        }
      }
      if (fieldsOk) {
        const half = cmd.op === 'createCircle' ? cmd.radius : cmd.height / 2;
        if (cmd.y - half < FLOOR_Y) {
          err(E.BELOW_FLOOR, `${label}: body "${cmd.id}" starts below the floor (bottom edge y = ${cmd.y - half} m, floor y = ${FLOOR_Y}). Set y to at least ${FLOOR_Y + half}.`);
        }
      }
    } else if (spec.id === 'bodyRef' && typeof cmd.id === 'string' && LIMITS.bodyIdPattern.test(cmd.id)) {
      const body = bodies.get(cmd.id);
      if (!body) {
        const later = createdIds.has(cmd.id);
        const known = [...bodies.keys()];
        err(E.UNKNOWN_BODY, later
          ? `${label}: body "${cmd.id}" is created further down. Move this block below the block that creates "${cmd.id}".`
          : `${label}: there is no body "${cmd.id}". ${known.length ? `Bodies created above: ${known.join(', ')}.` : 'Create a body above this block first.'}`);
      } else if (body.static) {
        err(E.STATIC_BODY, `${label}: body "${cmd.id}" is static, so it cannot be given a velocity or force. Untick "static" on "${cmd.id}" or remove this block.`);
      }
    }
  });

  return { ok: errors.length === 0, errors };
}
