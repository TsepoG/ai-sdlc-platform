// @ts-check
import { InvalidTransitionError } from '../errors/index.js';
import { plannedSteps } from './planned-steps.js';

/** @import { StageDefinition, StepDefinition } from '../stages/index.js' */
/** @import { FlagContext } from './conditions.js' */

/**
 * @typedef {object} StepOutcome
 * @property {'done' | 'changes_requested' | 'rejected' | 'failed'} kind What happened at the step.
 * @property {string} [reworkTarget] Earlier stage to return to; only with `rejected`.
 */

/**
 * @typedef {{ kind: 'next_step', stepKey: string }
 *   | { kind: 'stage_approved' }
 *   | { kind: 'restart', stepKey: string }
 *   | { kind: 'rework', stageKey: string }
 *   | { kind: 'cancelled' }
 *   | { kind: 'paused', stepKey: string }} Move
 *   Where the workflow goes after a step outcome.
 */

/**
 * @typedef {object} MoveInput
 * @property {StageDefinition} stage Stage being run.
 * @property {ReadonlyArray<StepDefinition>} run Planned steps.
 * @property {number} index Position of the current step in `run`.
 * @property {StepDefinition} step Current step.
 * @property {StepOutcome} outcome What happened.
 */

/** @type {Readonly<Record<StepOutcome['kind'], (input: MoveInput) => Move>>} */
const MOVES = Object.freeze({
  done: ({ run, index }) =>
    index + 1 < run.length
      ? { kind: 'next_step', stepKey: run[index + 1].key }
      : { kind: 'stage_approved' },
  changes_requested: ({ run, step, outcome }) => {
    requireStepType(step, outcome, ['gate']);
    return { kind: 'restart', stepKey: run[0].key };
  },
  rejected: ({ stage, step, outcome }) => {
    requireStepType(step, outcome, ['gate']);
    const target = outcome.reworkTarget;
    if (target === undefined) {
      return { kind: 'cancelled' };
    }
    if (!stage.reworkTargets.includes(target)) {
      throw new InvalidTransitionError(
        `Stage "${stage.key}" cannot rework to "${target}"; allowed: ${stage.reworkTargets.join(', ') || 'none'}`,
      );
    }
    return { kind: 'rework', stageKey: target };
  },
  failed: ({ stage, step, outcome }) => {
    requireStepType(step, outcome, ['action', 'work']);
    // An agent error is never the upstream stage's fault, so it pauses rather than reworks.
    const agentDraft = step.type === 'work' && step.agentDrafts === true;
    if (step.type === 'action' || agentDraft || stage.reworkTargets.length === 0) {
      return { kind: 'paused', stepKey: step.key };
    }
    return { kind: 'rework', stageKey: stage.reworkTargets[0] };
  },
});

/**
 * Refuse an outcome that does not apply to the step's type.
 * @param {StepDefinition} step Current step.
 * @param {StepOutcome} outcome Outcome reported.
 * @param {ReadonlyArray<StepDefinition['type']>} allowed Step types the outcome applies to.
 * @returns {void}
 * @throws {InvalidTransitionError} When the step type is not allowed.
 */
function requireStepType(step, outcome, allowed) {
  if (!allowed.includes(step.type)) {
    throw new InvalidTransitionError(
      `Outcome "${outcome.kind}" does not apply to ${step.type} step "${step.key}"`,
    );
  }
}

/**
 * Find the current step among the planned steps.
 * @param {StageDefinition} stage Stage being run.
 * @param {ReadonlyArray<StepDefinition>} run Planned steps.
 * @param {string} stepKey Current step key.
 * @returns {number} Index of the step in `run`.
 * @throws {InvalidTransitionError} When the step is unknown or skipped for these flags.
 */
function plannedIndex(stage, run, stepKey) {
  const index = run.findIndex((step) => step.key === stepKey);
  if (index !== -1) {
    return index;
  }
  const known = stage.steps.some((step) => step.key === stepKey);
  throw new InvalidTransitionError(
    known
      ? `Step "${stepKey}" is skipped in stage "${stage.key}" for these flags`
      : `Stage "${stage.key}" has no step "${stepKey}"`,
  );
}

/**
 * Decide where the workflow goes after a step outcome. Pure: depends only on its arguments.
 * @param {StageDefinition} stage Validated stage.
 * @param {FlagContext} context The Initiative's flags.
 * @param {string} currentStepKey Step that finished.
 * @param {StepOutcome} outcome What happened at the step.
 * @returns {Move} The next move.
 * @throws {InvalidTransitionError} When the outcome does not fit the step type, the step is not
 *   planned for these flags, or the rework target is not allowed.
 */
export function nextMove(stage, context, currentStepKey, outcome) {
  const { run } = plannedSteps(stage, context);
  const index = plannedIndex(stage, run, currentStepKey);
  if (!Object.hasOwn(MOVES, outcome.kind)) {
    throw new InvalidTransitionError(`Unknown outcome "${outcome.kind}"`);
  }
  if (outcome.reworkTarget !== undefined && outcome.kind !== 'rejected') {
    throw new InvalidTransitionError(
      `A rework target applies only to "rejected", not "${outcome.kind}"`,
    );
  }
  return MOVES[outcome.kind]({ stage, run, index, step: run[index], outcome });
}
