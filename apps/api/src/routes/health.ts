import type { FastifyInstance } from 'fastify';
import { Registry, collectDefaultMetrics } from 'prom-client';
import { env } from '../lib/config.js';
import { neo4jDriver, redis } from '../services/clients.js';
import { ensureQdrant } from '../services/indexing.js';
import { chat } from '../services/llm.js';

const registry = new Registry();
collectDefaultMetrics({ register: registry });

export async function registerHealthRoutes(app: FastifyInstance) {
  app.get('/livez', async () => ({ status: 'ok' }));

  app.get('/readyz', async () => {
    const [redisOk, qdrantOk, neo4jOk] = await Promise.allSettled([
      redis.ping(),
      ensureQdrant(),
      neo4jDriver.verifyConnectivity()
    ]);
    const ready =
      redisOk.status === 'fulfilled' &&
      qdrantOk.status === 'fulfilled' &&
      neo4jOk.status === 'fulfilled';
    return { ready };
  });

  app.get('/health', async () => {
    const out: Record<string, { ok: boolean; detail?: string }> = {
      redis: { ok: false },
      qdrant: { ok: false },
      neo4j: { ok: false },
      llm: { ok: false }
    };

    try {
      out.redis.ok = (await redis.ping()) === 'PONG';
    } catch (e) {
      out.redis.detail = String(e);
    }
    try {
      await ensureQdrant();
      out.qdrant.ok = true;
    } catch (e) {
      out.qdrant.detail = String(e);
    }
    try {
      await neo4jDriver.verifyConnectivity();
      out.neo4j.ok = true;
    } catch (e) {
      out.neo4j.detail = String(e);
    }
    try {
      if (env.OPENAI_API_KEY === 'EMPTY') throw new Error('OPENAI_API_KEY is EMPTY');
      await chat('ping', 'Reply pong only.');
      out.llm.ok = true;
    } catch (e) {
      out.llm.detail = String(e);
    }
    return out;
  });

  app.get('/metrics', async (_, reply) => {
    reply.header('Content-Type', registry.contentType);
    return registry.metrics();
  });
}
