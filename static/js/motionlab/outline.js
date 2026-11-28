// Stack outline: a text model of the Code Area for the keyboard-accessible stack list (and for tests).
// Pure: reads Blockly's JSON serialization, never Blockly itself.

import { BLOCK_LABELS, START_BLOCK_TYPE } from './compile.js';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : '?');
const name = (v) => (typeof v === 'string' && v !== '' ? `"${v}"` : '(no id)');

/** One-line, unit-labelled description of a block, e.g. `Create Ball "ball" at (0, 3) m, radius 0.25 m, 1 kg`. */
export function describeBlock(block) {
  const f = isPlainObject(block.fields) ? block.fields : {};
  const isStatic = f.STATIC === true || f.STATIC === 'TRUE';
  const label = BLOCK_LABELS[block.type] ?? block.type;
  switch (block.type) {
    case START_BLOCK_TYPE:
      return label;
    case 'motionlab_create_circle':
      return `${label} ${name(f.ID)} at (${num(f.X)}, ${num(f.Y)}) m, radius ${num(f.RADIUS)} m, ${num(f.MASS)} kg, restitution ${num(f.RESTITUTION)}${isStatic ? ', static' : ''}`;
    case 'motionlab_create_box':
      return `${label} ${name(f.ID)} at (${num(f.X)}, ${num(f.Y)}) m, ${num(f.WIDTH)} × ${num(f.HEIGHT)} m, ${num(f.MASS)} kg, restitution ${num(f.RESTITUTION)}${isStatic ? ', static' : ''}`;
    case 'motionlab_set_gravity':
      return `${label} (${num(f.X)}, ${num(f.Y)}) m/s²`;
    case 'motionlab_set_velocity':
      return `${label} of ${name(f.ID)}: (${num(f.VX)}, ${num(f.VY)}) m/s`;
    case 'motionlab_apply_force':
      return `${label} to ${name(f.ID)}: (${num(f.FX)}, ${num(f.FY)}) N`;
    default:
      return label;
  }
}

const chain = (head) => {
  const out = [];
  for (let b = head; isPlainObject(b); b = b.next?.block) out.push(b);
  return out;
};

/**
 * @returns {{stack: Array<Item>, loose: Array<Array<Item>>}}
 *   stack: the start block's stack in run order (start block first), or [] if there is no single start block.
 *   loose: every other top-level stack (not connected to the start block), each in order.
 *   Item: { id, type, label, summary, position } where position is 1-based within its stack.
 */
export function outlineWorkspace(workspace) {
  const top = isPlainObject(workspace) && isPlainObject(workspace.blocks) && Array.isArray(workspace.blocks.blocks)
    ? workspace.blocks.blocks.filter(isPlainObject) : [];
  const item = (b, i) => ({ id: b.id, type: b.type, label: BLOCK_LABELS[b.type] ?? b.type, summary: describeBlock(b), position: i + 1 });
  const starts = top.filter((b) => b.type === START_BLOCK_TYPE);
  const main = starts.length === 1 ? starts[0] : null;
  return {
    stack: main ? chain(main).map(item) : [],
    loose: top.filter((b) => b !== main).map((head) => chain(head).map(item)),
  };
}
