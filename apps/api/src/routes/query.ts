import type { FastifyInstance } from 'fastify';
import type { QueryRequest, QueryResponse } from '@lang-rag/shared';
import { traceId } from '../lib/trace.js';
import { AppError } from '../lib/errors.js';
import { setExactCache, setSemanticCache, tryExactCache, trySemanticCache } from '../services/cache.js';
import { env } from '../lib/config.js';
import { appendSessionTurn, formatHistoryForPrompt, getSessionTurns } from '../services/session.js';
import { QuerySupervisor } from '../agents/query-supervisor.js';
import type { AgentEvent } from '../agents/types.js';

type RunOptions = {
  onToken?: (token: string) => void;
  onAgentEvent?: (event: AgentEvent) => void;
  onDebug?: (message: string, meta?: Record<string, unknown>) => void;
};

const supervisor = new QuerySupervisor();

function traceEnabled() {
  return env.AGENT_TRACE_VERBOSE && env.AGENT_TRACE_LEVEL !== 'off';
}

function traceFull() {
  return traceEnabled() && env.AGENT_TRACE_LEVEL === 'full';
}

async function runQuery(body: QueryRequest, options?: RunOptions): Promise<QueryResponse> {
  const start = Date.now();
  if (!body.question?.trim()) throw new AppError('INVALID_INPUT', 'question is required', 400);

  const sessionId = body.sessionId?.trim() || `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const requestPayload = { ...body, sessionId };
  const tId = traceId();
  const sessionScope = `session:${sessionId}`;
  const historyTurns = await getSessionTurns(sessionId, env.SESSION_MAX_TURNS);
  const chatHistory = formatHistoryForPrompt(historyTurns);
  options?.onDebug?.('query-start', {
    sessionId,
    topK: body.topK ?? 80,
    hasHistory: historyTurns.length > 0
  });

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
    options?.onDebug?.('query-cache-hit', { type: 'exact', sessionId });
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
      sessionId,
      agentPath: ['IntentRouterAgent']
    };
    const ts = new Date().toISOString();
    await appendSessionTurn(sessionId, { role: 'user', content: body.question, ts }, env.SESSION_MAX_TURNS);
    await appendSessionTurn(sessionId, { role: 'assistant', content: answer, ts }, env.SESSION_MAX_TURNS);
    options?.onDebug?.('query-cache-hit', { type: 'semantic', sessionId });
    return res;
  }

  const result = await supervisor.run({
    question: body.question,
    topK: body.topK ?? 80,
    chatHistory,
    requestId: tId,
    onToken: options?.onToken,
    onAgentEvent: options?.onAgentEvent,
    onDebug: options?.onDebug
  });
  const response: QueryResponse = {
    answer: result.answer,
    citations: result.citations,
    traceId: tId,
    cacheHit: 'miss',
    latencyMs: Date.now() - start,
    sessionId,
    agentPath: result.agentPath,
    retryReason: result.retryReason
  };

  await setExactCache(requestPayload, { answer: response.answer, citations: response.citations });
  await setSemanticCache(body.question, response.answer, response.citations, semantic.embedding, sessionScope);
  const ts = new Date().toISOString();
  await appendSessionTurn(sessionId, { role: 'user', content: body.question, ts }, env.SESSION_MAX_TURNS);
  await appendSessionTurn(sessionId, { role: 'assistant', content: response.answer, ts }, env.SESSION_MAX_TURNS);
  options?.onDebug?.('query-finish', {
    sessionId,
    agentPath: response.agentPath,
    retries: result.retries,
    retryReason: result.retryReason,
    conflictMetrics: result.conflictMetrics
  });
  return response;
}

function writeSse(raw: NodeJS.WritableStream, event: string, data: unknown) {
  raw.write(`event: ${event}\n`);
  raw.write(`data: ${JSON.stringify(data)}\n\n`);
}

export async function registerQueryRoutes(app: FastifyInstance) {
  app.post('/query', async (req) => {
    const body = (req.body ?? {}) as QueryRequest;
    const enabled = traceEnabled();
    const full = traceFull();
    return runQuery(body, {
      onDebug: enabled
        ? (message, meta) =>
            req.log.info(
              {
                tag: 'agent',
                traceLevel: env.AGENT_TRACE_LEVEL,
                message,
                ...meta
              },
              'agent-trace'
            )
        : undefined,
      onAgentEvent: full
        ? (event) =>
            req.log.info(
              {
                tag: 'agent',
                traceLevel: env.AGENT_TRACE_LEVEL,
                event
              },
              'agent-event'
            )
        : undefined
    });
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
        },
        onAgentEvent: (event) => {
          writeSse(reply.raw, 'agent', event);
          if (traceFull()) {
            app.log.info({ tag: 'agent', stream: true, traceLevel: env.AGENT_TRACE_LEVEL, event }, 'agent-event');
          }
        },
        onDebug: traceEnabled()
          ? (message, meta) =>
              app.log.info(
                {
                  tag: 'agent',
                  stream: true,
                  traceLevel: env.AGENT_TRACE_LEVEL,
                  message,
                  ...meta
                },
                'agent-trace'
              )
          : undefined
      });
      writeSse(reply.raw, 'citations', { citations: result.citations });
      writeSse(reply.raw, 'done', {
        traceId: result.traceId,
        cacheHit: result.cacheHit,
        latencyMs: result.latencyMs,
        sessionId: result.sessionId,
        tokenCount,
        agentPath: result.agentPath,
        retryReason: result.retryReason
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
