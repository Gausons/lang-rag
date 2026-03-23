import { describe, expect, it } from 'vitest';
import { formatHistoryForPrompt } from './session.js';

describe('session history formatting', () => {
  it('formats turns with role labels', () => {
    const out = formatHistoryForPrompt([
      { role: 'user', content: '第一问', ts: '2026-01-01T00:00:00Z' },
      { role: 'assistant', content: '第一答', ts: '2026-01-01T00:00:01Z' }
    ]);
    expect(out).toContain('User: 第一问');
    expect(out).toContain('Assistant: 第一答');
  });

  it('returns empty string for empty turns', () => {
    expect(formatHistoryForPrompt([])).toBe('');
  });
});
