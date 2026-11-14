import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { pool } from './pool.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Works from src/db (tsx) and dist/src/db (compiled). */
async function findMigrationsDir(): Promise<string> {
  for (const rel of ['../../migrations', '../../../migrations']) {
    const dir = path.resolve(here, rel);
    try {
      await readdir(dir);
      return dir;
    } catch {
      /* try next */
    }
  }
  throw new Error('migrations directory not found');
}

export function renderMigration(sql: string, embeddingDim: number): string {
  return sql.replaceAll('${EMBEDDING_DIM}', String(embeddingDim));
}

export async function migrate(): Promise<void> {
  const dir = await findMigrationsDir();
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const client = await pool.connect();
  try {
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
    );
    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name));
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = renderMigration(await readFile(path.join(dir, file), 'utf8'), config.EMBEDDING_DIM);
      logger.info({ file }, 'applying migration');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    client.release();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  migrate()
    .then(() => pool.end())
    .catch((err) => {
      logger.error(err, 'migration failed');
      process.exit(1);
    });
}
