import { env } from '../lib/config.js';
import { mmrSelect } from '../lib/retrieval.js';
import { chat, chatDirectReply, chatStream, crossEncodeRerank, detectIntent } from '../services/llm.js';
import { loadEmbeddings, retrieveHybrid } from '../services/retrieve.js';
import type { AgentContext, AgentNode, AgentResult, AgentState, AgentName } from './types.js';

function baseState(): AgentState {
  return {
    retrieved: [],
    context: [],
    answer: '',
    citations: [],
    retryCount: 0,
    agentPath: []
  };
}

async function invokeAgent(
  agent: AgentNode,
  state: AgentState,
  ctx: AgentContext,
  timings: Record<AgentName, number>
): Promise<AgentState> {
  ctx.onAgentEvent?.({
    name: agent.name,
    status: 'start',
    meta: {
      retrieved: state.retrieved.length,
      context: state.context.length,
      retries: state.retryCount
    }
  });
  const start = Date.now();
  const next = await agent.invoke(state, ctx);
  const latency = Date.now() - start;
  timings[agent.name] = (timings[agent.name] ?? 0) + latency;
  ctx.onAgentEvent?.({
    name: agent.name,
    status: 'end',
    latencyMs: latency,
    meta: {
      retrieved: next.retrieved.length,
      context: next.context.length,
      citations: next.citations.length,
      retries: next.retryCount,
      verifyReason: next.verifyReason
    }
  });
  return {
    ...next,
    agentPath: [...next.agentPath, agent.name]
  };
}

class IntentRouterAgent implements AgentNode {
  name: AgentName = 'IntentRouterAgent';

  async invoke(state: AgentState, ctx: AgentContext): Promise<AgentState> {
    const intent = await detectIntent(ctx.question, ctx.chatHistory, env.AGENT_ROUTER_MODEL);
    return { ...state, intent };
  }
}

class QueryRewriteAgent implements AgentNode {
  name: AgentName = 'QueryRewriteAgent';

  async invoke(state: AgentState, ctx: AgentContext): Promise<AgentState> {
    const rewritten = await chat(
      [
        'Rewrite this question for enterprise document retrieval while preserving intent.',
        ctx.chatHistory ? `Conversation history:\n${ctx.chatHistory}` : '',
        `Current question:\n${ctx.question}`
      ]
        .filter(Boolean)
        .join('\n\n'),
      'Output one rewritten query sentence only.',
      env.AGENT_REWRITE_MODEL
    );
    return { ...state, rewrittenQuestion: rewritten.trim() || ctx.question };
  }
}

class RetrievalAgent implements AgentNode {
  name: AgentName = 'RetrievalAgent';

  async invoke(state: AgentState, ctx: AgentContext): Promise<AgentState> {
    const query = state.rewrittenQuestion || ctx.question;
    const out = await retrieveHybrid(query, ctx.topK);
    return { ...state, retrieved: out.fused, queryEmbedding: out.queryEmbedding };
  }
}

class RerankAgent implements AgentNode {
  name: AgentName = 'RerankAgent';

  async invoke(state: AgentState): Promise<AgentState> {
    const embMap = await loadEmbeddings(state.retrieved.map((x) => x.chunkId));
    const finalK =
      (state.intent ?? 'knowledge') === 'knowledge' ? env.FINAL_CONTEXT_MAX : env.FINAL_CONTEXT_MIN;
    const mmrPoolSize = Math.max(
      finalK,
      Math.min(state.retrieved.length, finalK * env.CROSS_ENCODER_POOL_MULTIPLIER)
    );
    const mmrSelected = mmrSelect(state.retrieved, state.queryEmbedding ?? [], embMap, 0.75, mmrPoolSize);
    const selected = env.CROSS_ENCODER_ENABLED
      ? await crossEncodeRerank(state.rewrittenQuestion ?? '', mmrSelected, finalK)
      : mmrSelected.slice(0, finalK);
    return { ...state, context: selected };
  }
}

class SynthesisAgent implements AgentNode {
  name: AgentName = 'SynthesisAgent';

  async invoke(state: AgentState, ctx: AgentContext): Promise<AgentState> {
    const contextText = state.context
      .map((c, i) => `[${i + 1}](${c.chunkId}) ${c.text.slice(0, 1200)}`)
      .join('\n');
    const prompt = [
      'Answer the question using only provided context.',
      'If uncertain, explicitly mention missing evidence.',
      'Return concise answer in Chinese.',
      ctx.chatHistory ? `Conversation history:\n${ctx.chatHistory}` : '',
      `Question: ${state.rewrittenQuestion ?? ctx.question}`,
      `Context:\n${contextText}`
    ]
      .filter(Boolean)
      .join('\n\n');
    const answer = ctx.onToken
      ? await chatStream(prompt, ctx.onToken, undefined, env.OPENAI_CHAT_MODEL)
      : await chat(prompt);
    const citations = state.context.map((c) => ({
      chunkId: c.chunkId,
      source: c.metadata.source,
      snippet: c.text.slice(0, 180)
    }));
    return { ...state, answer, citations };
  }
}

