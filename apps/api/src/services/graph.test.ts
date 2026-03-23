import { describe, expect, it } from 'vitest';
import { normalizeFact } from './graph.js';

describe('normalizeFact', () => {
  it('filters low confidence and invalid relation', () => {
    expect(
      normalizeFact({
        subject: 'A',
        relation: 'unknown relation',
        object: 'B',
        confidence: 0.9
      })
    ).toBeNull();
  });

  it('canonicalizes and keeps valid fact', () => {
    const out = normalizeFact({
      subject: ' Team A ',
      relation: 'depends on',
      object: ' Service B ',
      confidence: 0.95
    });
    expect(out?.subject).toBe('team a');
    expect(out?.relation).toBe('depends_on');
    expect(out?.object).toBe('service b');
  });
});
