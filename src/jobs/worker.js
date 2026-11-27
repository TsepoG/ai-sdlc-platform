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

/** Renew a running job's lease this many times per lease period. */
const HEARTBEATS_PER_LEASE = 3;

/**
 * Claim the next ready job: pending and due, or running with an expired lease (its worker died)
 * while attempts remain. `FOR UPDATE SKIP LOCKED` means two workers never claim the same job.
 * @param {import('pg').Pool} pool Pool.
 * @param {Date} now Current time.
 * @param {import('../config/index.js').WorkerConfig} settings Worker settings.
 * @returns {Promise<ClaimedJob | undefined>} The claimed job, if any.
 */
async function claimJob(pool, now, settings) {
  const { rows } = await pool.query(
    `UPDATE jobs SET status = 'running', attempts = attempts + 1, locked_at = $1, updated_at = $1
     WHERE id = (
       SELECT id FROM jobs
       WHERE (status = 'pending' AND run_after <= $1)
          OR (status = 'running' AND attempts < $3
              AND locked_at < $1::timestamptz - make_interval(secs => $2 / 1000.0))
       ORDER BY run_after
       FOR UPDATE SKIP LOCKED
       LIMIT 1)
     RETURNING id, type, payload, attempts, idempotency_key`,
    [now, settings.leaseMs, settings.maxAttempts],
  );
  return rows[0];
}

/**
 * Append a job audit event. Only a reason code is recorded, never the handler's error message:
 * audit rows are permanent and a message could carry a token or personal data. The message is
 * kept in the job's own (mutable) `last_error`.
 * @param {import('pg').PoolClient} tx Transaction.
 * @param {ClaimedJob} job Job.
 * @param {string} action Audit action.
 * @param {Record<string, unknown>} data Details (no error text).
 * @param {Date} now When it happened.
 * @returns {Promise<void>}
 */
async function auditJob(tx, job, action, data, now) {
  const initiativeId = job.payload.initiativeId;
  await appendAuditEvent(
    tx,
    {
      actorType: 'system',
      actorId: WORKER_ACTOR,
      action,
      entityType: 'job',
      entityId: job.id,
      initiativeId: typeof initiativeId === 'string' ? initiativeId : null,
      data: { type: job.type, attempts: job.attempts, ...data },
    },
    { now: () => now },
  );
}

/**
 * @typedef {object} JobResult
 * @property {'done' | 'pending' | 'failed'} status New status.
 * @property {Date} runAfter When it may run next.
 * @property {string | null} error Error message for `last_error`.
 * @property {'handler_error' | 'no_handler' | null} reason Why it failed or will retry.
 * @property {Date} now Current time.
 */

/**
 * Record a job's outcome and its audit event in one transaction. The update only applies while
 * this worker still holds the claim (same attempt), so a reclaimed job is never overwritten.
 * @param {import('pg').Pool} pool Pool.
 * @param {ClaimedJob} job Job.
 * @param {JobResult} result Outcome.
 * @returns {Promise<void>}
 */
async function finishJob(pool, job, { status, runAfter, error, reason, now }) {
  await withTransaction(pool, async (tx) => {
    const { rowCount } = await tx.query(
      `UPDATE jobs SET status = $3, run_after = $4, last_error = $5, locked_at = NULL, updated_at = $6
       WHERE id = $1 AND attempts = $2 AND status = 'running'`,
      [job.id, job.attempts, status, runAfter, error, now],
    );
    if (rowCount === 0) {
      return;
    }
    if (status === 'done') {
      await auditJob(tx, job, 'job.succeeded', {}, now);
    } else if (status === 'pending') {
      await auditJob(
        tx,
        job,
        'job.retry_scheduled',
        { reason, runAfter: runAfter.toISOString() },
        now,
      );
    } else {
      await auditJob(tx, job, 'job.failed', { reason }, now);
    }
  });
}

/**
 * Fail jobs whose last attempt's lease expired: their worker died (or the job keeps killing it),
 * and no attempts remain, so they would otherwise sit in `running` forever.
 * @param {import('pg').Pool} pool Pool.
 * @param {Date} now Current time.
 * @param {import('../config/index.js').WorkerConfig} settings Worker settings.
 * @returns {Promise<void>}
 */
async function failExhaustedJobs(pool, now, settings) {
  await withTransaction(pool, async (tx) => {
    const { rows } = await tx.query(
      `UPDATE jobs SET status = 'failed', locked_at = NULL, updated_at = $1,
         last_error = 'Lease expired on the final attempt'
       WHERE status = 'running' AND attempts >= $3
         AND locked_at < $1::timestamptz - make_interval(secs => $2 / 1000.0)
       RETURNING id, type, payload, attempts, idempotency_key`,
      [now, settings.leaseMs, settings.maxAttempts],
    );
    for (const job of rows) {
      await auditJob(tx, job, 'job.failed', { reason: 'lease_expired' }, now);
    }
  });
}

/**
 * Keep a claimed job's lease fresh while its handler runs, so a slow handler is never taken
 * over by another worker. Returns a function that stops the heartbeat.
 * @param {import('pg').Pool} pool Pool.
 * @param {ClaimedJob} job Job.
 * @param {{ settings: import('../config/index.js').WorkerConfig, now: () => Date, logger: WorkerLogger }} deps
 *   Settings, clock and logger.
 * @returns {() => void} Stops the heartbeat.
 */
function startHeartbeat(pool, job, { settings, now, logger }) {
  const timer = setInterval(() => {
    pool
      .query(
        `UPDATE jobs SET locked_at = $3 WHERE id = $1 AND attempts = $2 AND status = 'running'`,
        [job.id, job.attempts, now()],
      )
      .catch((error) => logger.warn({ jobId: job.id, err: error }, 'job lease renewal failed'));
  }, settings.leaseMs / HEARTBEATS_PER_LEASE);
  return () => clearInterval(timer);
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
    await failExhaustedJobs(pool, now(), settings);
    const job = await claimJob(pool, now(), settings);
    if (job === undefined) {
      return 'idle';
    }
    const handler = Object.hasOwn(handlers, job.type) ? handlers[job.type] : undefined;
    const stopHeartbeat = startHeartbeat(pool, job, { settings, now, logger });
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
      stopHeartbeat();
      return recordFailure(job, error, handler === undefined);
    }
    stopHeartbeat();
    const at = now();
    await finishJob(pool, job, {
      status: 'done',
      runAfter: at,
      error: null,
      reason: null,
      now: at,
    });
    return 'done';
  }

  /**
   * Schedule a retry with exponential backoff, or fail the job after its last attempt.
   * @param {ClaimedJob} job Job.
   * @param {unknown} error What the handler threw.
   * @param {boolean} noHandler Whether the type has no handler (never retried).
   * @returns {Promise<RunOutcome>} `retry` or `failed`.
   */
  async function recordFailure(job, error, noHandler) {
    const message = error instanceof Error ? error.message : String(error);
    const finalAttempt = noHandler || job.attempts >= settings.maxAttempts;
    const at = now();
    const delay = settings.backoffBaseMs * 2 ** (job.attempts - 1);
    await finishJob(pool, job, {
      status: finalAttempt ? 'failed' : 'pending',
      runAfter: finalAttempt ? at : new Date(at.getTime() + delay),
      error: message,
      reason: noHandler ? 'no_handler' : 'handler_error',
      now: at,
    });
    logger.warn({ jobId: job.id, type: job.type, attempt: job.attempts, err: error }, 'job failed');
    return finalAttempt ? 'failed' : 'retry';
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
