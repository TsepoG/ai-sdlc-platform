// @ts-check
import { initialStepRuns, stageConfigVersion } from './plan.js';
import { audit } from './context.js';

/** @import { StageDefinition, StepDefinition } from '../stages/index.js' */
/** @import { Actor, InitiativeRow, WorkflowDeps } from './context.js' */

const MS_PER_HOUR = 3_600_000;

/**
 * @typedef {object} StageRunRow
 * @property {string} id Stage run ID.
 * @property {string} initiative_id Initiative ID.
 * @property {string} stage_key Stage key.
 * @property {number} attempt Attempt number.
 * @property {string} state Stage run state.
 * @property {string | null} input_package_id Approved upstream package it started from.
 */

/**
 * @typedef {object} StepRunRow
 * @property {string} id Step run ID.
 * @property {string} step_key Step key.
 * @property {'action' | 'work' | 'gate'} step_type Step type.
 * @property {number} cycle Cycle number.
 * @property {string} state Step run state.
 * @property {string | null} package_id Package attached to the step.
 */

/**
 * Load a stage run, locked for update.
 * @param {import('pg').PoolClient} tx Transaction.
 * @param {string} stageRunId Stage run ID.
 * @returns {Promise<StageRunRow | undefined>} The row, if it exists.
 */
export async function lockStageRun(tx, stageRunId) {
  const { rows } = await tx.query(
    `SELECT id, initiative_id, stage_key, attempt, state, input_package_id
     FROM stage_runs WHERE id = $1 FOR UPDATE`,
    [stageRunId],
  );
  return rows[0];
}

/**
 * Insert one cycle of step runs for a stage.
 * @param {import('pg').PoolClient} tx Transaction.
 * @param {WorkflowDeps} deps Dependencies.
 * @param {{ stageRunId: string, stage: StageDefinition, flags: Record<string, boolean>, cycle: number }} plan
 *   Stage run, its definition, the Initiative's flags and the cycle number.
 * @returns {Promise<void>}
 */
export async function insertCycle(tx, deps, { stageRunId, stage, flags, cycle }) {
  for (const run of initialStepRuns(stage, { flags })) {
    await tx.query(
      `INSERT INTO step_runs (stage_run_id, step_key, step_type, position, cycle, state, started_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        stageRunId,
        run.stepKey,
        run.stepType,
        run.position,
        cycle,
        run.state,
        run.state === 'running' ? deps.now() : null,
      ],
    );
  }
}

/**
 * Start a new attempt of a stage: the stage run, its first cycle of steps and one empty
 * artifact per output type for versions to be saved into.
 * @param {import('pg').PoolClient} tx Transaction.
 * @param {WorkflowDeps} deps Dependencies.
 * @param {Actor} actor Who caused it.
 * @param {{ initiative: InitiativeRow, stage: StageDefinition, inputPackageId: string | null }} start
 *   The Initiative, the stage and the approved upstream package it starts from.
 * @returns {Promise<string>} The new stage run ID.
 */
export async function startStageRun(tx, deps, actor, { initiative, stage, inputPackageId }) {
  const { rows } = await tx.query(
    `INSERT INTO stage_runs (initiative_id, stage_key, attempt, state, config_version,
       input_package_id, started_at)
     SELECT $1, $2, coalesce(max(attempt), 0) + 1, 'active', $3, $4, $5
     FROM stage_runs WHERE initiative_id = $1 AND stage_key = $2
     RETURNING id, attempt`,
    [initiative.id, stage.key, stageConfigVersion(stage), inputPackageId, deps.now()],
  );
  const { id: stageRunId, attempt } = rows[0];
  await insertCycle(tx, deps, { stageRunId, stage, flags: initiative.flags, cycle: 1 });
  for (const type of stage.outputs) {
    await tx.query(
      'INSERT INTO artifacts (initiative_id, stage_run_id, type, title) VALUES ($1, $2, $3, $4)',
      [initiative.id, stageRunId, type, `${stage.name}: ${type}`],
    );
  }
  audit(
    tx,
    deps,
    actor,
    'stage_run.started',
    { type: 'stage_run', id: stageRunId },
    initiative.id,
    {
      stageKey: stage.key,
      attempt,
      inputPackageId,
    },
  );
  return stageRunId;
}

/**
 * Step runs of the stage run's latest cycle, in stage order.
 * @param {import('pg').PoolClient} tx Transaction.
 * @param {string} stageRunId Stage run ID.
 * @returns {Promise<StepRunRow[]>} Step runs.
 */
export async function currentCycleSteps(tx, stageRunId) {
  const { rows } = await tx.query(
    `SELECT id, step_key, step_type, cycle, state, package_id FROM step_runs
     WHERE stage_run_id = $1
       AND cycle = (SELECT max(cycle) FROM step_runs WHERE stage_run_id = $1)
     ORDER BY position`,
    [stageRunId],
  );
  return rows;
}

/**
 * Mark a step run done, recording the package it completed with.
 * @param {import('pg').PoolClient} tx Transaction.
 * @param {WorkflowDeps} deps Dependencies.
 * @param {string} stepRunId Step run ID.
 * @param {string} packageId Package.
 * @returns {Promise<void>}
 */
export async function completeStep(tx, deps, stepRunId, packageId) {
  await tx.query(
    `UPDATE step_runs SET state = 'done', package_id = $2, completed_at = $3 WHERE id = $1`,
    [stepRunId, packageId, deps.now()],
  );
}

/**
 * Start a step: a gate opens a gate run on the package (with an SLA due time) and waits for a
 * decision; work and action steps start running.
 * @param {import('pg').PoolClient} tx Transaction.
 * @param {WorkflowDeps} deps Dependencies.
 * @param {{ stepRun: StepRunRow, step: StepDefinition, packageId: string }} start Step run, its
 *   definition and the package under review.
 * @returns {Promise<string | null>} The new gate run ID, for a gate.
 */
export async function startStep(tx, deps, { stepRun, step, packageId }) {
  const now = deps.now();
  if (step.type !== 'gate') {
    await tx.query(`UPDATE step_runs SET state = 'running', started_at = $2 WHERE id = $1`, [
      stepRun.id,
      now,
    ]);
    return null;
  }
  await tx.query(
    `UPDATE step_runs SET state = 'waiting', package_id = $2, started_at = $3 WHERE id = $1`,
    [stepRun.id, packageId, now],
  );
  const dueAt =
    step.slaHours === undefined ? null : new Date(now.getTime() + step.slaHours * MS_PER_HOUR);
  const { rows } = await tx.query(
    `INSERT INTO gate_runs (step_run_id, package_id, approver_role, state, due_at, opened_at)
     VALUES ($1, $2, $3, 'open', $4, $5) RETURNING id`,
    [stepRun.id, packageId, step.approverRole, dueAt, now],
  );
  return rows[0].id;
}

/**
 * Mark every still-pending step of the current cycle skipped (the cycle ended early).
 * @param {import('pg').PoolClient} tx Transaction.
 * @param {string} stageRunId Stage run ID.
 * @param {number} cycle Cycle number.
 * @returns {Promise<void>}
 */
export async function skipPendingSteps(tx, stageRunId, cycle) {
  await tx.query(
    `UPDATE step_runs SET state = 'skipped'
     WHERE stage_run_id = $1 AND cycle = $2 AND state = 'pending'`,
    [stageRunId, cycle],
  );
}
