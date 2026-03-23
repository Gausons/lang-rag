import { describe, expect, it } from 'vitest';
import { planRoute } from './orchestrator.js';

describe('planRoute', () => {
  it('uses broad route for short question', () => {
    expect(planRoute('上线依赖有哪些')).toBe('broad');
  });

  it('uses focused route for long question', () => {
    const q = '请结合上线背景、依赖关系、影响范围、回滚策略详细说明系统升级过程中每个子模块的风险与治理动作';
    expect(planRoute(q)).toBe('focused');
  });
});
