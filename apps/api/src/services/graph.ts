import { RELATION_ALLOWLIST, canonicalizeEntity } from '@lang-rag/shared';
import type { Fact } from '@lang-rag/shared';
import neo4j from 'neo4j-driver';
import { neo4jDriver } from './clients.js';
import { env } from '../lib/config.js';

export function normalizeFact(f: Fact): Fact | null {
  const relation = canonicalizeEntity(f.relation).replace(/\s+/g, '_');
  const subject = canonicalizeEntity(f.subject);
  const object = canonicalizeEntity(f.object);
  const confidence = Number(f.confidence ?? 0);
  if (!subject || !object) return null;
  if (!RELATION_ALLOWLIST.has(relation)) return null;
  if (confidence < env.FACT_CONFIDENCE_THRESHOLD) return null;
  return {
    ...f,
    subject,
    object,
    relation,
    confidence
  };
}

export async function writeFacts(docId: string, chunkId: string, facts: Fact[]) {
  const normalized = facts.map(normalizeFact).filter(Boolean) as Fact[];
  if (!normalized.length) return { written: 0 };
  const session = neo4jDriver.session();

  try {
    await session.run(
      `UNWIND $rows AS row
       MERGE (s:Entity {name: row.subject})
       MERGE (o:Entity {name: row.object})
       MERGE (s)-[r:REL {relation: row.relation, docId: row.docId, chunkId: row.chunkId, evidence: row.evidence_span}]->(o)
       SET r.time = row.time, r.polarity = row.polarity, r.confidence = row.confidence`,
      {
        rows: normalized.map((f) => ({
          ...f,
          docId,
          chunkId
        }))
      }
    );
    return { written: normalized.length };
  } finally {
    await session.close();
  }
}

export async function graphRetrieve(question: string, limit: number) {
  const terms = question
    .toLowerCase()
    .split(/\s+/)
    .filter((x) => x.length > 2)
    .slice(0, 6);
  if (!terms.length) return [];

  const session = neo4jDriver.session();
  try {
    const out = await session.run(
      `MATCH (s:Entity)-[r:REL]->(o:Entity)
       WHERE any(t IN $terms WHERE s.name CONTAINS t OR o.name CONTAINS t)
       RETURN r.chunkId AS chunkId, max(r.confidence) AS score
       ORDER BY score DESC LIMIT $limit`,
      { terms, limit: neo4j.int(limit) }
    );
    return out.records.map((r) => ({
      chunkId: r.get('chunkId') as string,
      score: Number(r.get('score') ?? 0)
    }));
  } finally {
    await session.close();
  }
}

export async function graphMetrics() {
  const nodeSession = neo4jDriver.session();
  const edgeSession = neo4jDriver.session();
  try {
    const [nodeR, edgeR] = await Promise.all([
      nodeSession.run('MATCH (n:Entity) RETURN count(n) AS c'),
      edgeSession.run('MATCH ()-[r:REL]->() RETURN count(r) AS c')
    ]);
    return {
      nodes: Number(nodeR.records[0]?.get('c') ?? 0),
      edges: Number(edgeR.records[0]?.get('c') ?? 0)
    };
  } finally {
    await nodeSession.close();
    await edgeSession.close();
  }
}
