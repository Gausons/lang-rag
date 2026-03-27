import { openai } from './clients.js';
import { env } from '../lib/config.js';
import type { ExtractedFacts } from '../types/index.js';
import type { RetrievedChunk } from '../types/index.js';

export type QueryIntent = 'chitchat' | 'knowledge';

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

function localIntent(question: string): QueryIntent {
  const q = question.trim().toLowerCase();
  const patterns = [
    /你好|hi|hello|早上好|晚上好|在吗/,
    /你是谁|你能做什么|介绍一下你自己/,
    /谢谢|多谢|辛苦了/,
    /讲个笑话|聊聊|随便聊聊|心情/,
    /今天天气|吃什么|晚饭|午饭/
  ];
  const isChitchat = patterns.some((p) => p.test(q));
  return isChitchat ? 'chitchat' : 'knowledge';
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

export async function chatStream(
  prompt: string,
  onToken: (token: string) => void,
  system = 'You are a precise enterprise RAG assistant.'
): Promise<string> {
  if (env.OPENAI_API_KEY === 'EMPTY') {
    const text = localChat(prompt);
    for (const ch of text) onToken(ch);
    return text;
  }
  try {
    const stream = await openai.chat.completions.create({
      model: env.OPENAI_CHAT_MODEL,
      temperature: 0.1,
      stream: true,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt }
      ]
    });
    let full = '';
    for await (const part of stream) {
      const token = part.choices?.[0]?.delta?.content ?? '';
      if (!token) continue;
      full += token;
      onToken(token);
    }
    return full;
  } catch {
    const text = localChat(prompt);
    for (const ch of text) onToken(ch);
    return text;
  }
}

export async function detectIntent(question: string, chatHistory?: string): Promise<QueryIntent> {
  const fallback = localIntent(question);
  if (env.OPENAI_API_KEY === 'EMPTY') return fallback;
  try {
    const prompt = [
      'Classify user intent into one label only: chitchat or knowledge.',
      'chitchat = social/small talk without needing document retrieval.',
      'knowledge = asks facts/tasks that likely need enterprise document grounding.',
      chatHistory ? `Conversation history:\n${chatHistory}` : '',
      `User question:\n${question}`,
      'Output only one word: chitchat or knowledge.'
    ]
      .filter(Boolean)
      .join('\n\n');
    const out = (await chat(prompt, 'You are an intent classifier.')).trim().toLowerCase();
    if (out.includes('chitchat')) return 'chitchat';
    if (out.includes('knowledge')) return 'knowledge';
    return fallback;
  } catch {
    return fallback;
  }
}

export async function chatDirectReply(
  question: string,
  chatHistory?: string,
  onToken?: (token: string) => void
): Promise<string> {
  const prompt = [
    'User is doing small talk. Reply naturally in Chinese, concise and friendly.',
    chatHistory ? `Conversation history:\n${chatHistory}` : '',
    `User:\n${question}`
  ]
    .filter(Boolean)
    .join('\n\n');
  return onToken ? chatStream(prompt, onToken) : chat(prompt);
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
