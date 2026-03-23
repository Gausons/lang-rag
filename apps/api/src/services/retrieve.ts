import type { ChunkRecord } from '@lang-rag/shared';
import type { RetrievedChunk } from '../types/index.js';
import { env } from '../lib/config.js';
import { rrfFuse, sparseScore } from '../lib/retrieval.js';
import { redis } from './clients.js';
import { graphRetrieve } from './graph.js';
import { searchDense } from './indexing.js';
import { loadChunks } from './store.js';

export async function findChunkByIds(ids: string[]): Promise<ChunkRecord[]> {
  const idSet = new Set(ids);
  const chunks = await loadChunks();
  return chunks.filter((c) => idSet.has(c.chunkId));
}

export async function retrieveHybrid(question: string, topK = 80) {
  const recallK = Math.max(env.RECALL_POOL_MIN, Math.min(env.RECALL_POOL_MAX, topK));
  const allChunks = await loadChunks();

  const dense = await searchDense(question, recallK);
  const denseList: RetrievedChunk[] = dense.hits
    .map((h) => {
      const payload = h.payload as Record<string, unknown>;
      return {
        chunkId: String(payload?.chunkId ?? h.id),
        text: String(payload?.text ?? ''),
        metadata: {
          docId: String(payload?.docId ?? ''),
          source: String(payload?.source ?? ''),
          page: payload?.page ? Number(payload.page) : undefined,
          section: payload?.section ? String(payload.section) : undefined,
          time: String(payload?.time ?? '')
        },
        denseScore: Number(h.score ?? 0)
      };
    })
    .filter((x) => x.text);

  const sparseList: RetrievedChunk[] = allChunks
    .map((c) => ({ ...c, sparseScore: sparseScore(question, c.text) }))
    .filter((c) => (c.sparseScore ?? 0) > 0)
    .sort((a, b) => (b.sparseScore ?? 0) - (a.sparseScore ?? 0))
    .slice(0, recallK);

  const graphHits = await graphRetrieve(question, recallK);
  const graphMap = new Map(graphHits.map((g) => [g.chunkId, g.score]));
  const graphChunks = await findChunkByIds(graphHits.map((x) => x.chunkId));
  const graphList: RetrievedChunk[] = graphChunks.map((c) => ({
    ...c,
    graphScore: graphMap.get(c.chunkId) ?? 0
  }));

  const fused = rrfFuse([denseList, sparseList, graphList], 60).slice(0, recallK);
  return {
    queryEmbedding: dense.embedding,
    dense: denseList,
    sparse: sparseList,
    graph: graphList,
    fused
  };
}

export async function loadEmbeddings(chunkIds: string[]): Promise<Record<string, number[]>> {
  const out: Record<string, number[]> = {};
  for (const id of chunkIds) {
    const raw = await redis.get(`rag:chunk:emb:${id}`);
    if (raw) out[id] = JSON.parse(raw) as number[];
  }
  return out;
}
