import type { FastifyInstance } from 'fastify';
import { pool } from '../db/pool.js';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (_req, reply) => {
    try {
      await pool.query('SELECT 1');
      return { ok: true, db: 'up' };
    } catch {
      return reply.code(503).send({ ok: false, db: 'down' });
    }
  });
}
