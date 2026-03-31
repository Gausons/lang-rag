import fs from 'node:fs/promises';
import path from 'node:path';
import { embedTexts, chat } from '../services/llm.js';
import type { EvalItem } from '../types/index.js';
import { aggregate, computeHitRecall, faithfulnessProxy, ruleScore } from '../lib/eval.js';
import { QuerySupervisor } from '../agents/query-supervisor.js';

const supervisor = new QuerySupervisor();

async function main() {
  const benchmarkPath = path.join(process.cwd(), 'qa-benchmark.jsonl');
  const content = await fs.readFile(benchmarkPath, 'utf-8');
  const items = content
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as EvalItem);

  const rows = [];
  for (const item of items) {
    const start = Date.now();
    const out = await supervisor.run({
      question: item.question,
      topK: 80,
      requestId: `eval_${Date.now()}`
    });
    const latency = Date.now() - start;
    const gotChunkIds = out.citations.map((c) => c.chunkId);
    const topK = computeHitRecall(item.expectedChunkIds, gotChunkIds, 10);
    const rScore = ruleScore(out.answer, item.expectedAnswer);
    let faithfulness = 0;

    if (process.env.EVAL_USE_LLM_JUDGE === 'true') {
      const judge = await chat(
        [
          'Rate answer faithfulness from 0 to 1.',
          `Question: ${item.question}`,
          `Answer: ${out.answer}`,
          `Citations: ${out.citations.map((c) => c.snippet).join(' | ')}`
        ].join('\n'),
        'Output a number only between 0 and 1.'
      );
      const parsed = Number(judge.trim());
      faithfulness = Number.isFinite(parsed) ? parsed : 0;
    } else {
      const [answerEmb] = await embedTexts([out.answer]);
      const [ctxEmb] = await embedTexts([out.citations.map((c) => c.snippet).join('\n') || '']);
      faithfulness = faithfulnessProxy(answerEmb, ctxEmb);
    }

    rows.push({
      success: out.answer.length > 0 && out.citations.length > 0,
      latencyMs: latency,
      citations: out.citations.length,
      ruleScore: rScore,
      hitAtK: topK.hitAtK,
      recallAtK: topK.recallAtK,
      category: item.category ?? 'default',
      faithfulness,
      retries: out.retries,
      agentPath: out.agentPath,
      agentTimings: out.agentTimings,
      rewriteFallbackCount: out.conflictMetrics.rewriteFallbackCount,
      verifierRejectCount: out.conflictMetrics.verifierRejectCount,
      retryTriggered: out.conflictMetrics.retryTriggered,
      retrySucceeded: out.conflictMetrics.retrySucceeded
    });
  }

  const summary = aggregate(rows);
  const resultPath = path.join(process.cwd(), 'eval-result.json');
  await fs.writeFile(resultPath, JSON.stringify({ summary, rows }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
