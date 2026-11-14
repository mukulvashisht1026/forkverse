import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express, { type ErrorRequestHandler } from 'express';
import { pinoHttp } from 'pino-http';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { healthRouter } from './routes/health.js';
import { helloRouter } from './routes/hello.js';
import { chatRouter } from './routes/chat.js';

export function buildServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use(pinoHttp({ logger }));
  app.use(express.json());

  app.use(healthRouter);
  app.use(helloRouter);
  app.use(chatRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });
  // Express 5 forwards rejected promises from async handlers here.
  const onError: ErrorRequestHandler = (err, req, res, _next) => {
    req.log.error(err);
    res.status(500).json({ error: 'internal_error' });
  };
  app.use(onError);
  return app;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const server = buildServer().listen(config.PORT, '0.0.0.0', () => {
    logger.info({ port: config.PORT }, 'server listening');
  });
  server.on('error', (err) => {
    logger.error(err, 'server failed');
    process.exit(1);
  });
}
