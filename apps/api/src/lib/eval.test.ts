import { describe, expect, it } from 'vitest';
import { aggregate, computeHitRecall, ruleScore } from './eval.js';

describe('eval metrics', () => {
  it('computes hit/recall', () => {
    const out = computeHitRecall(['a', 'b'], ['x', 'b'], 2);
    expect(out.hitAtK).toBe(1);
    expect(out.recallAtK).toBe(0.5);
  });

  it('scores answer overlap', () => {
    expect(ruleScore('系统依赖缓存和数据库', '依赖缓存')).toBeGreaterThan(0.4);
  });

  it('aggregates with category breakdown', () => {
    const out = aggregate([
      {
        success: true,
        latencyMs: 10,
        citations: 2,
        ruleScore: 1,
        hitAtK: 1,
        recallAtK: 1,
        category: 'a',
        rewriteFallbackCount: 1,
        verifierRejectCount: 0,
        retryTriggered: true,
        retrySucceeded: true
      },
      {
        success: false,
        latencyMs: 30,
        citations: 1,
        ruleScore: 0,
        hitAtK: 0,
        recallAtK: 0,
        category: 'b',
        rewriteFallbackCount: 0,
        verifierRejectCount: 1,
        retryTriggered: false,
        retrySucceeded: false
      }
    ]);
    expect(out.categoryBreakdown.a).toBeTruthy();
    expect(out.hitAtK).toBe(0.5);
    expect(out.conflictRates.retryTriggeredRate).toBe(0.5);
  });
});
