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
  retries?: number;
  agentPath?: string[];
  agentTimings?: Record<string, number>;
  rewriteFallbackCount?: number;
  verifierRejectCount?: number;
  retryTriggered?: boolean;
  retrySucceeded?: boolean;
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
  const agentStats = new Map<string, { count: number; latency: number }>();
  for (const row of rows) {
    for (const [agent, latency] of Object.entries(row.agentTimings ?? {})) {
      const prev = agentStats.get(agent) ?? { count: 0, latency: 0 };
      agentStats.set(agent, { count: prev.count + 1, latency: prev.latency + latency });
    }
  }
  const agentBreakdown = Object.fromEntries(
    [...agentStats.entries()].map(([agent, stat]) => [
      agent,
      { avgLatency: stat.latency / Math.max(1, stat.count), coverage: stat.count / Math.max(1, rows.length) }
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
    retries: avg(rows.map((x) => x.retries ?? 0)),
    conflictRates: {
      rewriteFallbackRate: avg(rows.map((x) => ((x.rewriteFallbackCount ?? 0) > 0 ? 1 : 0))),
      verifierRejectRate: avg(rows.map((x) => ((x.verifierRejectCount ?? 0) > 0 ? 1 : 0))),
      retryTriggeredRate: avg(rows.map((x) => (x.retryTriggered ? 1 : 0))),
      retrySuccessRate: avg(rows.map((x) => (x.retrySucceeded ? 1 : 0)))
    },
    categoryBreakdown,
    agentBreakdown
  };
}

export function faithfulnessProxy(answerEmbedding: number[], contextEmbedding: number[]) {
  return cosine(answerEmbedding, contextEmbedding);
}
