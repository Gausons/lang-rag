import { describe, expect, it } from 'vitest';
import { mmrSelect, rrfFuse } from './retrieval.js';
import type { RetrievedChunk } from '../types/index.js';

function chunk(id: string): RetrievedChunk {
  return {
    chunkId: id,
    text: id,
    metadata: { docId: 'd', source: 's', time: new Date().toISOString() }
  };
}

describe('rrfFuse', () => {
  it('should merge by chunkId and rank by fused score', () => {
    const out = rrfFuse(
      [
        [chunk('a'), chunk('b')],
        [chunk('b'), chunk('c')]
      ],
      10
    );
    expect(out[0].chunkId).toBe('b');
    expect(out.map((x) => x.chunkId)).toContain('a');
    expect(out.map((x) => x.chunkId)).toContain('c');
  });
});

describe('mmrSelect', () => {
  it('should keep relevance while reducing redundancy', () => {
    const items = [chunk('a'), chunk('b'), chunk('c')];
    const emb = {
      a: [1, 0, 0],
      b: [0.9, 0.1, 0],
      c: [0, 1, 0]
    };
    const out = mmrSelect(items, [1, 0, 0], emb, 0.7, 2);
    expect(out.length).toBe(2);
    expect(out[0].chunkId).toBe('a');
    expect(out[1].chunkId).not.toBe('a');
  });
});
