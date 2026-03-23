import type { ChunkMetadata, ChunkRecord } from '@lang-rag/shared';

export function semanticChunk(text: string, baseMeta: Omit<ChunkMetadata, 'time'> & { time?: string }, maxChars = 1000, overlap = 150): ChunkRecord[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  const sentences = normalized.split(/(?<=[。！？.!?])\s+|\n{2,}/g).filter(Boolean);
  const out: ChunkRecord[] = [];
  let cur = '';
  let idx = 0;

  for (const s of sentences) {
    const next = cur ? `${cur} ${s}` : s;
    if (next.length > maxChars && cur) {
      out.push({
        chunkId: `${baseMeta.docId}::${idx}`,
        text: cur,
        metadata: { ...baseMeta, time: baseMeta.time ?? new Date().toISOString() }
      });
      idx += 1;
      cur = `${cur.slice(-overlap)} ${s}`.trim();
    } else {
      cur = next;
    }
  }

  if (cur) {
    out.push({
      chunkId: `${baseMeta.docId}::${idx}`,
      text: cur,
      metadata: { ...baseMeta, time: baseMeta.time ?? new Date().toISOString() }
    });
  }
  return out;
}
