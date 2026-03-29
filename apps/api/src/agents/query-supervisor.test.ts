import { describe, expect, it } from 'vitest';
import { QuerySupervisor, shouldRetry } from './query-supervisor.js';
import { env } from '../lib/config.js';

describe('query supervisor', () => {
  it('should follow chitchat path without retrieval', async () => {
    const prev = env.OPENAI_API_KEY;
    (env as { OPENAI_API_KEY: string }).OPENAI_API_KEY = 'EMPTY';
    try {
      const supervisor = new QuerySupervisor();
      const out = await supervisor.run({
        question: '你好呀',
        topK: 80,
        requestId: 'test_1'
      });
      expect(out.answer.length).toBeGreaterThan(0);
      expect(out.citations.length).toBe(0);
      expect(out.agentPath).toContain('IntentRouterAgent');
      expect(out.agentPath).toContain('ChitchatAgent');
    } finally {
      (env as { OPENAI_API_KEY: string }).OPENAI_API_KEY = prev;
    }
  });

  it('should enforce retry upper bound', () => {
    expect(shouldRetry(false, 0)).toBe(true);
    expect(shouldRetry(false, env.AGENT_MAX_RETRY)).toBe(false);
    expect(shouldRetry(true, 0)).toBe(false);
  });
});
