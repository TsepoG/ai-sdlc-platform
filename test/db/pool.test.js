// @ts-check
import { afterEach, describe, expect, it } from 'vitest';
import { createPool, pingDatabase } from '../../src/db/index.js';

/** @type {import('pg').Pool | undefined} */
let pool;

afterEach(async () => {
  await pool?.end();
  pool = undefined;
});

/** @type {import('../../src/config/index.js').DatabaseConfig} */
const settings = {
  host: 'db.example.internal',
  port: 5432,
  name: 'platform',
  user: 'app',
  password: 'placeholder',
  ssl: true,
  poolMax: 7,
};

describe('createPool', () => {
  it('passes the connection settings through', () => {
    pool = createPool(settings);

    expect(pool.options).toMatchObject({
      host: 'db.example.internal',
      port: 5432,
      database: 'platform',
      user: 'app',
      max: 7,
    });
  });

  it('always verifies the server certificate when TLS is on', () => {
    pool = createPool(settings);

    expect(pool.options.ssl).toEqual({ rejectUnauthorized: true });
  });

  it('turns TLS off only when configured off', () => {
    pool = createPool({ ...settings, ssl: false });

    expect(pool.options.ssl).toBe(false);
  });

  it('logs idle-client errors instead of crashing the process', () => {
    /** @type {unknown[]} */
    const logged = [];
    pool = createPool(settings, { logger: { error: (...args) => void logged.push(args) } });

    pool.emit('error', new Error('connection reset'));

    expect(logged).toHaveLength(1);
  });
});

describe('pingDatabase', () => {
  it('is true when the database answers', async () => {
    const fake = { query: async () => ({ rows: [{ ok: 1 }] }) };

    expect(await pingDatabase(fake)).toBe(true);
  });

  it('is false when the query fails', async () => {
    const fake = {
      query: async () => {
        throw new Error('down');
      },
    };

    expect(await pingDatabase(fake)).toBe(false);
  });
});
