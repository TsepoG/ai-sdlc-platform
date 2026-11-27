// @ts-check

/**
 * Run `work` in one transaction on a dedicated connection: commit when it resolves, roll back
 * and rethrow when it throws. The connection always goes back to the pool.
 * @template T
 * @param {import('pg').Pool} pool Connection pool.
 * @param {(tx: import('pg').PoolClient) => Promise<T>} work Statements to run in the transaction.
 * @returns {Promise<T>} What `work` returned.
 * @throws {unknown} Whatever `work` threw, after rolling back.
 */
export function withTransaction(pool, work) {
  return runInTransaction(pool, 'BEGIN', work);
}

/**
 * Run read-only `work` against one consistent snapshot (REPEATABLE READ): every query sees the
 * database as it was at the first one, so multi-query reads never mix states.
 * @template T
 * @param {import('pg').Pool} pool Connection pool.
 * @param {(tx: import('pg').PoolClient) => Promise<T>} work Queries to run.
 * @returns {Promise<T>} What `work` returned.
 * @throws {unknown} Whatever `work` threw (including any attempt to write).
 */
export function withReadSnapshot(pool, work) {
  return runInTransaction(pool, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', work);
}

/**
 * Open a transaction with the given BEGIN statement, run `work`, then commit, or roll back and
 * rethrow. The connection always goes back to the pool.
 * @template T
 * @param {import('pg').Pool} pool Connection pool.
 * @param {string} begin BEGIN statement (a constant; never built from input).
 * @param {(tx: import('pg').PoolClient) => Promise<T>} work Statements to run.
 * @returns {Promise<T>} What `work` returned.
 * @throws {unknown} Whatever `work` threw, after rolling back.
 */
async function runInTransaction(pool, begin, work) {
  const client = await pool.connect();
  /** @type {Error | undefined} */
  let broken;
  try {
    await client.query(begin);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError) => {
      // A connection that can't roll back is not safe to reuse; release(error) destroys it.
      broken = rollbackError;
    });
    throw error;
  } finally {
    client.release(broken);
  }
}
