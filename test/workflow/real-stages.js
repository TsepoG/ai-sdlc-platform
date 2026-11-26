// @ts-check
import { join } from 'node:path';
import { loadStages } from '../../src/stages/index.js';

const STAGES_DIR = join(import.meta.dirname, '../../config/stages');

/**
 * Load one stage from the real `config/stages` directory.
 * @param {string} key Stage key.
 * @returns {Promise<import('../../src/stages/index.js').StageDefinition>} The stage.
 * @throws {Error} When no stage has that key.
 */
export async function realStage(key) {
  const stage = (await loadStages(STAGES_DIR)).find((candidate) => candidate.key === key);
  if (stage === undefined) {
    throw new Error(`No stage "${key}" in ${STAGES_DIR}`);
  }
  return stage;
}
