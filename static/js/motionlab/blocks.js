// Blockly block definitions and toolbox for MotionLab, as plain JSON derived from the contract.
// Blockly itself is passed in to registerBlocks(); this module never imports it, so the
// definitions are testable in Node and the contract stays Blockly-free.

import { OPS } from './contract.js';
import { START_BLOCK_TYPE, BLOCK_TYPES } from './compile.js';

export const BLOCK_COLOURS = Object.freeze({ start: 45, body: 260, world: 200, motion: 330 });

const OP_TO_TYPE = Object.fromEntries(Object.entries(BLOCK_TYPES).map(([type, op]) => [op, type]));

const LABELS = {
  createCircle: { title: 'create ball', colour: BLOCK_COLOURS.body },
  createBox: { title: 'create box', colour: BLOCK_COLOURS.body },
  setGravity: { title: 'set gravity', colour: BLOCK_COLOURS.world },
  setVelocity: { title: 'set velocity of', colour: BLOCK_COLOURS.motion },
  applyForce: { title: 'push', colour: BLOCK_COLOURS.motion },
};

const FIELD_LABELS = {
  x: 'x', y: 'y', radius: 'radius', width: 'width', height: 'height', mass: 'mass',
  restitution: 'bounciness', static: 'fixed in place', vx: 'vx', vy: 'vy', fx: 'fx', fy: 'fy',
};

const UNITS = {
  x: 'm', y: 'm', radius: 'm', width: 'm', height: 'm', mass: 'kg', vx: 'm/s', vy: 'm/s', fx: 'N', fy: 'N',
};

const PRECISION = { restitution: 0.01 };

/** Default field values used by the toolbox. */
export const FIELD_DEFAULTS = Object.freeze({
  createCircle: { ID: 'ball', X: 0, Y: 2, RADIUS: 0.25, MASS: 1, RESTITUTION: 0.6, STATIC: false },
  createBox: { ID: 'box', X: 2, Y: 0.5, WIDTH: 1, HEIGHT: 1, MASS: 2, RESTITUTION: 0.2, STATIC: false },
  setGravity: { X: 0, Y: -9.81 },
  setVelocity: { ID: 'ball', VX: 1, VY: 0 },
  applyForce: { ID: 'ball', FX: 100, FY: 0 },
});

// Fields shown on each row of a block; the first row also carries the title.
const ROWS = {
  createCircle: [['id'], ['x', 'y'], ['radius', 'mass'], ['restitution', 'static']],
  createBox: [['id'], ['x', 'y'], ['width', 'height'], ['mass'], ['restitution', 'static']],
  setGravity: [['x', 'y']],
  setVelocity: [['id', 'vx', 'vy']],
  applyForce: [['id', 'fx', 'fy']],
};

function fieldArg(op, name, kind, range) {
  const key = name.toUpperCase();
  const value = FIELD_DEFAULTS[op][key];
  if (kind === 'id') return { text: '%1', arg: { type: 'field_input', name: key, text: value, spellcheck: false } };
  if (kind === 'boolean') return { text: `${FIELD_LABELS[name]} %1`, arg: { type: 'field_checkbox', name: key, checked: value } };
  const unit = UNITS[name] ? ` ${UNITS[name]}` : '';
  return {
    text: `${FIELD_LABELS[name]} %1${unit}`,
    arg: {
      type: 'field_number', name: key, value, min: range.min, max: range.max,
      ...(PRECISION[name] ? { precision: PRECISION[name] } : {}),
    },
  };
}

function blockDefinition(op) {
  const specs = Object.fromEntries(OPS[op].map((f) => [f[0], f]));
  const def = { type: OP_TO_TYPE[op] };
  ROWS[op].forEach((row, i) => {
    const parts = i === 0 ? [LABELS[op].title] : [];
    const args = [];
    for (const name of row) {
      const [, kind, range] = specs[name];
      const { text, arg } = fieldArg(op, name, kind, range);
      parts.push(text.replace('%1', `%${args.length + 1}`));
      args.push(arg);
    }
    def[`message${i}`] = parts.join(' ');
    def[`args${i}`] = args;
  });
  return {
    ...def,
    previousStatement: null,
    nextStatement: null,
    colour: LABELS[op].colour,
    tooltip: tooltipFor(op),
    inputsInline: false,
  };
}

function tooltipFor(op) {
  switch (op) {
    case 'createCircle': return 'Add a ball. Fixed-in-place bodies never move.';
    case 'createBox': return 'Add a box (it does not rotate). Fixed-in-place bodies never move.';
    case 'setGravity': return 'Set gravity for the whole scene (default 0, -9.81 m/s²). The last one wins.';
    case 'setVelocity': return 'Give a body created above this block a starting velocity.';
    case 'applyForce': return 'Push a body created above this block during the first 1/120 s only.';
    default: return '';
  }
}

export const BLOCK_DEFINITIONS = Object.freeze([
  {
    type: START_BLOCK_TYPE,
    message0: 'when experiment starts',
    nextStatement: null,
    colour: BLOCK_COLOURS.start,
    tooltip: 'Only blocks attached below this one run. There can be only one.',
  },
  ...Object.keys(OPS).map(blockDefinition),
]);

export const TOOLBOX = Object.freeze({
  kind: 'categoryToolbox',
  contents: [
    { kind: 'category', name: 'Start', colour: String(BLOCK_COLOURS.start), contents: [{ kind: 'block', type: START_BLOCK_TYPE }] },
    {
      kind: 'category', name: 'Bodies', colour: String(BLOCK_COLOURS.body),
      contents: ['createCircle', 'createBox'].map((op) => ({ kind: 'block', type: OP_TO_TYPE[op] })),
    },
    { kind: 'category', name: 'World', colour: String(BLOCK_COLOURS.world), contents: [{ kind: 'block', type: OP_TO_TYPE.setGravity }] },
    {
      kind: 'category', name: 'Motion', colour: String(BLOCK_COLOURS.motion),
      contents: ['setVelocity', 'applyForce'].map((op) => ({ kind: 'block', type: OP_TO_TYPE[op] })),
    },
  ],
});

let registered = false;
/** Register MotionLab blocks with a Blockly instance (idempotent). */
export function registerBlocks(Blockly) {
  if (registered) return;
  Blockly.common.defineBlocksWithJsonArray(BLOCK_DEFINITIONS);
  registered = true;
}
