// @ts-check
import { appendAuditEvent } from '../audit/index.js';
import { withTransaction } from '../db/index.js';

const WORKER_ACTOR = 'job-worker';

/**
 * @typedef {object} JobContext
 * @property {string} jobId Job ID.
 * @property {number} attempt Which attempt this is (1-based).
 * @property {string} idempotencyKey The job's idempotency key; handlers use it to stay idempotent.
 */

/**
 * @callback JobHandler
 * @param {Record<string, unknown>} payload Job data.
 * @param {JobContext} context Job identity and attempt.
 * @returns {Promise<void>} Resolves when done; rejects to retry.
 */

/**
 * @typedef {object} WorkerLogger
 * @property {(...args: unknown[]) => void} info Info log.
 * @property {(...args: unknown[]) => void} warn Warning log.
 * @property {(...args: unknown[]) => void} error Error log.
 */

/**
 * @typedef {object} ClaimedJob
 * @property {string} id Job ID.
 * @property {string} type Job type.
 * @property {Record<string, unknown>} payload Job data.
 * @property {number} attempts Attempts so far, including this one.
 * @property {string} idempotency_key Idempotency key.
 */

/** @typedef {'idle' | 'done' | 'retry' | 'failed'} RunOutcome */

/**
 * Claim the next ready job: pending and due, or running with an expired lease (its worker died).
 * `FOR UPDATE SKIP LOCKED` means two workers never claim the same job.
 * @param {import('pg').Pool} pool Pool.
 * @param {Date} now Current time.
 * @param {number} leaseMs Lease length.
 * @returns {Promise<ClaimedJob | undefined>} The claimed job, if any.
 */
async function claimJob(pool, now, leaseMs) {
  const { rows } = await pool.query(
    `UPDATE jobs SET status = 'running', attempts = attempts + 1, locked_at = $1, updated_at = $1
     WHERE id = (
       SELECT id FROM jobs
       WHERE (status = 'pending' AND run_after <= $1)
          OR (status = 'running' AND locked_at < $1 - make_interval(secs => $2 / 1000.0))
       ORDER BY run_after
       FOR UPDATE SKIP LOCKED
       LIMIT 1)
     RETURNING id, type, payload, attempts, idempotency_key`,
    [now, leaseMs],
  );
  return rows[0];
}

/**
 * Record a job's outcome and its audit event in one transaction. The update only applies while
 * this worker still holds the claim (same attempt), so a reclaimed job is never overwritten.
 * @param {import('pg').Pool} pool Pool.
 * @param {ClaimedJob} job Job.
 * @param {{ status: 'done' | 'pending' | 'failed', runAfter: Date, error: string | null, now: Date }} result
 *   Outcome.
 * @returns {Promise<void>}
 */
async function finishJob(pool, job, { status, runAfter, error, now }) {
  await withTransaction(pool, async (tx) => {
    const { rowCount } = await tx.query(
      `UPDATE jobs SET status = $3, run_after = $4, last_error = $5, locked_at = NULL, updated_at = $6
       WHERE id = $1 AND attempts = $2 AND status = 'running'`,
      [job.id, job.attempts, status, runAfter, error, now],
    );
    if (rowCount === 0 || status === 'pending') {
      return;
    }
    const initiativeId = job.payload.initiativeId;
    await appendAuditEvent(
      tx,
      {
        actorType: 'system',
        actorId: WORKER_ACTOR,
        action: status === 'done' ? 'job.succeeded' : 'job.failed',
        entityType: 'job',
        entityId: job.id,
        initiativeId: typeof initiativeId === 'string' ? initiativeId : null,
        data: { type: job.type, attempts: job.attempts, error },
      },
      { now: () => now },
    );
  });
}

/**
 * Create the background job worker. It runs in the service process, claims one job at a time,
 * retries failures with exponential backoff and marks a job failed after the last attempt.
 * @param {object} deps Dependencies.
 * @param {import('pg').Pool} deps.pool Pool.
 * @param {Record<string, JobHandler>} deps.handlers Handlers by job type.
 * @param {import('../config/index.js').WorkerConfig} deps.settings Worker settings.
 * @param {WorkerLogger} deps.logger Logger.
 * @param {() => Date} [deps.now] Clock.
 * @returns {{ runOnce: () => Promise<RunOutcome>, start: () => void, stop: () => Promise<void> }}
 *   The worker.
 */
export function createJobWorker({ pool, handlers, settings, logger, now = () => new Date() }) {
  /**
   * Claim and run one job.
   * @returns {Promise<RunOutcome>} What happened.
   */
  async function runOnce() {
    const job = await claimJob(pool, now(), settings.leaseMs);
    if (job === undefined) {
      return 'idle';
    }
    const handler = Object.hasOwn(handlers, job.type) ? handlers[job.type] : undefined;
    try {
      if (handler === undefined) {
        throw new Error(`No handler for job type "${job.type}"`);
      }
      await handler(job.payload, {
        jobId: job.id,
        attempt: job.attempts,
        idempotencyKey: job.idempotency_key,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const finalAttempt = handler === undefined || job.attempts >= settings.maxAttempts;
      const at = now();
      const delay = settings.backoffBaseMs * 2 ** (job.attempts - 1);
      await finishJob(pool, job, {
        status: finalAttempt ? 'failed' : 'pending',
        runAfter: finalAttempt ? at : new Date(at.getTime() + delay),
        error: message,
        now: at,
      });
      logger.warn(
        { jobId: job.id, type: job.type, attempt: job.attempts, err: error },
        'job failed',
      );
      return finalAttempt ? 'failed' : 'retry';
    }
    const at = now();
    await finishJob(pool, job, { status: 'done', runAfter: at, error: null, now: at });
    return 'done';
  }

  let stopped = true;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  /** @type {Promise<void>} */
  let running = Promise.resolve();

  /**
   * One poll: run a job, then come back at once if there was one, or after the poll interval.
   * @returns {Promise<void>}
   */
  async function tick() {
    let delay = settings.pollIntervalMs;
    try {
      if ((await runOnce()) !== 'idle') {
        delay = 0;
      }
    } catch (error) {
      logger.error({ err: error }, 'job worker poll failed');
    }
    if (!stopped) {
      timer = setTimeout(() => {
        running = tick();
      }, delay);
    }
  }

  return {
    runOnce,
    start() {
      stopped = false;
      running = tick();
    },
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await running;
    },
  };
}
