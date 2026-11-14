import pg from 'pg';
import pgvector from 'pgvector/pg';
import { config } from '../config.js';

export const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 10 });

pool.on('connect', async (client) => {
  await pgvector.registerTypes(client);
});

export type Db = pg.Pool | pg.PoolClient;

/** Run fn inside a transaction; rolls back on throw. */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Hold a session-level advisory lock keyed on an entity id for the duration of fn,
 * so cron, webhook and manual refreshes never overlap. Returns null if already locked.
 */
export async function withEntityLock<T>(entityId: string, fn: () => Promise<T>): Promise<T | null> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked",
      [entityId],
    );
    if (!rows[0]?.locked) return null;
    try {
      return await fn();
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [entityId]);
    }
  } finally {
    client.release();
  }
}

export function toVectorSql(v: number[]): string {
  return pgvector.toSql(v) as string;
}
