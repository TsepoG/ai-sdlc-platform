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
export async function withTransaction(pool, work) {
  const client = await pool.connect();
  /** @type {Error | undefined} */
  let broken;
  try {
    await client.query('BEGIN');
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
