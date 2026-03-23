import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { env } from './lib/config.js';
import { AppError } from './lib/errors.js';
import { registerGraphRoutes } from './routes/graph.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerIngestRoutes } from './routes/ingest.js';
import { registerOpsRoutes } from './routes/ops.js';
import { registerQueryRoutes } from './routes/query.js';
import { neo4jDriver, redis } from './services/clients.js';

const app = Fastify({ logger: true });

app.register(cors, { origin: env.WEB_ORIGIN });
app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof AppError) {
    return reply.status(err.statusCode).send({
      error: { code: err.code, message: err.message }
    });
  }
  app.log.error(err);
  const detail = err instanceof Error ? err.message : String(err);
  return reply.status(500).send({
    error: { code: 'INTERNAL_ERROR', message: 'unexpected server error', detail }
  });
});

await registerHealthRoutes(app);
await registerIngestRoutes(app);
await registerQueryRoutes(app);
await registerGraphRoutes(app);
await registerOpsRoutes(app);

async function start() {
  await redis.connect();
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
}

start().catch((e) => {
  app.log.error(e);
  process.exit(1);
});

process.on('SIGINT', async () => {
  await app.close();
  await redis.quit();
  await neo4jDriver.close();
  process.exit(0);
});
