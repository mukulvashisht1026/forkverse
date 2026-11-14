import { Router } from 'express';
import { db } from '../db/client.js';

export const healthRouter = Router();

healthRouter.get('/health', async (_req, res) => {
  try {
    await db.command({ ping: 1 });
    res.json({ ok: true, db: 'up' });
  } catch {
    res.status(503).json({ ok: false, db: 'down' });
  }
});
