// @ts-check
import { InvalidTransitionError, NotFoundError, ValidationError } from '../errors/index.js';
import { audit, lockInitiative, workflowTransaction } from './context.js';

/** @import { Actor, WorkflowDeps } from './context.js' */

/**
 * @typedef {object} SaveVersionInput
 * @property {string} content The new content.
 * @property {'markdown' | 'text' | 'json'} [format] Content format (default markdown).
 * @property {string[]} [sourceVersionIds] Versions this one was derived from.
 */

/**
 * @typedef {object} VersionView
 * @property {string} id Version ID.
 * @property {string} artifactId Artifact ID.
 * @property {number} number Version number within the artifact.
 * @property {string} contentHash SHA-256 of the content.
 * @property {string} format Content format.
 * @property {string} createdByType `user` or `agent`.
 * @property {string} createdById Author.
 * @property {string[]} sourceVersionIds Versions it was derived from.
 * @property {string} createdAt ISO timestamp.
 */

/**
 * Save new content for an artifact as a new, immutable version. Nothing is ever updated in
 * place: an edit is always a new version with the next number.
 * @param {WorkflowDeps} deps Dependencies.
 * @param {string} artifactId Artifact to add a version to.
 * @param {SaveVersionInput} input Content and lineage.
 * @param {Actor} actor Author.
 * @returns {Promise<VersionView>} The new version.
 * @throws {NotFoundError} When the artifact does not exist.
 * @throws {InvalidTransitionError} When the artifact's stage run is no longer active.
 * @throws {ValidationError} When a source version is not part of the same Initiative.
 */
export async function saveVersion(deps, artifactId, input, actor) {
  const artifact = await findArtifact(deps, artifactId);
  const stored = await deps.contentStore.put(input.content);
  const sourceVersionIds = input.sourceVersionIds ?? [];
  return workflowTransaction(deps, async (tx) => {
    await lockInitiative(tx, artifact.initiative_id);
    const { rows: runs } = await tx.query('SELECT state FROM stage_runs WHERE id = $1', [
      artifact.stage_run_id,
    ]);
    if (runs[0].state !== 'active') {
      throw new InvalidTransitionError(
        `Versions can only be saved while the stage run is active (it is ${runs[0].state})`,
      );
    }
    await assertSourcesBelong(tx, artifact.initiative_id, sourceVersionIds);
    const { rows } = await tx.query(
      `INSERT INTO artifact_versions (artifact_id, number, content_key, content_hash, format,
         created_by_type, created_by_id, source_version_ids, created_at)
       SELECT $1, coalesce(max(number), 0) + 1, $2, $3, $4, $5, $6, $7, $8
       FROM artifact_versions WHERE artifact_id = $1
       RETURNING id, artifact_id, number, content_hash, format, created_by_type, created_by_id,
         source_version_ids, created_at`,
      [
        artifactId,
        stored.key,
        stored.hash,
        input.format ?? 'markdown',
        actor.type,
        actor.id,
        sourceVersionIds,
        deps.now(),
      ],
    );
    const version = toVersionView(rows[0]);
    audit(
      tx,
      deps,
      actor,
      'version.saved',
      { type: 'artifact_version', id: version.id },
      artifact.initiative_id,
      {
        artifactId,
        number: version.number,
        contentHash: version.contentHash,
      },
    );
    return version;
  });
}

/**
 * Read a version and its content.
 * @param {WorkflowDeps} deps Dependencies.
 * @param {string} versionId Version ID.
 * @returns {Promise<VersionView & { content: string }>} The version with its content.
 * @throws {NotFoundError} When the version does not exist.
 */
export async function getVersion(deps, versionId) {
  const { rows } = await deps.pool.query(
    `SELECT id, artifact_id, number, content_key, content_hash, format, created_by_type,
       created_by_id, source_version_ids, created_at
     FROM artifact_versions WHERE id = $1`,
    [versionId],
  );
  if (rows.length === 0) {
    throw new NotFoundError('Version not found');
  }
  return { ...toVersionView(rows[0]), content: await deps.contentStore.get(rows[0].content_key) };
}

/**
 * Load an artifact's Initiative and stage run.
 * @param {WorkflowDeps} deps Dependencies.
 * @param {string} artifactId Artifact ID.
 * @returns {Promise<{ initiative_id: string, stage_run_id: string }>} Its owners.
 * @throws {NotFoundError} When the artifact does not exist.
 */
async function findArtifact(deps, artifactId) {
  const { rows } = await deps.pool.query(
    'SELECT initiative_id, stage_run_id FROM artifacts WHERE id = $1',
    [artifactId],
  );
  if (rows.length === 0) {
    throw new NotFoundError('Artifact not found');
  }
  return rows[0];
}

/**
 * Refuse source versions from another Initiative (or that don't exist).
 * @param {import('pg').PoolClient} tx Transaction.
 * @param {string} initiativeId Initiative of the new version.
 * @param {string[]} sourceVersionIds Claimed sources.
 * @returns {Promise<void>}
 * @throws {ValidationError} When any source is foreign or missing.
 */
async function assertSourcesBelong(tx, initiativeId, sourceVersionIds) {
  if (sourceVersionIds.length === 0) {
    return;
  }
  const { rows } = await tx.query(
    `SELECT count(*)::int AS found FROM artifact_versions v JOIN artifacts a ON a.id = v.artifact_id
     WHERE v.id = ANY($1) AND a.initiative_id = $2`,
    [sourceVersionIds, initiativeId],
  );
  if (rows[0].found !== new Set(sourceVersionIds).size) {
    throw new ValidationError('Every source version must belong to the same Initiative');
  }
}

/**
 * @typedef {object} VersionRow
 * @property {string} id Version ID.
 * @property {string} artifact_id Artifact ID.
 * @property {number} number Version number.
 * @property {string} content_hash Content hash.
 * @property {string} format Format.
 * @property {string} created_by_type Author type.
 * @property {string} created_by_id Author.
 * @property {string[]} source_version_ids Sources.
 * @property {Date} created_at Created at.
 */

/**
 * Map a version row to its view.
 * @param {VersionRow} row Database row.
 * @returns {VersionView} The view.
 */
export function toVersionView(row) {
  return {
    id: row.id,
    artifactId: row.artifact_id,
    number: row.number,
    contentHash: row.content_hash,
    format: row.format,
    createdByType: row.created_by_type,
    createdById: row.created_by_id,
    sourceVersionIds: row.source_version_ids,
    createdAt: row.created_at.toISOString(),
  };
}
