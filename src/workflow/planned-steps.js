// @ts-check
import { evaluateCondition } from './conditions.js';

/** @import { StageDefinition, StepDefinition } from '../stages/index.js' */
/** @import { FlagContext } from './conditions.js' */

/**
 * @typedef {object} StepPlan
 * @property {ReadonlyArray<StepDefinition>} run Steps that run for these flags, in stage order.
 * @property {ReadonlyArray<StepDefinition>} skipped Steps whose condition is false, in stage order.
 */

/**
 * Split a stage's steps into those that run and those skipped for an Initiative's flags.
 * @param {StageDefinition} stage Validated stage.
 * @param {FlagContext} context The Initiative's flags.
 * @returns {StepPlan} Steps to run and steps to record as skipped.
 * @throws {import('../errors/index.js').StageConfigError} When a condition is malformed.
 */
export function plannedSteps(stage, context) {
  /** @type {StepDefinition[]} */
  const run = [];
  /** @type {StepDefinition[]} */
  const skipped = [];
  for (const step of stage.steps) {
    (evaluateCondition(step.condition, context) ? run : skipped).push(step);
  }
  return { run: Object.freeze(run), skipped: Object.freeze(skipped) };
}
