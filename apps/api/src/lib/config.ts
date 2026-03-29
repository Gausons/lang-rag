import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(3001),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  OPENAI_API_KEY: z.string().default('EMPTY'),
  OPENAI_BASE_URL: z.string().default('https://api.openai.com/v1'),
  OPENAI_CHAT_MODEL: z.string().default('gpt-4o-mini'),
  OPENAI_EMBED_MODEL: z.string().default('text-embedding-3-small'),
  AGENT_ROUTER_MODEL: z.string().default('gpt-4o-mini'),
  AGENT_REWRITE_MODEL: z.string().default('gpt-4o-mini'),
  AGENT_RERANK_MODEL: z.string().default('gpt-4o-mini'),
  AGENT_VERIFY_MODEL: z.string().default('gpt-4o-mini'),
  AGENT_MAX_RETRY: z.coerce.number().default(1),
  AGENT_TRACE_LEVEL: z.enum(['off', 'basic', 'full']).default('basic'),
  AGENT_TRACE_VERBOSE: z
    .string()
    .default('true')
    .transform((v) => v.toLowerCase() !== 'false'),
  QDRANT_URL: z.string().default('http://localhost:6333'),
  QDRANT_COLLECTION: z.string().default('rag_chunks'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  NEO4J_URI: z.string().default('bolt://localhost:7687'),
  NEO4J_USER: z.string().default('neo4j'),
  NEO4J_PASSWORD: z.string().default('password'),
  DATA_DIR: z.string().default('./data'),
  FACT_CONFIDENCE_THRESHOLD: z.coerce.number().default(0.55),
  RECALL_POOL_MIN: z.coerce.number().default(60),
  RECALL_POOL_MAX: z.coerce.number().default(120),
  FINAL_CONTEXT_MIN: z.coerce.number().default(6),
  FINAL_CONTEXT_MAX: z.coerce.number().default(12),
  CROSS_ENCODER_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v.toLowerCase() !== 'false'),
  CROSS_ENCODER_POOL_MULTIPLIER: z.coerce.number().default(2),
  SESSION_MAX_TURNS: z.coerce.number().default(6)
});

export const env = schema.parse(process.env);
