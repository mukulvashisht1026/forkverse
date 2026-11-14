import { randomUUID } from 'node:crypto';
import { MongoClient, MongoServerError, type ClientSession, type Db } from 'mongodb';
import { config } from '../config.js';
import type { Collections } from './schema.js';

export const mongo = new MongoClient(config.MONGODB_URI, { maxPoolSize: 10 });

export const db: Db = mongo.db(config.MONGODB_DB);

/** Typed collection handles. The driver connects lazily on first operation. */
export const col = {
  entities: db.collection<Collections['entities']>('entities'),
  sources: db.collection<Collections['sources']>('sources'),
  nodes: db.collection<Collections['nodes']>('nodes'),
  edges: db.collection<Collections['edges']>('edges'),
  metrics: db.collection<Collections['metrics']>('metrics'),
  alerts: db.collection<Collections['alerts']>('alerts'),
  monitors: db.collection<Collections['monitors']>('monitors'),
  evalRuns: db.collection<Collections['eval_runs']>('eval_runs'),
  locks: db.collection<Collections['locks']>('locks'),
} as const;

export const newId = (): string => randomUUID();

/**
 * Run fn inside a multi-document transaction; aborts on throw. Pass `session` to every
 * operation inside fn. Requires a replica set (every Atlas cluster is one).
 */
export async function withTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = mongo.startSession();
  try {
    return await session.withTransaction(() => fn(session));
  } finally {
    await session.endSession();
  }
}

const LOCK_LEASE_MS = 5 * 60_000;

/**
 * Hold a per-entity lock for the duration of fn, so cron, webhook and manual refreshes
 * never overlap. Returns null if already locked. The lock is a lease document that is
 * renewed while fn runs, so a crashed process releases it once the lease expires.
 */
export async function withEntityLock<T>(entityId: string, fn: () => Promise<T>): Promise<T | null> {
  const owner = randomUUID();
  const now = new Date();
  try {
    // Take the lock if it is free or its lease has expired.
    await col.locks.updateOne(
      { _id: entityId, expires_at: { $lt: now } },
      { $set: { owner, expires_at: new Date(now.getTime() + LOCK_LEASE_MS) } },
      { upsert: true },
    );
  } catch (err) {
    // Upsert hit the existing, unexpired lock document.
    if (err instanceof MongoServerError && err.code === 11000) return null;
    throw err;
  }

  const renew = setInterval(() => {
    col.locks
      .updateOne({ _id: entityId, owner }, { $set: { expires_at: new Date(Date.now() + LOCK_LEASE_MS) } })
      .catch(() => {});
  }, LOCK_LEASE_MS / 3);
  try {
    return await fn();
  } finally {
    clearInterval(renew);
    await col.locks.deleteOne({ _id: entityId, owner });
  }
}
