import type { FastifyInstance } from 'fastify';
import type { QueryRequest, QueryResponse } from '@lang-rag/shared';
import { traceId } from '../lib/trace.js';
import { AppError } from '../lib/errors.js';
import { runRagGraph } from '../graph/orchestrator.js';
import { setExactCache, setSemanticCache, tryExactCache, trySemanticCache } from '../services/cache.js';
import { env } from '../lib/config.js';
import { appendSessionTurn, formatHistoryForPrompt, getSessionTurns } from '../services/session.js';

export async function registerQueryRoutes(app: FastifyInstance) {
  app.post('/query', async (req) => {
    const start = Date.now();
    const body = (req.body ?? {}) as QueryRequest;
    if (!body.question?.trim()) throw new AppError('INVALID_INPUT', 'question is required', 400);
    const tId = traceId();
    const sessionScope = body.sessionId ? `session:${body.sessionId}` : 'global';
    const historyTurns = body.sessionId ? await getSessionTurns(body.sessionId, env.SESSION_MAX_TURNS) : [];
    const chatHistory = formatHistoryForPrompt(historyTurns);

    const exact = await tryExactCache(body);
    if (exact) {
      const data = exact.data as Omit<QueryResponse, 'traceId' | 'cacheHit' | 'latencyMs'>;
      const res = {
        ...data,
        traceId: tId,
        cacheHit: 'exact',
        latencyMs: Date.now() - start
      } satisfies QueryResponse;
      if (body.sessionId) {
        const ts = new Date().toISOString();
        await appendSessionTurn(body.sessionId, { role: 'user', content: body.question, ts }, env.SESSION_MAX_TURNS);
        await appendSessionTurn(body.sessionId, { role: 'assistant', content: res.answer, ts }, env.SESSION_MAX_TURNS);
      }
      return res;
    }

    const semantic = await trySemanticCache(body.question, 0.92, sessionScope);
    if (semantic.hit) {
      const res = {
        answer: semantic.data.answer,
        citations: semantic.data.citations,
        traceId: tId,
        cacheHit: 'semantic',
        latencyMs: Date.now() - start
      } satisfies QueryResponse;
      if (body.sessionId) {
        const ts = new Date().toISOString();
        await appendSessionTurn(body.sessionId, { role: 'user', content: body.question, ts }, env.SESSION_MAX_TURNS);
        await appendSessionTurn(body.sessionId, { role: 'assistant', content: res.answer, ts }, env.SESSION_MAX_TURNS);
      }
      return res;
    }

    const result = await runRagGraph(body.question, body.topK ?? 80, chatHistory);
    const response: QueryResponse = {
      answer: result.answer,
      citations: result.citations,
      traceId: tId,
      cacheHit: 'miss',
      latencyMs: Date.now() - start
    };

    await setExactCache(body, { answer: response.answer, citations: response.citations });
    await setSemanticCache(body.question, response.answer, response.citations, semantic.embedding, sessionScope);
    if (body.sessionId) {
      const ts = new Date().toISOString();
      await appendSessionTurn(
        body.sessionId,
        { role: 'user', content: body.question, ts },
        env.SESSION_MAX_TURNS
      );
      await appendSessionTurn(
        body.sessionId,
        { role: 'assistant', content: response.answer, ts },
        env.SESSION_MAX_TURNS
      );
    }
    return response;
  });
}
