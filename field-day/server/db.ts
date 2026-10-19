import pg from 'pg';

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

export function createPool(connectionString: string, max = 20): Db {
  const pool = new pg.Pool({ connectionString, max });
  pool.on('error', (err) => {
    console.error('[db] idle client error', err.message);
  });
  return pool;
}

/** 트랜잭션 실행. 직렬화 실패/교착 시 짧게 재시도 */
export async function withTx<T>(db: Db, fn: (tx: Tx) => Promise<T>, retries = 3): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      const code = (err as { code?: string }).code;
      if ((code === '40001' || code === '40P01') && attempt < retries) continue;
      throw err;
    } finally {
      client.release();
    }
  }
}
