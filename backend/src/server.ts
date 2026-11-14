import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import { MongoNetworkError, MongoServerError, MongoServerSelectionError } from 'mongodb';
import { pinoHttp } from 'pino-http';
import { config } from './config.js';
import { col } from './db/client.js';
import { RealtimeHub } from './realtime/hub.js';
import { chatRouter } from './routes/chat.js';
import { healthRouter } from './routes/health.js';
import { helloRouter } from './routes/hello.js';
import { investigationsRouter } from './routes/investigations.js';
import { timelineRouter } from './routes/timeline.js';
import { InvestigationService } from './investigations/service.js';
import { MemoryInvestigationStore, MongoInvestigationStore, type InvestigationStore } from './investigations/store.js';
import { closeContextMcp } from './agent/tools/contextMcp.js';
import { initTools } from './agent/tools/index.js';
import { seedMockTimeline, startMockFeed } from './timeline/mock.js';
import { MemoryTimelineStore, MongoTimelineStore, type TimelineStore } from './timeline/store.js';
import { logger } from './utils/logger.js';

export interface ServerDeps {
  store: TimelineStore;
  hub: RealtimeHub;
  /** Allowed cross-origin browser origins; defaults to CORS_ORIGINS. */
  corsOrigins?: string[];
  /** Investigation API; routes are mounted only when provided. */
  investigations?: InvestigationService;
}

export function buildServer({ store, hub, investigations, corsOrigins = config.CORS_ORIGINS }: ServerDeps) {
  const app = express();
  app.disable('x-powered-by');
  // Never log credentials (browsers send cookies for every app on localhost).
  app.use(
    pinoHttp({
      logger,
      redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
    }),
  );
  if (corsOrigins.length) app.use(cors({ origin: corsOrigins }));
  app.use(express.json({ limit: '1mb' }));

  const api = express.Router();
  api.use(healthRouter);
  api.use(helloRouter);
  api.use(chatRouter);
  api.use(timelineRouter({ store, hub }));
  if (investigations) api.use(investigationsRouter(investigations));

  // Caddy and the Vite dev proxy strip `/api`; `/api/*` is also served for clients that
  // point VITE_API_BASE_URL straight at the backend.
  app.use('/api', api);
  app.use(api);

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });
  // Express 5 forwards rejected promises from async handlers here.
  const onError: ErrorRequestHandler = (err, req, res, _next) => {
    req.log.error(err);
    if (isDatabaseUnavailable(err)) {
      res.status(503).json({ error: 'database_unavailable', detail: 'Cannot reach or log in to MongoDB. Check MONGODB_URI.' });
      return;
    }
    res.status(500).json({ error: 'internal_error' });
  };
  app.use(onError);
  return app;
}

/** Auth failures (Atlas code 8000 / 18) and unreachable servers. */
function isDatabaseUnavailable(err: unknown): boolean {
  if (err instanceof MongoServerSelectionError || err instanceof MongoNetworkError) return true;
  return err instanceof MongoServerError && (err.code === 8000 || err.code === 18);
}

/** HTTP server with the WebSocket hub attached on `/ws`. */
export function createHttpServer(deps: ServerDeps): http.Server {
  const server = http.createServer(buildServer(deps));
  deps.hub.attach(server);
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    logger.error(err, 'startup failed');
    process.exit(1);
  });
}

async function main() {
  await initTools(); // connect to the MCP server and load tools BEFORE accepting requests

  const store: TimelineStore = config.TIMELINE_MOCK
    ? new MemoryTimelineStore()
    : new MongoTimelineStore(col.timelineNodes, col.timelineMeta);
  if (config.TIMELINE_MOCK) await seedMockTimeline(store);
  const hub = new RealtimeHub(store);

  const investigationStore: InvestigationStore = config.TIMELINE_MOCK
    ? new MemoryInvestigationStore()
    : new MongoInvestigationStore(col.investigations, col.researchRuns);
  // Runs cannot survive a restart: record any that were in flight as failed. Runs in the
  // background so startup never waits on the database.
  void investigationStore
    .failStaleRuns('Server restarted while the run was in progress.')
    .then((stale) => stale && logger.warn({ stale }, 'marked interrupted research runs as failed'))
    .catch((err) => logger.error({ err }, 'could not clean up stale research runs'));
  const investigations = new InvestigationService({ store: investigationStore, publish: (e) => hub.broadcast(e) });

  const server = createHttpServer({ store, hub, investigations });
  server.listen(config.PORT, '0.0.0.0', () => {
    logger.info({ port: config.PORT, mockTimeline: config.TIMELINE_MOCK }, 'server listening (HTTP + WebSocket /ws)');
  });
  if (config.TIMELINE_MOCK) {
    // Start the live demo when the first browser connects, so the growth animation is visible.
    let started = false;
    hub.onClientConnected(() => {
      if (started) return;
      started = true;
      startMockFeed(store, hub, config.TIMELINE_MOCK_INTERVAL_MS);
    });
  }
  server.on('error', (err) => {
    logger.error(err, 'server failed');
    process.exit(1);
  });

  const shutdown = async () => {
    hub.close();
    server.close();
    await closeContextMcp();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
