import type { Citation } from '@lang-rag/shared';
import type { RetrievedChunk } from '../types/index.js';

export type AgentName =
  | 'IntentRouterAgent'
  | 'QueryRewriteAgent'
  | 'RetrievalAgent'
  | 'RerankAgent'
  | 'SynthesisAgent'
  | 'VerifierAgent'
  | 'ChitchatAgent';

export type AgentEvent = {
  name: AgentName;
  status: 'start' | 'end';
  latencyMs?: number;
  meta?: Record<string, unknown>;
};

export type AgentContext = {
  question: string;
  topK: number;
  chatHistory?: string;
  requestId: string;
  onToken?: (token: string) => void;
  onAgentEvent?: (event: AgentEvent) => void;
  onDebug?: (message: string, meta?: Record<string, unknown>) => void;
};

export type AgentState = {
  intent?: 'chitchat' | 'knowledge';
  rewrittenQuestion?: string;
  queryEmbedding?: number[];
  retrieved: RetrievedChunk[];
  context: RetrievedChunk[];
  answer: string;
  citations: Citation[];
  retryCount: number;
  retryReason?: string;
  verified?: boolean;
  verifyReason?: string;
  agentPath: AgentName[];
  stateVersion: number;
  lastUpdatedBy?: AgentName;
  rewriteFallbackCount: number;
  verifierRejectCount: number;
  retryTriggered: boolean;
  retrySucceeded: boolean;
};

export type AgentResult = {
  answer: string;
  citations: Citation[];
  agentPath: AgentName[];
  retryReason?: string;
  retries: number;
  agentTimings: Record<AgentName, number>;
  conflictMetrics: {
    rewriteFallbackCount: number;
    verifierRejectCount: number;
    retryTriggered: boolean;
    retrySucceeded: boolean;
  };
};

export interface AgentNode {
  name: AgentName;
  invoke(state: AgentState, ctx: AgentContext): Promise<AgentState>;
}
