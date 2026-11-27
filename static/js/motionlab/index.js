// Public entry point for the MotionLab prototype modules (contract v1).
export {
  CONTRACT_VERSION, PROGRAM_VERSION, DT, FLOOR_Y, DEFAULT_GRAVITY, LIMITS,
  BODY_ID_PATTERN, ERROR_CODES, OPS, ProgramError, validateProgram,
} from './contract.js';
export { createSimulation, REST_SPEED, SOLVER_ITERATIONS, FLOOR_RESTITUTION } from './engine.js';
export { compileWorkspace, programToWorkspace, START_BLOCK_TYPE, BLOCK_TYPES } from './compile.js';
export { createViewTransform, fitView } from './view.js';
export { BLOCK_DEFINITIONS, TOOLBOX, FIELD_DEFAULTS, BLOCK_COLOURS, registerBlocks } from './blocks.js';
export { createPlayback, MAX_STEPS_PER_FRAME } from './playback.js';
export { drawScene, DEFAULT_THEME } from './renderer.js';
export {
  serializeWorkspaceFile, parseWorkspaceFile, FILE_FORMAT, FILE_VERSION, MAX_FILE_BYTES, FILE_ERROR_CODES,
} from './files.js';
