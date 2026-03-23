import type { ChunkRecord, Fact } from '@lang-rag/shared';

export type RetrievedChunk = ChunkRecord & {
  denseScore?: number;
  sparseScore?: number;
  graphScore?: number;
  fusedScore?: number;
  crossScore?: number;
};

export type GraphBuildJob = {
  id: string;
  status: 'queued' | 'running' | 'success' | 'failed';
  createdAt: string;
  updatedAt: string;
  error?: string;
  processedChunks?: number;
};

export type EvalItem = {
  question: string;
  expectedAnswer?: string;
  expectedChunkIds?: string[];
  category?: string;
};

export type QueryTrace = {
  plannerRoute: 'broad' | 'focused';
  retrieved: number;
  reranked: number;
  retries: number;
};

export type ExtractedFacts = {
  facts: Fact[];
};
