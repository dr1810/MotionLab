// Blockly block definitions and toolbox for MotionLab, generated from the contract so that
// number fields enforce the same ranges as validateProgram. Plain JSON: defineBlocks(Blockly) registers them.

import { LIMITS, OPS } from './contract.js';
import { BLOCK_LABELS, BLOCK_TYPES, START_BLOCK_TYPE } from './compile.js';

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
  motionlab_create_circle: { colour: COLOURS.bodies, tooltip: 'Create Ball: a circle. Position is its center in meters (+y up, floor at y = 0). Restitution 0 = no bounce, 1 = perfectly bouncy. Static balls never move.', rows: [['Create Ball  id %1', 'ID'], ['position  x %1 m   y %2 m', 'X', 'Y'], ['radius %1 m   mass %2 kg', 'RADIUS', 'MASS'], ['restitution %1   static %2', 'RESTITUTION', 'STATIC']] },
  motionlab_create_box: { colour: COLOURS.bodies, tooltip: 'Create Box: an axis-aligned box. Position is its center in meters (+y up, floor at y = 0). Restitution 0 = no bounce, 1 = perfectly bouncy. Static boxes never move.', rows: [['Create Box  id %1', 'ID'], ['position  x %1 m   y %2 m', 'X', 'Y'], ['width %1 m   height %2 m', 'WIDTH', 'HEIGHT'], ['mass %1 kg   restitution %2   static %3', 'MASS', 'RESTITUTION', 'STATIC']] },
  motionlab_set_gravity: { colour: COLOURS.world, tooltip: 'Set Gravity in m/s² (default x 0, y -9.81; +y is up). If there are several, the last one wins.', rows: [['Set Gravity  x %1 m/s²   y %2 m/s²', 'X', 'Y']] },
  motionlab_set_velocity: { colour: COLOURS.motion, tooltip: 'Set Initial Velocity of a body created above this block, in m/s (+x right, +y up). Static bodies cannot move.', rows: [['Set Initial Velocity  of %1', 'ID'], ['vx %1 m/s   vy %2 m/s', 'VX', 'VY']] },
  motionlab_apply_force: { colour: COLOURS.motion, tooltip: 'Apply Force to a body created above this block, in newtons. It acts during the first tick (1/120 s) only, and several forces on one body add up.', rows: [['Apply Force  to %1', 'ID'], ['fx %1 N   fy %2 N   (first tick)', 'FX', 'FY']] },
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
    message0: 'When simulation starts',
    nextStatement: null,
    colour: COLOURS.start,
    tooltip: 'When simulation starts: the blocks snapped under this run once, top to bottom, to build the scene. Only one is allowed; blocks not connected to it do not run.',
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

/**
 * Blockly's default block colour for a hue (Blockly.utils.colour.hueToHex: HSV saturation 0.45, value 0.65, same
 * sextant arithmetic and Math.floor truncation). Returns "#rrggbb". Keeps tray chips the same colour as their blocks.
 */
export function hueToHex(hue) {
  const s = 0.45;
  const brightness = 0.65 * 255;
  const h = ((hue % 360) + 360) % 360;
  const sextant = Math.floor(h / 60);
  const rem = h / 60 - sextant;
  const v1 = brightness * (1 - s);
  const v2 = brightness * (1 - s * rem);
  const v3 = brightness * (1 - s * (1 - rem));
  const rgb = [
    [brightness, v3, v1], [v2, brightness, v1], [v1, brightness, v3],
    [v1, v2, brightness], [v3, v1, brightness], [brightness, v1, v2],
  ][sextant];
  return `#${rgb.map((n) => Math.floor(n).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The Code Blocks tray (bottom of the page): groups of block chips. Each chip can be dragged into the Code Area or
 * activated (click / Enter / Space) to append the block to the end of the start stack.
 */
export const TRAY = Object.freeze([
  { name: 'Start', colour: hueToHex(COLOURS.start), blocks: [
    { type: START_BLOCK_TYPE, label: BLOCK_LABELS[START_BLOCK_TYPE], hint: 'one per experiment; blocks below it run in order' },
  ] },
  { name: 'Bodies', colour: hueToHex(COLOURS.bodies), blocks: [
    { type: 'motionlab_create_circle', label: BLOCK_LABELS['motionlab_create_circle'], hint: 'id, position (m), radius (m), mass (kg), restitution, static' },
    { type: 'motionlab_create_box', label: BLOCK_LABELS['motionlab_create_box'], hint: 'id, position (m), width, height (m), mass (kg), restitution, static' },
  ] },
  { name: 'World', colour: hueToHex(COLOURS.world), blocks: [
    { type: 'motionlab_set_gravity', label: BLOCK_LABELS['motionlab_set_gravity'], hint: 'x, y in m/s² (default 0, −9.81)' },
  ] },
  { name: 'Motion', colour: hueToHex(COLOURS.motion), blocks: [
    { type: 'motionlab_set_velocity', label: BLOCK_LABELS['motionlab_set_velocity'], hint: 'body id, vx, vy in m/s' },
    { type: 'motionlab_apply_force', label: BLOCK_LABELS['motionlab_apply_force'], hint: 'body id, fx, fy in N, first tick only' },
  ] },
]);

/** Drag-and-drop data type for tray chips. */
export const TRAY_DRAG_TYPE = 'application/x-motionlab-block';

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
