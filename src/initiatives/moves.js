// @ts-check
import { InvalidTransitionError } from '../errors/index.js';
import { approveStage } from './approval.js';
import { audit, updateInitiative } from './context.js';
import { stageByKey } from './plan.js';
import {
  completeStep,
  currentCycleSteps,
  insertCycle,
  skipPendingSteps,
  startStageRun,
  startStep,
} from './stage-runs.js';

/** @import { StageDefinition } from '../stages/index.js' */
/** @import { Move } from '../workflow/index.js' */
/** @import { Actor, InitiativeRow, WorkflowDeps } from './context.js' */
/** @import { StageRunRow, StepRunRow } from './stage-runs.js' */

/**
 * @typedef {object} MoveContext
 * @property {InitiativeRow} initiative Locked Initiative.
 * @property {StageRunRow} stageRun Stage run the step belongs to.
 * @property {StageDefinition} stage Its definition.
 * @property {StepRunRow} stepRun The step that finished.
 * @property {string} packageId Package the step finished with.
 */

/**
 * Write the result of a Phase 01 `nextMove` decision. The rules chose the move; this only stores
 * it, so no stage key is ever special-cased here.
 * @param {import('pg').PoolClient} tx Transaction.
 * @param {WorkflowDeps} deps Dependencies.
 * @param {Actor} actor Who acted.
 * @param {MoveContext} context Where the move happens.
 * @param {Move} move The move to apply.
 * @returns {Promise<void>}
 * @throws {InvalidTransitionError} For a move that can't follow a submission or decision.
 */
export async function applyMove(tx, deps, actor, context, move) {
  const { stepRun, packageId } = context;
  switch (move.kind) {
    case 'next_step':
      await completeStep(tx, deps, stepRun.id, packageId);
      await startNextStep(tx, deps, context, move.stepKey);
      return;
    case 'stage_approved':
      await completeStep(tx, deps, stepRun.id, packageId);
      await approveStage(tx, deps, actor, context);
      return;
    case 'restart':
      await completeStep(tx, deps, stepRun.id, packageId);
      await restartStage(tx, deps, actor, context);
      return;
    case 'rework':
      await completeStep(tx, deps, stepRun.id, packageId);
      await reworkTo(tx, deps, actor, context, move.stageKey);
      return;
    case 'cancelled':
      await completeStep(tx, deps, stepRun.id, packageId);
      await cancelInitiative(tx, deps, actor, context);
      return;
    default:
      // Only a failed action or work step pauses; submissions and decisions never report failure.
      throw new InvalidTransitionError(
        `Move "${move.kind}" cannot follow a submission or decision`,
      );
  }
}

/**
 * Start the named step in the current cycle.
 * @param {import('pg').PoolClient} tx Transaction.
 * @param {WorkflowDeps} deps Dependencies.
 * @param {MoveContext} context Where the move happens.
 * @param {string} stepKey Step to start.
 * @returns {Promise<void>}
 */
async function startNextStep(tx, deps, { stageRun, stage, packageId }, stepKey) {
  const steps = await currentCycleSteps(tx, stageRun.id);
  const stepRun = /** @type {StepRunRow} */ (steps.find((run) => run.step_key === stepKey));
  const step = /** @type {import('../stages/index.js').StepDefinition} */ (
    stage.steps.find((candidate) => candidate.key === stepKey)
  );
  await startStep(tx, deps, { stepRun, step, packageId });
}

/**
 * Changes requested: close the package and the current cycle, and start a new cycle at the
 * first step (for the Test stage that means redeploying to SIT).
 * @param {import('pg').PoolClient} tx Transaction.
 * @param {WorkflowDeps} deps Dependencies.
 * @param {Actor} actor Who requested changes.
 * @param {MoveContext} context Where the move happens.
 * @returns {Promise<void>}
 */
async function restartStage(tx, deps, actor, { initiative, stageRun, stage, stepRun, packageId }) {
  await tx.query(`UPDATE review_packages SET status = 'changes_requested' WHERE id = $1`, [
    packageId,
  ]);
  await skipPendingSteps(tx, stageRun.id, stepRun.cycle);
  const cycle = stepRun.cycle + 1;
  await insertCycle(tx, deps, { stageRunId: stageRun.id, stage, flags: initiative.flags, cycle });
  audit(
    tx,
    deps,
    actor,
    'stage_run.restarted',
    { type: 'stage_run', id: stageRun.id },
    initiative.id,
    {
      cycle,
      packageId,
    },
  );
}

/**
 * Rejected with a rework target: supersede every later run, active or approved (core-design
 * section 5), and start a new attempt of the target from the same input its previous attempt
 * had. Re-approving the target then starts fresh attempts downstream.
 * @param {import('pg').PoolClient} tx Transaction.
 * @param {WorkflowDeps} deps Dependencies.
 * @param {Actor} actor Who rejected.
 * @param {MoveContext} context Where the move happens.
 * @param {string} targetKey Stage to return to.
 * @returns {Promise<void>}
 */
async function reworkTo(tx, deps, actor, { initiative, stageRun, stepRun, packageId }, targetKey) {
  const target = stageByKey(deps.stages, targetKey);
  await tx.query(`UPDATE review_packages SET status = 'rejected' WHERE id = $1`, [packageId]);
  await skipPendingSteps(tx, stageRun.id, stepRun.cycle);
  const laterKeys = deps.stages.filter((stage) => stage.order > target.order).map((s) => s.key);
  const { rows: superseded } = await tx.query(
    `UPDATE stage_runs SET state = 'superseded', completed_at = $3
     WHERE initiative_id = $1 AND state IN ('active', 'approved') AND stage_key = ANY($2)
     RETURNING id`,
    [initiative.id, laterKeys, deps.now()],
  );
  for (const { id } of superseded) {
    audit(tx, deps, actor, 'stage_run.superseded', { type: 'stage_run', id }, initiative.id, {
      reworkTarget: targetKey,
    });
  }
  const { rows: previous } = await tx.query(
    `SELECT input_package_id FROM stage_runs WHERE initiative_id = $1 AND stage_key = $2
     ORDER BY attempt DESC LIMIT 1`,
    [initiative.id, targetKey],
  );
  await updateInitiative(tx, deps, initiative.id, { status: 'active', currentStageKey: targetKey });
  await startStageRun(tx, deps, actor, {
    initiative,
    stage: target,
    inputPackageId: previous[0]?.input_package_id ?? null,
  });
}

/**
 * Rejected without a target: cancel the stage run and the Initiative.
 * @param {import('pg').PoolClient} tx Transaction.
 * @param {WorkflowDeps} deps Dependencies.
 * @param {Actor} actor Who rejected.
 * @param {MoveContext} context Where the move happens.
 * @returns {Promise<void>}
 */
async function cancelInitiative(tx, deps, actor, { initiative, stageRun, stepRun, packageId }) {
  await tx.query(`UPDATE review_packages SET status = 'rejected' WHERE id = $1`, [packageId]);
  await skipPendingSteps(tx, stageRun.id, stepRun.cycle);
  await tx.query(`UPDATE stage_runs SET state = 'cancelled', completed_at = $2 WHERE id = $1`, [
    stageRun.id,
    deps.now(),
  ]);
  await updateInitiative(tx, deps, initiative.id, {
    status: 'cancelled',
    currentStageKey: stageRun.stage_key,
  });
  audit(
    tx,
    deps,
    actor,
    'initiative.cancelled',
    { type: 'initiative', id: initiative.id },
    initiative.id,
    {
      stageRunId: stageRun.id,
      packageId,
    },
  );
}
