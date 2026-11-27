// @ts-check
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listAuditEvents } from '../../src/audit/index.js';
import { withTransaction } from '../../src/db/index.js';
import { createJobWorker, createLogHandler, enqueueJob } from '../../src/jobs/index.js';
import { createTestDatabase } from '../db/test-database.js';

const BASE_MS = 1000;
const START = new Date('2026-12-07T08:00:00.000Z');

/** @type {import('../db/test-database.js').TestDatabase} */
let db;
/** @type {Date} */
let clock;

/** @type {import('../../src/config/index.js').WorkerConfig} */
const settings = {
  enabled: true,
  pollIntervalMs: 5,
  backoffBaseMs: BASE_MS,
  maxAttempts: 5,
  leaseMs: 60_000,
};

/** A logger that discards everything. */
const quietLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

beforeEach(async () => {
  db = await createTestDatabase();
  clock = START;
});

afterEach(async () => {
  await db.close();
});

/**
 * Wait a real number of milliseconds.
 * @param {number} ms Milliseconds.
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll until a condition holds, failing the test after a generous limit rather than hanging.
 * @param {() => Promise<boolean>} condition Condition to wait for.
 * @returns {Promise<void>}
 * @throws {Error} When the condition doesn't hold within 5 seconds.
 */
async function waitFor(condition) {
  for (let elapsed = 0; elapsed < 5000; elapsed += 10) {
    if (await condition()) {
      return;
    }
    await sleep(10);
  }
  throw new Error('Condition not met within 5 seconds');
}

/**
 * Move the test clock forward.
 * @param {number} ms Milliseconds.
 * @returns {void}
 */
function advance(ms) {
  clock = new Date(clock.getTime() + ms);
}

/**
 * Enqueue a job in its own transaction.
 * @param {Partial<import('../../src/jobs/index.js').JobInput>} [input] Overrides.
 * @returns {Promise<{ id: string, created: boolean }>} Result.
 */
function enqueue(input = {}) {
  return withTransaction(db.pool, (tx) =>
    enqueueJob(
      tx,
      { type: 'test', payload: { n: 1 }, idempotencyKey: 'key-1', ...input },
      { now: () => clock },
    ),
  );
}

/**
 * Build a worker on the test database.
 * @param {Record<string, import('../../src/jobs/index.js').JobHandler>} handlers Handlers by type.
 * @param {{ pool?: import('pg').Pool, logger?: typeof quietLogger }} [options] Overrides.
 * @returns {ReturnType<typeof createJobWorker>} The worker.
 */
function worker(handlers, { pool = db.pool, logger = quietLogger } = {}) {
  return createJobWorker({ pool, handlers, settings, logger, now: () => clock });
}

/**
 * The single job's row.
 * @returns {Promise<Record<string, unknown>>} Row.
 */
async function job() {
  const { rows } = await db.pool.query('SELECT status, attempts, run_after, last_error FROM jobs');
  return rows[0];
}

