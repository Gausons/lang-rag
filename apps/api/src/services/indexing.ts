import type { ChunkRecord } from '@lang-rag/shared';
import { env } from '../lib/config.js';
import { qdrant } from './clients.js';
import { embedTexts } from './llm.js';

const vectorSize = 1536;
let ensured = false;

function pointId(chunkId: string): number {
  let hash = 0;
  for (let i = 0; i < chunkId.length; i += 1) {
    hash = (hash * 31 + chunkId.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export async function ensureQdrant() {
  if (ensured) return;
  const collections = await qdrant.getCollections();
  const exists = collections.collections.some((c) => c.name === env.QDRANT_COLLECTION);
  if (!exists) {
    await qdrant.createCollection(env.QDRANT_COLLECTION, {
      vectors: { size: vectorSize, distance: 'Cosine' }
    });
  }
  ensured = true;
}

export async function upsertDense(chunks: ChunkRecord[]): Promise<Record<string, number[]>> {
  await ensureQdrant();
  if (!chunks.length) return {};
  const embeddings = await embedTexts(chunks.map((c) => c.text));
  await qdrant.upsert(env.QDRANT_COLLECTION, {
    wait: true,
    points: chunks.map((c, i) => ({
      id: pointId(c.chunkId),
      vector: embeddings[i],
      payload: {
        chunkId: c.chunkId,
        text: c.text,
        ...c.metadata
      }
    }))
  });
  return Object.fromEntries(chunks.map((c, i) => [c.chunkId, embeddings[i]]));
}

export async function searchDense(question: string, limit: number) {
  await ensureQdrant();
  const [q] = await embedTexts([question]);
  const hits = await qdrant.search(env.QDRANT_COLLECTION, {
    vector: q,
    limit,
    with_payload: true,
    with_vector: false
  });
  return { embedding: q, hits };
}
