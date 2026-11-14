import Fastify from 'fastify';
import { config } from './config.js';
import { healthRoutes } from './routes/health.js';

export async function buildServer() {
  const app = Fastify({ logger: { level: config.LOG_LEVEL } });
  await app.register(healthRoutes);
  return app;
}

const app = await buildServer();
app.listen({ port: config.PORT, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
