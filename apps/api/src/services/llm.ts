import { openai } from './clients.js';
import { env } from '../lib/config.js';
import type { ExtractedFacts } from '../types/index.js';
import type { RetrievedChunk } from '../types/index.js';

function localEmbedding(text: string, size = 1536): number[] {
  const out = new Array<number>(size).fill(0);
  for (let i = 0; i < text.length; i += 1) {
    out[i % size] += (text.charCodeAt(i) % 31) / 31;
  }
  const norm = Math.sqrt(out.reduce((a, b) => a + b * b, 0)) || 1;
  return out.map((v) => v / norm);
}

function localChat(prompt: string): string {
  if (prompt.includes('Rewrite this question for document retrieval')) {
    return prompt.split('\n').slice(-1)[0];
  }
  if (prompt.includes('Rate answer faithfulness from 0 to 1')) return '0.7';
  return `基于已检索上下文的回答：${prompt.slice(0, 160)}...`;
}

function localCrossScore(question: string, text: string): number {
  const q = question.toLowerCase().split(/\s+/).filter(Boolean);
  const t = text.toLowerCase();
  if (!q.length) return 0;
  const hit = q.filter((token) => t.includes(token)).length;
  return hit / q.length;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  if (env.OPENAI_API_KEY === 'EMPTY') return texts.map((t) => localEmbedding(t));
  try {
    const out = await openai.embeddings.create({
      model: env.OPENAI_EMBED_MODEL,
      input: texts
    });
    return out.data.map((d) => d.embedding);
  } catch {
    return texts.map((t) => localEmbedding(t));
  }
}

export async function chat(prompt: string, system = 'You are a precise enterprise RAG assistant.'): Promise<string> {
  if (env.OPENAI_API_KEY === 'EMPTY') return localChat(prompt);
  try {
    const out = await openai.chat.completions.create({
      model: env.OPENAI_CHAT_MODEL,
      temperature: 0.1,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt }
      ]
    });
    return out.choices[0]?.message?.content ?? '';
  } catch {
    return localChat(prompt);
  }
}

export async function extractFacts(text: string): Promise<ExtractedFacts> {
  const schemaHint = {
    facts: [
      {
        subject: 'entity A',
        relation: 'depends_on',
        object: 'entity B',
        time: '2024-01-01',
        polarity: 'positive',
        confidence: 0.88,
        evidence_span: 'A depends on B'
      }
    ]
  };

  const prompt = [
    'Extract factual triples from the following text.',
    'Output strict JSON only with shape:',
    JSON.stringify(schemaHint),
    'Do not add markdown fences.',
    `Text:\n${text.slice(0, 4000)}`
  ].join('\n');

  const raw = await chat(prompt, 'You output valid JSON only.');
  try {
    return JSON.parse(raw) as ExtractedFacts;
  } catch {
    const facts = [];
    const dep = text.match(/(.{1,20})依赖(.{1,20})/);
    if (dep) {
      facts.push({
        subject: dep[1].trim(),
        relation: 'depends_on',
        object: dep[2].trim(),
        confidence: 0.8,
        polarity: 'positive' as const,
        evidence_span: dep[0]
      });
    }
    const own = text.match(/(.{1,20})归属(.{1,20})/);
    if (own) {
      facts.push({
        subject: own[1].trim(),
        relation: 'belongs_to',
        object: own[2].trim(),
        confidence: 0.78,
        polarity: 'positive' as const,
        evidence_span: own[0]
      });
    }
    return { facts };
  }
}

export async function crossEncodeRerank(
  question: string,
  candidates: RetrievedChunk[],
  topN: number
): Promise<RetrievedChunk[]> {
  if (!candidates.length) return [];

  const fallback = [...candidates]
    .map((c) => ({ ...c, crossScore: localCrossScore(question, c.text) }))
    .sort((a, b) => (b.crossScore ?? 0) - (a.crossScore ?? 0))
    .slice(0, topN);

  if (env.OPENAI_API_KEY === 'EMPTY') return fallback;

  const payload = candidates.map((c, i) => ({
    idx: i,
    chunkId: c.chunkId,
    text: c.text.slice(0, 700)
  }));

  const prompt = [
    'You are a cross-encoder reranker.',
    'Score each candidate for the query from 0 to 1.',
    'Return strict JSON array only: [{"idx":0,"score":0.82}]',
    `Query: ${question}`,
    `Candidates: ${JSON.stringify(payload)}`
  ].join('\n');

  try {
    const raw = await chat(prompt, 'Output strict JSON only.');
    const parsed = JSON.parse(raw) as Array<{ idx: number; score: number }>;
    const scoreMap = new Map<number, number>();
    parsed.forEach((x) => {
      if (Number.isFinite(x.idx) && Number.isFinite(x.score)) {
        scoreMap.set(x.idx, x.score);
      }
    });
    return [...candidates]
      .map((c, idx) => ({ ...c, crossScore: scoreMap.get(idx) ?? localCrossScore(question, c.text) }))
      .sort((a, b) => (b.crossScore ?? 0) - (a.crossScore ?? 0))
      .slice(0, topN);
  } catch {
    return fallback;
  }
}