describe('enqueueJob', () => {
  it('creates a pending job', async () => {
    const result = await enqueue();

    expect(result.created).toBe(true);
    expect(await job()).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('does not duplicate a job with the same idempotency key', async () => {
    const first = await enqueue();

    const second = await enqueue({ payload: { n: 2 } });

    expect(second).toEqual({ id: first.id, created: false });
    const { rows } = await db.pool.query('SELECT count(*)::int AS n FROM jobs');
    expect(rows[0].n).toBe(1);
  });

  it('writes nothing when the surrounding transaction rolls back', async () => {
    await withTransaction(db.pool, async (tx) => {
      await enqueueJob(tx, { type: 'test', payload: {}, idempotencyKey: 'k' });
      throw new Error('abort');
    }).catch(() => undefined);

    expect(await job()).toBeUndefined();
  });
});

describe('createJobWorker.runOnce', () => {
  it('reports idle when no job is ready', async () => {
    expect(await worker({}).runOnce()).toBe('idle');
  });

  it('runs the handler and marks the job done, with an audit event', async () => {
    /** @type {unknown[]} */
    const seen = [];
    await enqueue({ payload: { initiativeId: null, note: 'hi' } });

    const outcome = await worker({ test: async (payload) => void seen.push(payload) }).runOnce();

    expect(outcome).toBe('done');
    expect(seen).toEqual([{ initiativeId: null, note: 'hi' }]);
    expect(await job()).toMatchObject({ status: 'done', attempts: 1 });
    const [event] = await listAuditEvents(db.pool);
    expect(event).toMatchObject({ action: 'job.succeeded', actorType: 'system' });
  });

  it('retries a failed job with exponential backoff', async () => {
    await enqueue();
    const failing = worker({
      test: async () => {
        throw new Error('flaky');
      },
    });

    expect(await failing.runOnce()).toBe('retry');
    expect(await job()).toMatchObject({ status: 'pending', attempts: 1, last_error: 'flaky' });
    expect((await job()).run_after).toEqual(new Date(START.getTime() + BASE_MS));

    expect(await failing.runOnce()).toBe('idle');
    advance(BASE_MS);
    expect(await failing.runOnce()).toBe('retry');
    expect((await job()).run_after).toEqual(new Date(START.getTime() + BASE_MS + 2 * BASE_MS));
  });

  it('marks the job failed after 5 attempts, with an audit event', async () => {
    await enqueue();
    const failing = worker({
      test: async () => {
        throw new Error('down');
      },
    });

    /** @type {string[]} */
    const outcomes = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      outcomes.push(await failing.runOnce());
      advance(BASE_MS * 2 ** attempt);
    }

    expect(outcomes).toEqual(['retry', 'retry', 'retry', 'retry', 'failed']);
    expect(await job()).toMatchObject({ status: 'failed', attempts: 5, last_error: 'down' });
    expect(await failing.runOnce()).toBe('idle');
    const events = await listAuditEvents(db.pool);
    expect(events.map((event) => event.action)).toEqual([
      'job.retry_scheduled',
      'job.retry_scheduled',
      'job.retry_scheduled',
      'job.retry_scheduled',
      'job.failed',
    ]);
    expect(events.at(-1)?.data).toEqual({ type: 'test', attempts: 5, reason: 'handler_error' });
  });

  it('never writes the handler error message into the audit trail', async () => {
    await enqueue();
    const leaky = worker({
      test: async () => {
        throw new Error('token=secret-value');
      },
    });

    await leaky.runOnce();

    const events = await listAuditEvents(db.pool);
    expect(JSON.stringify(events)).not.toContain('secret-value');
    expect((await job()).last_error).toBe('token=secret-value');
  });

  it('fails a job whose type has no handler', async () => {
    await enqueue({ type: 'unknown' });

    expect(await worker({}).runOnce()).toBe('failed');
    expect(await job()).toMatchObject({
      status: 'failed',
      last_error: 'No handler for job type "unknown"',
    });
  });

  it('never runs one job on two workers at once', async () => {
    await enqueue();
    let calls = 0;
    /** @type {() => void} */
    let release = () => undefined;
    const gate = new Promise((resolve) => {
      release = () => resolve(undefined);
    });
    const handlers = {
      test: async () => {
        calls += 1;
        await gate;
      },
    };
    const first = worker(handlers).runOnce();
    await waitFor(async () => (await job()).status === 'running');

    const second = await worker(handlers, { pool: db.newPool() }).runOnce();
    release();

    expect(second).toBe('idle');
    expect(await first).toBe('done');
    expect(calls).toBe(1);
  });

  it('skips a job another transaction holds locked instead of waiting for it', async () => {
    await enqueue();
    const holder = await db.newPool().connect();
    await holder.query('BEGIN');
    await holder.query('SELECT id FROM jobs FOR UPDATE');
    try {
      const outcome = await worker(
        { test: async () => undefined },
        { pool: db.newPool() },
      ).runOnce();

      expect(outcome).toBe('idle');
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }
  });

  it('fails a job whose last attempt died, instead of reclaiming it forever', async () => {
    await enqueue();
    await db.pool.query(`UPDATE jobs SET status = 'running', attempts = 5, locked_at = $1`, [
      clock,
    ]);
    advance(settings.leaseMs + 1);

    expect(await worker({ test: async () => undefined }).runOnce()).toBe('idle');

    expect(await job()).toMatchObject({ status: 'failed', attempts: 5 });
    const [event] = await listAuditEvents(db.pool);
    expect(event).toMatchObject({ action: 'job.failed', data: { reason: 'lease_expired' } });
  });

  it('renews the lease while a slow handler runs, so no other worker takes the job', async () => {
    // These workers run on the real clock, so queue the job at real time.
    clock = new Date();
    await enqueue();
    const shortLease = { ...settings, leaseMs: 300 };
    /** @type {() => void} */
    let release = () => undefined;
    const gate = new Promise((resolve) => {
      release = () => resolve(undefined);
    });
    const slow = createJobWorker({
      pool: db.pool,
      handlers: { test: async () => gate },
      settings: shortLease,
      logger: quietLogger,
    });
    const other = createJobWorker({
      pool: db.newPool(),
      handlers: { test: async () => undefined },
      settings: shortLease,
      logger: quietLogger,
    });

    const running = slow.runOnce();
    await waitFor(async () => (await job()).status === 'running');
    await sleep(shortLease.leaseMs * 2);
    const stolen = await other.runOnce();
    release();

    expect(stolen).toBe('idle');
    expect(await running).toBe('done');
    expect(await job()).toMatchObject({ status: 'done', attempts: 1 });
  });

  it('reclaims a job whose worker died after its lease expired', async () => {
    await enqueue();
    await db.pool.query(`UPDATE jobs SET status = 'running', attempts = 1, locked_at = $1`, [
      clock,
    ]);
    const healthy = worker({ test: async () => undefined });

    expect(await healthy.runOnce()).toBe('idle');
    advance(settings.leaseMs + 1);
    expect(await healthy.runOnce()).toBe('done');
    expect(await job()).toMatchObject({ status: 'done', attempts: 2 });
  });
});

describe('createJobWorker.start and stop', () => {
  it('polls until stopped, running ready jobs', async () => {
    await enqueue();
    const running = worker({ test: async () => undefined });

    running.start();
    await waitFor(async () => (await job()).status === 'done');
    await running.stop();

    expect((await job()).status).toBe('done');
  });

  it('logs a poll that fails and keeps going', async () => {
    /** @type {unknown[]} */
    const errors = [];
    const broken = /** @type {import('pg').Pool} */ (
      /** @type {unknown} */ ({
        connect: async () => {
          throw new Error('database unavailable');
        },
      })
    );
    const running = worker(
      {},
      {
        pool: broken,
        logger: { ...quietLogger, error: (...args) => void errors.push(args) },
      },
    );

    running.start();
    await waitFor(async () => errors.length >= 2);
    await running.stop();

    expect(errors.length).toBeGreaterThanOrEqual(2);
  });

  it('can be stopped before it was started', async () => {
    await expect(worker({}).stop()).resolves.toBeUndefined();
  });
});

describe('createLogHandler', () => {
  it('logs the payload', async () => {
    /** @type {unknown[]} */
    const lines = [];
    const handler = createLogHandler({ info: (...args) => void lines.push(args) });

    await handler({ event: 'stage.approved' }, { jobId: 'j', attempt: 1, idempotencyKey: 'k' });

    expect(lines).toEqual([[{ job: 'j', payload: { event: 'stage.approved' } }, 'log job']]);
  });
});
