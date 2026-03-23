import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import type { Citation } from '@lang-rag/shared';
import { env } from '../lib/config.js';
import { mmrSelect } from '../lib/retrieval.js';
import type { QueryTrace, RetrievedChunk } from '../types/index.js';
import { chat, crossEncodeRerank } from '../services/llm.js';
import { loadEmbeddings, retrieveHybrid } from '../services/retrieve.js';

const RagState = Annotation.Root({
  question: Annotation<string>(),
  chatHistory: Annotation<string | undefined>(),
  rewrittenQuestion: Annotation<string | undefined>(),
  route: Annotation<'broad' | 'focused'>(),
  recallK: Annotation<number>(),
  finalK: Annotation<number>(),
  queryEmbedding: Annotation<number[]>(),
  retrieved: Annotation<RetrievedChunk[]>(),
  context: Annotation<RetrievedChunk[]>(),
  answer: Annotation<string>(),
  citations: Annotation<Citation[]>(),
  retries: Annotation<number>(),
  done: Annotation<boolean>()
});

export function planRoute(question: string): 'broad' | 'focused' {
  return question.length > 30 ? 'focused' : 'broad';
}

export async function runRagGraph(question: string, topK = 80, chatHistory?: string) {
  const planner = async (state: typeof RagState.State) => {
    const route = planRoute(state.question);
    return {
      ...state,
      route,
      recallK: Math.max(env.RECALL_POOL_MIN, Math.min(env.RECALL_POOL_MAX, topK)),
      finalK: route === 'broad' ? env.FINAL_CONTEXT_MAX : env.FINAL_CONTEXT_MIN,
      retries: state.retries ?? 0
    };
  };

  const retrieve = async (state: typeof RagState.State) => {
    const baseQ = state.rewrittenQuestion ?? state.question;
    const q = state.chatHistory
      ? `Conversation history:\n${state.chatHistory}\n\nCurrent question:\n${baseQ}`
      : baseQ;
    const results = await retrieveHybrid(q, state.recallK);
    return {
      ...state,
      retrieved: results.fused,
      queryEmbedding: results.queryEmbedding
    };
  };

  const rerank = async (state: typeof RagState.State) => {
    const candidateIds = state.retrieved.map((x) => x.chunkId);
    const embMap = await loadEmbeddings(candidateIds);
    const mmrPoolSize = Math.max(
      state.finalK,
      Math.min(state.retrieved.length, state.finalK * env.CROSS_ENCODER_POOL_MULTIPLIER)
    );
    const mmrSelected = mmrSelect(state.retrieved, state.queryEmbedding, embMap, 0.75, mmrPoolSize);
    const selected = env.CROSS_ENCODER_ENABLED
      ? await crossEncodeRerank(state.rewrittenQuestion ?? state.question, mmrSelected, state.finalK)
      : mmrSelected.slice(0, state.finalK);
    return {
      ...state,
      context: selected
    };
  };

  const generate = async (state: typeof RagState.State) => {
    const ctx = state.context
      .map((c, i) => `[${i + 1}](${c.chunkId}) ${c.text.slice(0, 1200)}`)
      .join('\n');
    const prompt = [
      'Answer the question using only provided context.',
      'If uncertain, say what is missing.',
      'Return concise answer in Chinese.',
      state.chatHistory ? `Conversation history:\n${state.chatHistory}` : '',
      `Question: ${state.rewrittenQuestion ?? state.question}`,
      `Context:\n${ctx}`
    ]
      .filter(Boolean)
      .join('\n\n');
    const answer = await chat(prompt);
    const citations = state.context.map((c) => ({
      chunkId: c.chunkId,
      source: c.metadata.source,
      snippet: c.text.slice(0, 180)
    }));
    return {
      ...state,
      answer,
      citations
    };
  };

  const selfCheck = async (state: typeof RagState.State) => {
    const shouldRetry =
      (!state.citations.length || state.answer.toLowerCase().includes('missing')) &&
      (state.retries ?? 0) < 1;
    return {
      ...state,
      done: !shouldRetry
    };
  };

  const rewrite = async (state: typeof RagState.State) => {
    const rewritten = await chat(
      [
        'Rewrite this question for document retrieval, keep same intent.',
        state.chatHistory ? `Conversation history:\n${state.chatHistory}` : '',
        `Current question:\n${state.question}`
      ]
        .filter(Boolean)
        .join('\n\n'),
      'Output one rewritten query sentence only.'
    );
    return {
      ...state,
      rewrittenQuestion: rewritten.trim(),
      retries: (state.retries ?? 0) + 1
    };
  };

  const workflow = new StateGraph(RagState)
    .addNode('planner', planner)
    .addNode('retrieve', retrieve)
    .addNode('rerank', rerank)
    .addNode('generate', generate)
    .addNode('selfCheck', selfCheck)
    .addNode('rewrite', rewrite)
    .addEdge(START, 'planner')
    .addEdge('planner', 'retrieve')
    .addEdge('retrieve', 'rerank')
    .addEdge('rerank', 'generate')
    .addEdge('generate', 'selfCheck')
    .addConditionalEdges('selfCheck', (state) => (state.done ? 'end' : 'rewrite'), {
      rewrite: 'rewrite',
      end: END
    })
    .addEdge('rewrite', 'retrieve')
    .compile();

  const finalState = await workflow.invoke({
    question,
    chatHistory,
    route: 'broad',
    recallK: topK,
    finalK: env.FINAL_CONTEXT_MAX,
    queryEmbedding: [],
    retrieved: [],
    context: [],
    answer: '',
    citations: [],
    retries: 0,
    done: false
  });

  const trace: QueryTrace = {
    plannerRoute: finalState.route,
    retrieved: finalState.retrieved.length,
    reranked: finalState.context.length,
    retries: finalState.retries
  };

  return {
    answer: finalState.answer,
    citations: finalState.citations,
    trace
  };
}
