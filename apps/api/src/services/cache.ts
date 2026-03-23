import crypto from 'node:crypto';
import { cosine } from '@lang-rag/shared';
import { redis } from './clients.js';
import { embedTexts } from './llm.js';

const EXACT_PREFIX = 'rag:exact:';
const SEM_PREFIX = 'rag:sem:';

type CachedQuery = {
  key: string;
  embedding: number[];
  response: string;
  citations: { chunkId: string; source: string; snippet: string }[];
};

type SemanticCacheHit = {
  hit: true;
  key: string;
  score: number;
  data: {
    answer: string;
    citations: { chunkId: string; source: string; snippet: string }[];
  };
  embedding: number[];
};

type SemanticCacheMiss = {
  hit: false;
  embedding: number[];
};

function hashInput(v: string) {
  return crypto.createHash('sha256').update(v).digest('hex');
}

function scopeToken(scopeKey?: string) {
  return hashInput(scopeKey ?? 'global').slice(0, 16);
}

export async function tryExactCache(payload: unknown) {
  const key = `${EXACT_PREFIX}${hashInput(JSON.stringify(payload))}`;
  const raw = await redis.get(key);
  return raw ? { key, data: JSON.parse(raw) } : null;
}

export async function setExactCache(payload: unknown, data: unknown, ttl = 3600) {
  const key = `${EXACT_PREFIX}${hashInput(JSON.stringify(payload))}`;
  await redis.set(key, JSON.stringify(data), 'EX', ttl);
}

export async function trySemanticCache(
  question: string,
  threshold = 0.92,
  scopeKey?: string
): Promise<SemanticCacheHit | SemanticCacheMiss> {
  const [queryEmbedding] = await embedTexts([question]);
  const scope = scopeToken(scopeKey);
  const keys = await redis.keys(`${SEM_PREFIX}${scope}:*`);
  let best: { score: number; item: CachedQuery } | null = null;

  for (const key of keys.slice(0, 200)) {
    const raw = await redis.get(key);
    if (!raw) continue;
    const item = JSON.parse(raw) as CachedQuery;
    const score = cosine(queryEmbedding, item.embedding);
    if (!best || score > best.score) best = { score, item };
  }

  if (best && best.score >= threshold) {
    return {
      hit: true,
      key: best.item.key,
      score: best.score,
      data: {
        answer: best.item.response,
        citations: best.item.citations
      },
      embedding: queryEmbedding
    } satisfies SemanticCacheHit;
  }

  return { hit: false, embedding: queryEmbedding } satisfies SemanticCacheMiss;
}

export async function setSemanticCache(
  question: string,
  response: string,
  citations: CachedQuery['citations'],
  embedding?: number[],
  scopeKey?: string
) {
  const emb = embedding ?? (await embedTexts([question]))[0];
  const key = `${SEM_PREFIX}${scopeToken(scopeKey)}:${hashInput(question)}`;
  const item: CachedQuery = { key, embedding: emb, response, citations };
  await redis.set(key, JSON.stringify(item), 'EX', 3600);
}