function heuristicVerify(answer: string, citationsCount: number) {
  if (!answer.trim()) return { pass: false, reason: 'empty answer' };
  if (citationsCount < 1) return { pass: false, reason: 'no citations' };
  if (answer.toLowerCase().includes('missing')) return { pass: false, reason: 'model says missing evidence' };
  return { pass: true, reason: '' };
}

class VerifierAgent implements AgentNode {
  name: AgentName = 'VerifierAgent';

  async invoke(state: AgentState): Promise<AgentState> {
    const fallback = heuristicVerify(state.answer, state.citations.length);
    if (env.OPENAI_API_KEY === 'EMPTY') {
      return { ...state, verified: fallback.pass, verifyReason: fallback.reason };
    }
    try {
      const prompt = [
        'Verify whether the answer is grounded by citations.',
        'Output strict JSON only: {"pass": true|false, "reason": "text"}',
        `Answer: ${state.answer}`,
        `Citations: ${state.citations.map((c) => `${c.chunkId}:${c.snippet}`).join(' | ')}`
      ].join('\n');
      const raw = await chat(prompt, 'You are a strict verifier.', env.AGENT_VERIFY_MODEL);
      const parsed = JSON.parse(raw) as { pass?: boolean; reason?: string };
      if (typeof parsed.pass === 'boolean') {
        return { ...state, verified: parsed.pass, verifyReason: parsed.reason ?? '' };
      }
      return { ...state, verified: fallback.pass, verifyReason: fallback.reason };
    } catch {
      return { ...state, verified: fallback.pass, verifyReason: fallback.reason };
    }
  }
}

class ChitchatAgent implements AgentNode {
  name: AgentName = 'ChitchatAgent';

  async invoke(state: AgentState, ctx: AgentContext): Promise<AgentState> {
    const answer = await chatDirectReply(ctx.question, ctx.chatHistory, ctx.onToken, env.OPENAI_CHAT_MODEL);
    return { ...state, answer, citations: [] };
  }
}

export class QuerySupervisor {
  private readonly router = new IntentRouterAgent();
  private readonly rewrite = new QueryRewriteAgent();
  private readonly retrieval = new RetrievalAgent();
  private readonly rerank = new RerankAgent();
  private readonly synthesis = new SynthesisAgent();
  private readonly verifier = new VerifierAgent();
  private readonly chitchat = new ChitchatAgent();

  async run(ctx: AgentContext): Promise<AgentResult> {
    const timings = {} as Record<AgentName, number>;
    let state = baseState();
    ctx.onDebug?.('multi-agent-start', {
      requestId: ctx.requestId,
      topK: ctx.topK,
      hasHistory: Boolean(ctx.chatHistory),
      questionLen: ctx.question.length
    });

    state = await invokeAgent(this.router, state, ctx, timings);
    ctx.onDebug?.('intent-routed', { intent: state.intent });

    if (state.intent === 'chitchat') {
      state = await invokeAgent(this.chitchat, state, ctx, timings);
      ctx.onDebug?.('multi-agent-finish', {
        path: state.agentPath,
        retries: 0,
        citations: 0
      });
      return {
        answer: state.answer,
        citations: [],
        retries: 0,
        agentPath: state.agentPath,
        agentTimings: timings
      };
    }

    const runKnowledgeRound = async () => {
      state = await invokeAgent(this.rewrite, state, ctx, timings);
      state = await invokeAgent(this.retrieval, state, ctx, timings);
      state = await invokeAgent(this.rerank, state, ctx, timings);
      state = await invokeAgent(this.synthesis, state, ctx, timings);
      state = await invokeAgent(this.verifier, state, ctx, timings);
    };

    await runKnowledgeRound();

    if (shouldRetry(state.verified, state.retryCount)) {
      ctx.onDebug?.('verification-retry', {
        reason: state.verifyReason || 'verification failed',
        retryCount: state.retryCount + 1
      });
      state = {
        ...state,
        retryCount: state.retryCount + 1,
        retryReason: state.verifyReason || 'verification failed'
      };
      await runKnowledgeRound();
    }

    ctx.onDebug?.('multi-agent-finish', {
      path: state.agentPath,
      retries: state.retryCount,
      citations: state.citations.length,
      verified: state.verified
    });

    return {
      answer: state.answer,
      citations: state.citations,
      retries: state.retryCount,
      retryReason: state.retryReason,
      agentPath: state.agentPath,
      agentTimings: timings
    };
  }
}

export function shouldRetry(verified: boolean | undefined, retryCount: number) {
  return !verified && retryCount < env.AGENT_MAX_RETRY;
}
