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
import { buildClaimGraph } from './claims/pipeline.js';
import { transcriptionRouter } from './routes/transcription.js';
import { defaultJsonLlm } from './proof/agents.js';
import { planTopic } from './research/planner.js';
import { ResearchChatService } from './investigations/chat.js';
import { InvestigationService } from './investigations/service.js';
import { contextDevMonitors, scrape as contextDevScrape } from './clients/contextdev.js';
import { contextDevNewsSearch } from './claims/corroborate.js';
import { findLiveSources } from './monitors/liveSources.js';
import { MonitorService } from './monitors/service.js';
import { VettingService, withSourceRatings } from './vetting/service.js';
import { cachedScraper } from './vetting/scrapeCache.js';
import { SourceIndex } from './vetting/sourceIndex.js';
import { NewspaperService } from './newspaper/service.js';
import { getEmbeddings } from './db/vectorStore.js';
import { contextDevScraper } from './proof/articles.js';
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
  /** Research chat (RAG) over investigations; needs `investigations`. */
  chat?: ResearchChatService;
  /** Live monitors (Context.dev Monitors API); needs `investigations`. */
  monitors?: MonitorService;
  /** Source vetting (propaganda screening); needs `investigations`. */
  vetting?: VettingService;
  /** Newspaper editions; needs `investigations`. */
  newspaper?: NewspaperService;
}

export function buildServer({ store, hub, investigations, chat, monitors, vetting, newspaper, corsOrigins = config.CORS_ORIGINS }: ServerDeps) {
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
  // Keep the raw bytes: webhook signatures are computed over the exact request body.
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        (req as { rawBody?: Buffer }).rawBody = Buffer.from(buf);
      },
    }),
  );

  const api = express.Router();
  api.use(healthRouter);
  api.use(helloRouter);
  api.use(chatRouter);
  api.use(transcriptionRouter({ apiKey: config.GEMINI_API_KEY, model: config.GEMINI_TRANSCRIPTION_MODEL }));
  api.use(timelineRouter({ store, hub }));
  if (investigations) api.use(investigationsRouter(investigations, chat, monitors, vetting, newspaper));

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

  // Every new source gets its domain listing (influence operation / state media / rating) attached.
  const investigationStore: InvestigationStore = withSourceRatings(
    config.TIMELINE_MOCK ? new MemoryInvestigationStore() : new MongoInvestigationStore(col.investigations, col.researchRuns, col.chatMessages),
  );
  // Runs cannot survive a restart: record any that were in flight as failed. Runs in the
  // background so startup never waits on the database.
  void investigationStore
    .failStaleRuns('Server restarted while the run was in progress.')
    .then((stale) => stale && logger.warn({ stale }, 'marked interrupted research runs as failed'))
    .catch((err) => logger.error({ err }, 'could not clean up stale research runs'));
  const investigations: InvestigationService = new InvestigationService({
    store: investigationStore,
    publish: (e) => hub.broadcast(e),
    // Clean topic, mode (news / politician), search queries and key terms from whatever was typed.
    plan: (raw) => planTopic(raw, defaultJsonLlm),
    // After research: build the structured claim graph so parents + children appear immediately.
    afterRun: (id) => rebuildClaims(id),
  });

  // Screening, claim building and the proof engine read the same pages: fetch each once.
  const scraper = cachedScraper(contextDevScraper);

  // Screen sources -> build claims -> corroborate -> screen corroborating sources -> store.
  async function rebuildClaims(id: string, prefer: string[] = []) {
    await buildClaimGraph(id, {
      store: investigationStore,
      scrape: scraper,
      json: defaultJsonLlm,
      prefer,
      ...(config.AUTO_VET_SOURCES && { vetting }),
    });
  }

  // Live monitors: Context.dev pushes changes to /webhook/monitor when this backend is publicly
  // reachable over HTTPS; the poller covers everything else (and missed deliveries).
  const publicUrl = config.PUBLIC_BASE_URL.replace(/\/+$/, '');
  const webhookUrl = /^https:\/\//.test(publicUrl) && !/localhost|127\.0\.0\.1/.test(publicUrl) ? `${publicUrl}/webhook/monitor` : undefined;
  const monitors = new MonitorService({
    store: investigationStore,
    client: contextDevMonitors,
    publish: (e) => hub.broadcast(e),
    rebuildClaims,
    liveSources: (topic) =>
      findLiveSources(topic, {
        search: contextDevNewsSearch,
        scrape: async (url) => {
          const r = await contextDevScrape(url);
          return r.success ? { ok: true, markdown: r.markdown, updatedAt: r.publishedAt } : { ok: false, error: r.error };
        },
      }),
    ...(webhookUrl && { webhookUrl }),
  });
  if (config.CONTEXT_DEV_API_KEY) monitors.startPolling(config.MONITOR_POLL_MS);
  logger.info({ webhook: Boolean(webhookUrl), pollMs: config.MONITOR_POLL_MS, autoVet: config.AUTO_VET_SOURCES }, 'live monitors ready');

  // Propaganda / manipulation screening of sources (domain listings + grounded rhetoric analysis).
  const vetting = new VettingService({
    store: investigationStore,
    publish: (e) => hub.broadcast(e),
    scrape: scraper,
    json: defaultJsonLlm,
    rebuildClaims: (id) => rebuildClaims(id),
    // Screened sources are embedded into `sources` (vector_index) for semantic search.
    ...(!config.TIMELINE_MOCK && config.EMBEDDING_API_KEY && { index: new SourceIndex(col.sources, (text) => getEmbeddings().embedQuery(text)) }),
  });

  const chat = new ResearchChatService({
    store: investigationStore,
    investigations,
    publish: (e) => hub.broadcast(e),
    proof: { scrape: scraper },
    ...(config.AUTO_VET_SOURCES && { vetting }),
  });

  // Front-page edition of each investigation (claim graph -> newspaper), images from articles.
  const newspaper = new NewspaperService({
    store: investigationStore,
    json: defaultJsonLlm,
    pageImage: async (url) => {
      const r = await contextDevScrape(url);
      return r.success && r.image && /^https?:\/\//i.test(r.image) ? r.image : undefined;
    },
  });

  const server = createHttpServer({ store, hub, investigations, chat, monitors, vetting, newspaper });
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
    monitors.stopPolling();
    hub.close();
    server.close();
    await closeContextMcp();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
