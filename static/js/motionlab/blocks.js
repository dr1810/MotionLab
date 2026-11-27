// Blockly block definitions and toolbox for MotionLab, generated from the contract so that
// number fields enforce the same ranges as validateProgram. Plain JSON: defineBlocks(Blockly) registers them.

import { LIMITS, OPS } from './contract.js';
import { BLOCK_TYPES, START_BLOCK_TYPE } from './compile.js';

export const BODY_BLOCK_TYPES = Object.freeze(['motionlab_create_circle', 'motionlab_create_box']);

/** Default field values for a freshly dragged block (also used by the toolbox). */
export const DEFAULTS = Object.freeze({
  motionlab_create_circle: { ID: 'ball', X: 0, Y: 2, RADIUS: 0.25, MASS: 1, RESTITUTION: 0.6, STATIC: false },
  motionlab_create_box: { ID: 'box', X: 2, Y: 0.5, WIDTH: 1, HEIGHT: 1, MASS: 2, RESTITUTION: 0.2, STATIC: false },
  motionlab_set_gravity: { X: 0, Y: -9.81 },
  motionlab_set_velocity: { ID: 'ball', VX: 2, VY: 0 },
  motionlab_apply_force: { ID: 'ball', FX: 100, FY: 0 },
});

const COLOURS = { start: 45, bodies: 200, world: 270, motion: 15 };

/** Rows of [message, ...field names] per block type; %n placeholders are filled in order. */
const LAYOUT = {
  motionlab_create_circle: { colour: COLOURS.bodies, tooltip: 'Add a circle. Position is its center, in meters (+y up, floor at y = 0).', rows: [['create circle %1', 'ID'], ['x %1 y %2 m', 'X', 'Y'], ['radius %1 m  mass %2 kg', 'RADIUS', 'MASS'], ['bounce %1  static %2', 'RESTITUTION', 'STATIC']] },
  motionlab_create_box: { colour: COLOURS.bodies, tooltip: 'Add a box. Position is its center, in meters (+y up, floor at y = 0).', rows: [['create box %1', 'ID'], ['x %1 y %2 m', 'X', 'Y'], ['width %1 height %2 m', 'WIDTH', 'HEIGHT'], ['mass %1 kg  bounce %2  static %3', 'MASS', 'RESTITUTION', 'STATIC']] },
  motionlab_set_gravity: { colour: COLOURS.world, tooltip: 'Set gravity in m/s² (default 0, -9.81). The last one wins.', rows: [['set gravity x %1 y %2 m/s²', 'X', 'Y']] },
  motionlab_set_velocity: { colour: COLOURS.motion, tooltip: 'Set the starting velocity of a body created above this block.', rows: [['set velocity of %1', 'ID'], ['vx %1 vy %2 m/s', 'VX', 'VY']] },
  motionlab_apply_force: { colour: COLOURS.motion, tooltip: 'Push a body created above this block. The force acts for the first 1/120 s only; forces add up.', rows: [['apply force to %1', 'ID'], ['fx %1 fy %2 N', 'FX', 'FY']] },
};

function fieldArg(type, name) {
  const { op, fields } = BLOCK_TYPES[type];
  const kind = OPS[op][fields[name]];
  const value = DEFAULTS[type][name];
  if (kind === 'boolean') return { type: 'field_checkbox', name, checked: value };
  if (kind === 'bodyId' || kind === 'bodyRef') return { type: 'field_input', name, text: value, spellcheck: false };
  const [min, max] = LIMITS[kind];
  return { type: 'field_number', name, value, min, max };
}

/** JSON block definitions for Blockly.defineBlocksWithJsonArray. */
export const BLOCK_DEFINITIONS = Object.freeze([
  {
    type: START_BLOCK_TYPE,
    message0: 'when experiment starts',
    nextStatement: null,
    colour: COLOURS.start,
    tooltip: 'Blocks snapped under this run once, top to bottom, to build the scene. Only one start block is allowed.',
  },
  ...Object.entries(LAYOUT).map(([type, { colour, tooltip, rows }]) => {
    const def = { type, previousStatement: null, nextStatement: null, colour, tooltip };
    rows.forEach(([message, ...names], i) => {
      def[`message${i}`] = message;
      def[`args${i}`] = names.map((name) => fieldArg(type, name));
    });
    return def;
  }),
]);

/** Category toolbox. The start block is limited to one instance via inject({maxInstances}). */
export const TOOLBOX = Object.freeze({
  kind: 'categoryToolbox',
  contents: [
    { kind: 'category', name: 'Start', colour: String(COLOURS.start), contents: [{ kind: 'block', type: START_BLOCK_TYPE }] },
    { kind: 'category', name: 'Bodies', colour: String(COLOURS.bodies), contents: BODY_BLOCK_TYPES.map((type) => ({ kind: 'block', type })) },
    { kind: 'category', name: 'World', colour: String(COLOURS.world), contents: [{ kind: 'block', type: 'motionlab_set_gravity' }] },
    { kind: 'category', name: 'Motion', colour: String(COLOURS.motion), contents: [{ kind: 'block', type: 'motionlab_set_velocity' }, { kind: 'block', type: 'motionlab_apply_force' }] },
  ],
});

export const MAX_INSTANCES = Object.freeze({ [START_BLOCK_TYPE]: 1 });

/** Register the blocks with a Blockly instance (the global from the CDN build). */
export function defineBlocks(Blockly) {
  Blockly.defineBlocksWithJsonArray(BLOCK_DEFINITIONS);
}

/** First of base, base2, base3, ... not in `taken`. Used to rename a dragged-in body that clashes. */
export function uniqueBodyId(taken, base) {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  const stem = String(base).replace(/\d+$/, '') || 'body';
  for (let n = 2; ; n++) {
    const suffix = String(n);
    const candidate = stem.slice(0, 32 - suffix.length) + suffix; // stay within the 32-char id limit
    if (!set.has(candidate)) return candidate;
  }
}
