// @ts-check
import { StageConfigError } from '../errors/index.js';
import { CONDITION_PATTERN } from '../stages/index.js';

/**
 * @typedef {object} FlagContext
 * @property {Readonly<Record<string, boolean>>} flags Initiative flags, e.g. `{ requiresPreprod: true }`.
 */

/**
 * Decide whether a step's condition holds for an Initiative's flags.
 * @param {string | undefined} condition `initiative.flags.<name>`, or undefined for "always".
 * @param {FlagContext} context The Initiative's flags.
 * @returns {boolean} True when there is no condition or the named flag is exactly `true`.
 * @throws {StageConfigError} When the condition is not in the one supported form; stage loading
 *   rejects these, so reaching here means the stage was not validated.
 */
export function evaluateCondition(condition, { flags }) {
  if (condition === undefined) {
    return true;
  }
  const match = CONDITION_PATTERN.exec(condition);
  if (match === null) {
    throw new StageConfigError([
      { source: 'condition', path: '(root)', message: `Unsupported condition "${condition}"` },
    ]);
  }
  const name = match[1];
  return Object.hasOwn(flags, name) && flags[name] === true;
}
