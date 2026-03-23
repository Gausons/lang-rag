import { QdrantClient } from '@qdrant/js-client-rest';
import { Redis } from 'ioredis';
import neo4j from 'neo4j-driver';
import OpenAI from 'openai';
import { env } from '../lib/config.js';

export const redis = new Redis(env.REDIS_URL, { lazyConnect: true });

export const qdrant = new QdrantClient({ url: env.QDRANT_URL });

export const neo4jDriver = neo4j.driver(
  env.NEO4J_URI,
  neo4j.auth.basic(env.NEO4J_USER, env.NEO4J_PASSWORD),
  { disableLosslessIntegers: true, userAgent: 'lang-rag' }
);

export const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
  baseURL: env.OPENAI_BASE_URL
});
