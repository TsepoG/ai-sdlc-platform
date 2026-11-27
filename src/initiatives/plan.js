// @ts-check
// Pure planning for the workflow services: which outcome a decision is, which stage comes next,
// which step runs a stage starts with, and which runs a re-approval makes stale. No I/O.
import { createHash } from 'node:crypto';
import { canonicalJson } from '../audit/index.js';
import { InvalidTransitionError } from '../errors/index.js';
import { plannedSteps } from '../workflow/index.js';

/** @import { StageDefinition } from '../stages/index.js' */
/** @import { FlagContext, StepOutcome } from '../workflow/index.js' */

/**
 * @typedef {object} DecisionInput
 * @property {'approve' | 'request_changes' | 'reject'} outcome The reviewer's decision.
 * @property {string} [reworkTarget] Earlier stage to send the Initiative back to (reject only).
 */

/** Decision outcome (as stored) to the Phase 01 step outcome it means at a gate. */
const OUTCOME_KIND = Object.freeze({
  approve: 'done',
  request_changes: 'changes_requested',
  reject: 'rejected',
});

/**
 * Translate a decision into the step outcome `nextMove` understands. A rework target is passed
 * through whatever the outcome, so `nextMove` refuses it where it doesn't apply.
 * @param {DecisionInput} decision The decision.
 * @returns {StepOutcome} Step outcome.
 */
export function toStepOutcome({ outcome, reworkTarget }) {
  const kind = /** @type {StepOutcome['kind']} */ (OUTCOME_KIND[outcome]);
  return reworkTarget === undefined ? { kind } : { kind, reworkTarget };
}

/**
 * Find a stage definition by key.
 * @param {ReadonlyArray<StageDefinition>} stages Loaded stages.
 * @param {string} key Stage key.
 * @returns {StageDefinition} The stage.
 * @throws {InvalidTransitionError} When the configuration has no such stage.
 */
export function stageByKey(stages, key) {
  const stage = stages.find((candidate) => candidate.key === key);
  if (stage === undefined) {
    throw new InvalidTransitionError(`The stage configuration has no stage "${key}"`);
  }
  return stage;
}

/**
 * The stage after `key` in workflow order.
 * @param {ReadonlyArray<StageDefinition>} stages Loaded stages.
 * @param {string} key Current stage key.
 * @returns {StageDefinition | undefined} The next stage, or undefined after the last.
 */
export function nextStage(stages, key) {
  const { order } = stageByKey(stages, key);
  return [...stages].sort((a, b) => a.order - b.order).find((stage) => stage.order > order);
}

/**
 * Identify the exact definition a stage run follows, so config changes never rewrite history.
 * @param {StageDefinition} stage Stage definition.
 * @returns {string} SHA-256 hex of its canonical JSON.
 */
export function stageConfigVersion(stage) {
  return createHash('sha256').update(canonicalJson(stage), 'utf8').digest('hex');
}

/**
 * @typedef {object} PlannedStepRun
 * @property {string} stepKey Step key.
 * @property {'action' | 'work' | 'gate'} stepType Step type.
 * @property {number} position Position in the stage.
 * @property {'running' | 'pending' | 'skipped'} state Initial state.
 */

/**
 * The step runs a stage starts a cycle with: the first planned step running, the other planned
 * steps pending, and steps whose condition is false recorded as skipped.
 * @param {StageDefinition} stage Stage definition.
 * @param {FlagContext} context The Initiative's flags.
 * @returns {PlannedStepRun[]} Step runs in stage order.
 */
export function initialStepRuns(stage, context) {
  const { run } = plannedSteps(stage, context);
  const firstKey = run[0]?.key;
  const planned = new Set(run.map((step) => step.key));
  return stage.steps.map((step, position) => {
    /** @type {PlannedStepRun['state']} */
    let state = 'skipped';
    if (step.key === firstKey) {
      state = 'running';
    } else if (planned.has(step.key)) {
      state = 'pending';
    }
    return { stepKey: step.key, stepType: step.type, position, state };
  });
}

/**
 * @typedef {object} RunLink
 * @property {string} id Stage run ID.
 * @property {string} stageKey Stage key.
 * @property {string} state Stage run state.
 * @property {string | null} inputPackageId Approved upstream package it started from.
 */

/**
 * Approved runs downstream of a re-approved stage that were built on an older package of it.
 * Their inputs changed, so they must be flagged `upstream_changed` and re-reviewed.
 * @param {object} lineage Every stage run and package of one Initiative.
 * @param {RunLink[]} lineage.runs Stage runs.
 * @param {{ id: string, stageRunId: string }[]} lineage.packages Review packages.
 * @param {string} lineage.approvedRunId The run just approved.
 * @param {string} lineage.approvedPackageId The package just approved.
 * @returns {string[]} IDs of the stale runs.
 */
export function findStaleRuns({ runs, packages, approvedRunId, approvedPackageId }) {
  const runOfPackage = new Map(packages.map((pkg) => [pkg.id, pkg.stageRunId]));
  const runById = new Map(runs.map((run) => [run.id, run]));
  const approvedStage = runById.get(approvedRunId)?.stageKey;

  /**
   * Whether a run's input chain passes through an older package of the approved stage.
   * @param {RunLink} run Run to check.
   * @returns {boolean} True when it was built on superseded upstream work.
   */
  const builtOnOlderPackage = (run) => {
    let packageId = run.inputPackageId;
    while (packageId !== null) {
      const upstream = runById.get(/** @type {string} */ (runOfPackage.get(packageId)));
      if (upstream === undefined) {
        return false;
      }
      if (upstream.stageKey === approvedStage) {
        return packageId !== approvedPackageId;
      }
      packageId = upstream.inputPackageId;
    }
    return false;
  };

  return runs
    .filter((run) => run.id !== approvedRunId && run.state === 'approved')
    .filter(builtOnOlderPackage)
    .map((run) => run.id);
}
