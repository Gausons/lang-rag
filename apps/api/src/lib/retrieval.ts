import { cosine, tokenize } from '@lang-rag/shared';
import type { RetrievedChunk } from '../types/index.js';

export function rrfFuse(lists: RetrievedChunk[][], k = 60): RetrievedChunk[] {
  const map = new Map<string, RetrievedChunk>();
  lists.forEach((list) => {
    list.forEach((c, rank) => {
      const score = 1 / (k + rank + 1);
      const prev = map.get(c.chunkId);
      if (!prev) {
        map.set(c.chunkId, { ...c, fusedScore: score });
      } else {
        prev.fusedScore = (prev.fusedScore ?? 0) + score;
      }
    });
  });
  return [...map.values()].sort((a, b) => (b.fusedScore ?? 0) - (a.fusedScore ?? 0));
}

export function mmrSelect(items: RetrievedChunk[], queryEmbedding: number[], embeddings: Record<string, number[]>, lambda = 0.75, topN = 8): RetrievedChunk[] {
  const selected: RetrievedChunk[] = [];
  const candidates = [...items];

  while (selected.length < topN && candidates.length) {
    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < candidates.length; i += 1) {
      const cur = candidates[i];
      const curVec = embeddings[cur.chunkId] ?? [];
      const rel = cosine(queryEmbedding, curVec);
      const div = selected.length
        ? Math.max(...selected.map((s) => cosine(curVec, embeddings[s.chunkId] ?? [])))
        : 0;
      const score = lambda * rel - (1 - lambda) * div;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    selected.push(candidates.splice(bestIdx, 1)[0]);
  }

  return selected;
}

export function sparseScore(question: string, text: string): number {
  const qTokens = tokenize(question);
  const tTokens = tokenize(text);
  if (!qTokens.length || !tTokens.length) return 0;
  const tf = new Map<string, number>();
  for (const t of tTokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  let score = 0;
  for (const q of qTokens) {
    const f = tf.get(q) ?? 0;
    if (f) score += 1 + Math.log(f);
  }
  return score / Math.sqrt(tTokens.length);
}
