import { describe, expect, it } from 'vitest';
import { RRF_K, rrfMerge } from './rrf.js';

describe('rrfMerge', () => {
  it('uses k=60 so a double mid-rank beats a single top rank', () => {
    expect(RRF_K).toBe(60);
    const lexicalPads = Array.from({ length: 28 }, (_, index) => `lex-${String(index)}`);
    const vectorPads = Array.from({ length: 29 }, (_, index) => `vec-${String(index)}`);
    const lexical = ['only-top', ...lexicalPads, 'double-mid'];
    const vector = [...vectorPads, 'double-mid'];
    expect(rrfMerge([lexical, vector], 60)[0]).toBe('double-mid');
    expect(rrfMerge([lexical, vector], 10)[0]).toBe('only-top');
    expect(rrfMerge([['a'], ['b']], 60)).toEqual(['a', 'b']);
  });
});
