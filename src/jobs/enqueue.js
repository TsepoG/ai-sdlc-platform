// @ts-check

/**
 * @typedef {object} JobInput
 * @property {string} type Job type; a handler of this type runs it.
 * @property {Record<string, unknown>} payload Data for the handler (plain data).
 * @property {string} idempotencyKey Unique key; enqueueing the same key again is a no-op.
 * @property {Date} [runAfter] Earliest time to run (default now).
 * @property {string} [decisionId] Decision that caused it, for outbox writes.
 * @property {string} [stepRunId] Step run that caused it, for action steps.
 */

/**
 * Add a job to the outbox inside the caller's transaction, so the job exists if and only if the
 * change that caused it commits.
 * @param {import('pg').PoolClient} tx Transaction.
 * @param {JobInput} job The job.
 * @param {{ now?: () => Date }} [deps] Clock.
 * @returns {Promise<{ id: string, created: boolean }>} The job ID, and whether this call created it.
 */
export async function enqueueJob(tx, job, { now = () => new Date() } = {}) {
  const at = now();
  const { rows } = await tx.query(
    `INSERT INTO jobs (type, payload, idempotency_key, run_after, decision_id, step_run_id,
       created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
     ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
    [
      job.type,
      job.payload,
      job.idempotencyKey,
      job.runAfter ?? at,
      job.decisionId ?? null,
      job.stepRunId ?? null,
      at,
    ],
  );
  if (rows.length > 0) {
    return { id: rows[0].id, created: true };
  }
  const { rows: existing } = await tx.query('SELECT id FROM jobs WHERE idempotency_key = $1', [
    job.idempotencyKey,
  ]);
  return { id: existing[0].id, created: false };
}
