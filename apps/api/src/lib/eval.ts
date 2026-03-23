import { cosine } from '@lang-rag/shared';

export type EvalRow = {
  success: boolean;
  latencyMs: number;
  citations: number;
  ruleScore: number;
  hitAtK: number;
  recallAtK: number;
  category: string;
  faithfulness?: number;
};

export function computeHitRecall(expected: string[] | undefined, got: string[], k: number) {
  if (!expected?.length) return { hitAtK: 0, recallAtK: 0 };
  const top = got.slice(0, k);
  const set = new Set(top);
  const hit = expected.some((x) => set.has(x)) ? 1 : 0;
  const overlap = expected.filter((x) => set.has(x)).length;
  const recall = overlap / expected.length;
  return { hitAtK: hit, recallAtK: recall };
}

export function ruleScore(answer: string, expected?: string) {
  if (!expected) return answer.length > 0 ? 0.5 : 0;
  const a = answer.toLowerCase();
  const b = expected.toLowerCase();
  if (a.includes(b)) return 1;
  const tokensA = a.split(/\s+/).filter(Boolean);
  const tokensB = b.split(/\s+/).filter(Boolean);
  const overlap = tokensB.filter((t) => tokensA.includes(t)).length;
  return tokensB.length ? overlap / tokensB.length : 0;
}

export function aggregate(rows: EvalRow[]) {
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const byCat = new Map<string, EvalRow[]>();
  for (const row of rows) {
    const list = byCat.get(row.category) ?? [];
    list.push(row);
    byCat.set(row.category, list);
  }
  const categoryBreakdown = Object.fromEntries(
    [...byCat.entries()].map(([k, v]) => [
      k,
      {
        success: avg(v.map((x) => (x.success ? 1 : 0))),
        latency: avg(v.map((x) => x.latencyMs)),
        ruleScore: avg(v.map((x) => x.ruleScore)),
        hitAtK: avg(v.map((x) => x.hitAtK)),
        recallAtK: avg(v.map((x) => x.recallAtK))
      }
    ])
  );
  return {
    total: rows.length,
    success: avg(rows.map((x) => (x.success ? 1 : 0))),
    latency: avg(rows.map((x) => x.latencyMs)),
    citations: avg(rows.map((x) => x.citations)),
    ruleScore: avg(rows.map((x) => x.ruleScore)),
    hitAtK: avg(rows.map((x) => x.hitAtK)),
    recallAtK: avg(rows.map((x) => x.recallAtK)),
    faithfulness: avg(rows.map((x) => x.faithfulness ?? 0)),
    categoryBreakdown
  };
}

export function faithfulnessProxy(answerEmbedding: number[], contextEmbedding: number[]) {
  return cosine(answerEmbedding, contextEmbedding);
}
