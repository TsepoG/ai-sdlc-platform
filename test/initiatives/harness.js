// @ts-check
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalContentStore } from '../../src/content/index.js';
import { createWorkflowService } from '../../src/initiatives/index.js';
import { loadStages } from '../../src/stages/index.js';
import { createTestDatabase } from '../db/test-database.js';

/** The real stage configuration. */
export const REAL_STAGES = join(import.meta.dirname, '../../config/stages');
/** Three enabled stages, for rework and upstream-changed tests. */
export const THREE_STAGES = join(import.meta.dirname, 'fixtures/three-stages');

/** @type {import('../../src/initiatives/index.js').Actor} */
export const AUTHOR = { type: 'user', id: 'u-author' };
/** @type {import('../../src/initiatives/index.js').Actor} */
export const REVIEWER = { type: 'user', id: 'u-reviewer' };

/**
 * @typedef {object} Harness
 * @property {import('../../src/initiatives/index.js').WorkflowService} service Workflow service.
 * @property {import('../db/test-database.js').TestDatabase} db Test database.
 * @property {ReadonlyArray<import('../../src/stages/index.js').StageDefinition>} stages Stages in use.
 * @property {(table: string) => Promise<number>} count Row count of a table.
 * @property {() => Promise<void>} close Clean up.
 */

/**
 * Build a workflow service on an isolated test schema and a temporary content directory.
 * @param {{ stagesDir?: string, adjustStages?: (stages: import('../../src/stages/index.js').StageDefinition[]) => import('../../src/stages/index.js').StageDefinition[] }} [options]
 *   Stage directory (default: the real config) and an optional change to the loaded stages.
 * @returns {Promise<Harness>} The harness.
 */
export async function createHarness({ stagesDir = REAL_STAGES, adjustStages = (s) => s } = {}) {
  const db = await createTestDatabase();
  const dir = await mkdtemp(join(tmpdir(), 'workflow-content-'));
  const stages = adjustStages([...(await loadStages(stagesDir))]);
  const service = createWorkflowService({
    pool: db.pool,
    stages,
    contentStore: createLocalContentStore({ dir }),
  });
  /** Tables a test may count; the name is checked so no other text reaches the SQL. */
  const countable = new Set(['decisions', 'audit_events', 'review_packages', 'artifact_versions']);
  return {
    service,
    db,
    stages,
    async count(table) {
      if (!countable.has(table)) {
        throw new Error(`Not a countable table: ${table}`);
      }
      const { rows } = await db.pool.query('SELECT count(*)::int AS n FROM '.concat(table));
      return rows[0].n;
    },
    async close() {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/**
 * The Initiative's active run of a stage.
 * @param {Harness} harness Harness.
 * @param {string} initiativeId Initiative ID.
 * @param {string} stageKey Stage key.
 * @returns {Promise<import('../../src/initiatives/queries.js').StageRunView>} The active run.
 */
export async function activeRun(harness, initiativeId, stageKey) {
  const view = await harness.service.getInitiative(initiativeId);
  const run = view.stageRuns.find((each) => each.stageKey === stageKey && each.state === 'active');
  if (run === undefined) {
    throw new Error(`No active ${stageKey} run`);
  }
  return run;
}

/**
 * Save a version into the active run's first output artifact and submit it for review.
 * @param {Harness} harness Harness.
 * @param {string} initiativeId Initiative ID.
 * @param {string} stageKey Stage to draft.
 * @param {string} [content] Content to save.
 * @returns {Promise<import('../../src/initiatives/index.js').SubmittedPackage & { versionId: string, stageRunId: string }>}
 *   The submitted package.
 */
export async function draftAndSubmit(harness, initiativeId, stageKey, content = `# ${stageKey}`) {
  const run = await activeRun(harness, initiativeId, stageKey);
  const stage = /** @type {import('../../src/stages/index.js').StageDefinition} */ (
    harness.stages.find((each) => each.key === stageKey)
  );
  const artifact = run.artifacts.find((each) => each.type === stage.outputs[0]);
  const version = await harness.service.saveVersion(
    /** @type {{ id: string }} */ (artifact).id,
    { content },
    AUTHOR,
  );
  const submitted = await harness.service.submitPackage(run.id, [version.id], AUTHOR);
  return { ...submitted, versionId: version.id, stageRunId: run.id };
}
