// @ts-check
import { InvalidTransitionError, NotFoundError } from '../errors/index.js';
import { audit, lockInitiative, workflowTransaction } from './context.js';

/** @import { Actor, WorkflowDeps } from './context.js' */

/**
 * Find the Initiative a version belongs to.
 * @param {WorkflowDeps} deps Dependencies.
 * @param {string} versionId Version ID.
 * @returns {Promise<string>} Initiative ID.
 * @throws {NotFoundError} When the version does not exist.
 */
async function initiativeOfVersion(deps, versionId) {
  const { rows } = await deps.pool.query(
    `SELECT a.initiative_id FROM artifact_versions v JOIN artifacts a ON a.id = v.artifact_id
     WHERE v.id = $1`,
    [versionId],
  );
  if (rows.length === 0) {
    throw new NotFoundError('Version not found');
  }
  return rows[0].initiative_id;
}

/**
 * Raise an open question on a version. A blocking question stops submission until answered.
 * @param {WorkflowDeps} deps Dependencies.
 * @param {string} versionId Version the question is about.
 * @param {{ text: string, blocking: boolean }} input Question text and whether it blocks.
 * @param {Actor} actor Who asked (a person or the drafting agent).
 * @returns {Promise<{ id: string }>} The question.
 * @throws {NotFoundError} When the version does not exist.
 */
export async function addOpenQuestion(deps, versionId, input, actor) {
  const initiativeId = await initiativeOfVersion(deps, versionId);
  return workflowTransaction(deps, async (tx) => {
    await lockInitiative(tx, initiativeId);
    const { rows } = await tx.query(
      `INSERT INTO open_questions (version_id, text, blocking, status, created_at)
       VALUES ($1, $2, $3, 'open', $4) RETURNING id`,
      [versionId, input.text, input.blocking, deps.now()],
    );
    audit(
      tx,
      deps,
      actor,
      'question.added',
      { type: 'open_question', id: rows[0].id },
      initiativeId,
      {
        versionId,
        blocking: input.blocking,
      },
    );
    return { id: rows[0].id };
  });
}

/**
 * Answer an open question.
 * @param {WorkflowDeps} deps Dependencies.
 * @param {string} questionId Question ID.
 * @param {{ answer: string }} input The answer.
 * @param {Actor} actor Who answered.
 * @returns {Promise<{ id: string }>} The question.
 * @throws {NotFoundError} When the question does not exist.
 * @throws {InvalidTransitionError} When it was already answered.
 */
export async function answerQuestion(deps, questionId, input, actor) {
  const { rows: found } = await deps.pool.query(
    `SELECT a.initiative_id FROM open_questions q JOIN artifact_versions v ON v.id = q.version_id
     JOIN artifacts a ON a.id = v.artifact_id WHERE q.id = $1`,
    [questionId],
  );
  if (found.length === 0) {
    throw new NotFoundError('Open question not found');
  }
  const initiativeId = found[0].initiative_id;
  return workflowTransaction(deps, async (tx) => {
    await lockInitiative(tx, initiativeId);
    const { rows } = await tx.query(
      `UPDATE open_questions SET status = 'answered', answer = $2, answered_by_id = $3,
         answered_at = $4
       WHERE id = $1 AND status = 'open' RETURNING id`,
      [questionId, input.answer, actor.id, deps.now()],
    );
    if (rows.length === 0) {
      throw new InvalidTransitionError('This question has already been answered');
    }
    audit(
      tx,
      deps,
      actor,
      'question.answered',
      { type: 'open_question', id: questionId },
      initiativeId,
    );
    return { id: questionId };
  });
}

/**
 * Comment on a version.
 * @param {WorkflowDeps} deps Dependencies.
 * @param {string} versionId Version commented on.
 * @param {{ body: string, anchor?: Record<string, unknown> }} input Comment text and position.
 * @param {Actor} actor Author.
 * @returns {Promise<{ id: string }>} The comment.
 * @throws {NotFoundError} When the version does not exist.
 */
export async function addComment(deps, versionId, input, actor) {
  const initiativeId = await initiativeOfVersion(deps, versionId);
  return workflowTransaction(deps, async (tx) => {
    const { rows } = await tx.query(
      `INSERT INTO comments (version_id, anchor, author_id, body, created_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [versionId, input.anchor ?? null, actor.id, input.body, deps.now()],
    );
    audit(tx, deps, actor, 'comment.added', { type: 'comment', id: rows[0].id }, initiativeId, {
      versionId,
    });
    return { id: rows[0].id };
  });
}
