import type { FastifyInstance } from 'fastify';
import type { QueryRequest, QueryResponse } from '@lang-rag/shared';
import { traceId } from '../lib/trace.js';
import { AppError } from '../lib/errors.js';
import { runRagGraph } from '../graph/orchestrator.js';
import { setExactCache, setSemanticCache, tryExactCache, trySemanticCache } from '../services/cache.js';
import { env } from '../lib/config.js';
import { appendSessionTurn, formatHistoryForPrompt, getSessionTurns } from '../services/session.js';
import { chatDirectReply, detectIntent } from '../services/llm.js';

type RunOptions = {
  onToken?: (token: string) => void;
};

async function runQuery(body: QueryRequest, options?: RunOptions): Promise<QueryResponse> {
  const start = Date.now();
  if (!body.question?.trim()) throw new AppError('INVALID_INPUT', 'question is required', 400);

  const sessionId = body.sessionId?.trim() || `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const requestPayload = { ...body, sessionId };
  const tId = traceId();
  const sessionScope = `session:${sessionId}`;
  const historyTurns = await getSessionTurns(sessionId, env.SESSION_MAX_TURNS);
  const chatHistory = formatHistoryForPrompt(historyTurns);
  const intent = await detectIntent(body.question, chatHistory);

  if (intent === 'chitchat') {
    const answer = await chatDirectReply(body.question, chatHistory, options?.onToken);
    const res: QueryResponse = {
      answer,
      citations: [],
      traceId: tId,
      cacheHit: 'miss',
      latencyMs: Date.now() - start,
      sessionId
    };
    const ts = new Date().toISOString();
    await appendSessionTurn(sessionId, { role: 'user', content: body.question, ts }, env.SESSION_MAX_TURNS);
    await appendSessionTurn(sessionId, { role: 'assistant', content: answer, ts }, env.SESSION_MAX_TURNS);
    return res;
  }

  const exact = await tryExactCache(requestPayload);
  if (exact) {
    const data = exact.data as Omit<QueryResponse, 'traceId' | 'cacheHit' | 'latencyMs' | 'sessionId'>;
    const answer = data.answer;
    if (options?.onToken) {
      for (const ch of answer) options.onToken(ch);
    }
    const res: QueryResponse = {
      ...data,
      traceId: tId,
      cacheHit: 'exact',
      latencyMs: Date.now() - start,
      sessionId
    };
    const ts = new Date().toISOString();
    await appendSessionTurn(sessionId, { role: 'user', content: body.question, ts }, env.SESSION_MAX_TURNS);
    await appendSessionTurn(sessionId, { role: 'assistant', content: answer, ts }, env.SESSION_MAX_TURNS);
    return res;
  }

  const semantic = await trySemanticCache(body.question, 0.92, sessionScope);
  if (semantic.hit) {
    const answer = semantic.data.answer;
    if (options?.onToken) {
      for (const ch of answer) options.onToken(ch);
    }
    const res: QueryResponse = {
      answer,
      citations: semantic.data.citations,
      traceId: tId,
      cacheHit: 'semantic',
      latencyMs: Date.now() - start,
      sessionId
    };
    const ts = new Date().toISOString();
    await appendSessionTurn(sessionId, { role: 'user', content: body.question, ts }, env.SESSION_MAX_TURNS);
    await appendSessionTurn(sessionId, { role: 'assistant', content: answer, ts }, env.SESSION_MAX_TURNS);
    return res;
  }

  const result = await runRagGraph(body.question, body.topK ?? 80, chatHistory, {
    onToken: options?.onToken
  });
  const response: QueryResponse = {
    answer: result.answer,
    citations: result.citations,
    traceId: tId,
    cacheHit: 'miss',
    latencyMs: Date.now() - start,
    sessionId
  };

  await setExactCache(requestPayload, { answer: response.answer, citations: response.citations });
  await setSemanticCache(body.question, response.answer, response.citations, semantic.embedding, sessionScope);
  const ts = new Date().toISOString();
  await appendSessionTurn(sessionId, { role: 'user', content: body.question, ts }, env.SESSION_MAX_TURNS);
  await appendSessionTurn(sessionId, { role: 'assistant', content: response.answer, ts }, env.SESSION_MAX_TURNS);
  return response;
}

function writeSse(raw: NodeJS.WritableStream, event: string, data: unknown) {
  raw.write(`event: ${event}\n`);
  raw.write(`data: ${JSON.stringify(data)}\n\n`);
}

export async function registerQueryRoutes(app: FastifyInstance) {
  app.post('/query', async (req) => {
    const body = (req.body ?? {}) as QueryRequest;
    return runQuery(body);
  });

  app.post('/query/stream', async (req, reply) => {
    const body = (req.body ?? {}) as QueryRequest;
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    });

    try {
      let tokenCount = 0;
      const result = await runQuery(body, {
        onToken: (token) => {
          tokenCount += token.length;
          writeSse(reply.raw, 'token', { token });
        }
      });
      writeSse(reply.raw, 'citations', { citations: result.citations });
      writeSse(reply.raw, 'done', {
        traceId: result.traceId,
        cacheHit: result.cacheHit,
        latencyMs: result.latencyMs,
        sessionId: result.sessionId,
        tokenCount
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      writeSse(reply.raw, 'error', { message });
    } finally {
      reply.raw.end();
    }
    return reply;
  });
}
