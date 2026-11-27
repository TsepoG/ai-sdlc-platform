// @ts-check
import { listAuditEvents } from '../audit/index.js';
import { withReadSnapshot } from '../db/index.js';
import { NotFoundError } from '../errors/index.js';

/** @import { WorkflowDeps } from './context.js' */
/** @import { StoredAuditEvent } from '../audit/index.js' */

/**
 * @typedef {object} InitiativeView
 * @property {string} id Initiative ID.
 * @property {string} key Readable key.
 * @property {string} title Title.
 * @property {string} status Status.
 * @property {string} currentStageKey Current stage.
 * @property {Record<string, boolean>} flags Flags.
 * @property {StageRunView[]} stageRuns Stage runs, oldest first.
 */

/**
 * @typedef {object} StageRunView
 * @property {string} id Stage run ID.
 * @property {string} stageKey Stage key.
 * @property {number} attempt Attempt.
 * @property {string} state State.
 * @property {string | null} inputPackageId Upstream package it started from.
 * @property {{ id: string, stepKey: string, stepType: string, cycle: number, state: string, packageId: string | null }[]} steps
 *   Step runs of every cycle, in order.
 * @property {{ id: string, stepRunId: string, packageId: string, approverRole: string, state: string, dueAt: string | null }[]} gates
 *   Gate runs.
 * @property {{ id: string, type: string, title: string, latestVersionId: string | null, latestNumber: number | null }[]} artifacts
 *   Artifacts with their latest version.
 * @property {{ id: string, packageHash: string, status: string, versionIds: string[] }[]} packages
 *   Review packages.
 */

/**
 * Read an Initiative with its stage runs, steps, gates, artifacts and packages.
 * @param {WorkflowDeps} deps Dependencies.
 * @param {string} initiativeId Initiative ID.
 * @returns {Promise<InitiativeView>} The Initiative.
 * @throws {NotFoundError} When it does not exist.
 */
export function getInitiative(deps, initiativeId) {
  // One snapshot, so the stage runs, steps, gates and packages always agree with each other.
  return withReadSnapshot(deps.pool, async (db) => {
    const { rows } = await db.query(
      'SELECT id, key, title, status, current_stage_key, flags FROM initiatives WHERE id = $1',
      [initiativeId],
    );
    if (rows.length === 0) {
      throw new NotFoundError('Initiative not found');
    }
    // One connection runs one query at a time, so read the parts in turn.
    const runs = await db.query(
      `SELECT id, stage_key, attempt, state, input_package_id FROM stage_runs
         WHERE initiative_id = $1 ORDER BY started_at, attempt`,
      [initiativeId],
    );
    const steps = await db.query(
      `SELECT s.id, s.stage_run_id, s.step_key, s.step_type, s.cycle, s.state, s.package_id
         FROM step_runs s JOIN stage_runs r ON r.id = s.stage_run_id
         WHERE r.initiative_id = $1 ORDER BY s.cycle, s.position`,
      [initiativeId],
    );
    const gates = await db.query(
      `SELECT g.id, g.step_run_id, g.package_id, g.approver_role, g.state, g.due_at, s.stage_run_id
         FROM gate_runs g JOIN step_runs s ON s.id = g.step_run_id
         JOIN stage_runs r ON r.id = s.stage_run_id WHERE r.initiative_id = $1 ORDER BY g.opened_at`,
      [initiativeId],
    );
    const artifacts = await db.query(
      `SELECT a.id, a.stage_run_id, a.type, a.title, latest.id AS version_id, latest.number
         FROM artifacts a
         LEFT JOIN LATERAL (SELECT id, number FROM artifact_versions WHERE artifact_id = a.id
                            ORDER BY number DESC LIMIT 1) latest ON true
         WHERE a.initiative_id = $1 ORDER BY a.created_at, a.type`,
      [initiativeId],
    );
    const packages = await db.query(
      `SELECT p.id, p.stage_run_id, p.package_hash, p.status,
           array_agg(pv.version_id ORDER BY pv.version_id) AS version_ids
         FROM review_packages p JOIN stage_runs r ON r.id = p.stage_run_id
         JOIN review_package_versions pv ON pv.package_id = p.id
         WHERE r.initiative_id = $1 GROUP BY p.id ORDER BY p.submitted_at`,
      [initiativeId],
    );
    const initiative = rows[0];
    return {
      id: initiative.id,
      key: initiative.key,
      title: initiative.title,
      status: initiative.status,
      currentStageKey: initiative.current_stage_key,
      flags: initiative.flags,
      stageRuns: runs.rows.map((run) => ({
        id: run.id,
        stageKey: run.stage_key,
        attempt: run.attempt,
        state: run.state,
        inputPackageId: run.input_package_id,
        steps: steps.rows
          .filter((step) => step.stage_run_id === run.id)
          .map((step) => ({
            id: step.id,
            stepKey: step.step_key,
            stepType: step.step_type,
            cycle: step.cycle,
            state: step.state,
            packageId: step.package_id,
          })),
        gates: gates.rows
          .filter((gate) => gate.stage_run_id === run.id)
          .map((gate) => ({
            id: gate.id,
            stepRunId: gate.step_run_id,
            packageId: gate.package_id,
            approverRole: gate.approver_role,
            state: gate.state,
            dueAt: gate.due_at?.toISOString() ?? null,
          })),
        artifacts: artifacts.rows
          .filter((artifact) => artifact.stage_run_id === run.id)
          .map((artifact) => ({
            id: artifact.id,
            type: artifact.type,
            title: artifact.title,
            latestVersionId: artifact.version_id,
            latestNumber: artifact.number,
          })),
        packages: packages.rows
          .filter((pkg) => pkg.stage_run_id === run.id)
          .map((pkg) => ({
            id: pkg.id,
            packageHash: pkg.package_hash,
            status: pkg.status,
            versionIds: pkg.version_ids,
          })),
      })),
    };
  });
}

/**
 * The Initiative's audit trail, oldest first.
 * @param {WorkflowDeps} deps Dependencies.
 * @param {string} initiativeId Initiative ID.
 * @returns {Promise<StoredAuditEvent[]>} Its audit events.
 * @throws {NotFoundError} When the Initiative does not exist.
 */
export async function getTimeline(deps, initiativeId) {
  const { rows } = await deps.pool.query('SELECT 1 FROM initiatives WHERE id = $1', [initiativeId]);
  if (rows.length === 0) {
    throw new NotFoundError('Initiative not found');
  }
  return listAuditEvents(deps.pool, { initiativeId });
}
