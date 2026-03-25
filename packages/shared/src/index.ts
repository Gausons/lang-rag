export type Fact = {
  subject: string;
  relation: string;
  object: string;
  time?: string;
  polarity?: 'positive' | 'negative' | 'neutral';
  confidence: number;
  evidence_span?: string;
};

export type ChunkMetadata = {
  docId: string;
  source: string;
  page?: number;
  section?: string;
  time: string;
};

export type ChunkRecord = {
  chunkId: string;
  text: string;
  metadata: ChunkMetadata;
};

export type Citation = {
  chunkId: string;
  source: string;
  snippet: string;
};

export type QueryRequest = {
  question: string;
  topK?: number;
  filters?: Record<string, string | number | boolean>;
  sessionId?: string;
};

export type QueryResponse = {
  answer: string;
  citations: Citation[];
  traceId: string;
  cacheHit: 'exact' | 'semantic' | 'miss';
  latencyMs: number;
  sessionId: string;
};

export const RELATION_ALLOWLIST = new Set([
  'belongs_to',
  'depends_on',
  'causes',
  'requires',
  'located_in',
  'owned_by',
  'mentions',
  'part_of',
  'related_to'
]);

export const nowIso = () => new Date().toISOString();

export function canonicalizeEntity(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}
