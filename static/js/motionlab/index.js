// Public entry point for MotionLab prototype modules.
export {
  CONTRACT_VERSION,
  PROGRAM_VERSION,
  DT,
  FLOOR_Y,
  DEFAULT_GRAVITY,
  LIMITS,
  OPS,
  ERROR_CODES,
  ProgramError,
  makeError,
  validateProgram,
} from './contract.js';
export { createSimulation, REST_SPEED, SOLVER_ITERATIONS, POSITION_ITERATIONS } from './engine.js';
export { compileWorkspace, programToWorkspace, BLOCK_TYPES, START_BLOCK_TYPE } from './compile.js';
export { createView, fitView } from './view.js';
