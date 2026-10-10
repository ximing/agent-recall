import type { JudgeLabel } from './types.js';

/** 前 K 个里出现任一金标即记 1。金标为空返回 null。与 agentmemory benchmark/longmemeval-bench.ts 的 recallAny 一致。 */
export function recallAny(ranked: readonly string[], gold: readonly string[], k: number): number | null {
  if (gold.length === 0) return null;
  const top = new Set(ranked.slice(0, k));
  return gold.some((id) => top.has(id)) ? 1 : 0;
}

function dcg(hits: readonly boolean[], k: number): number {
  let sum = 0;
  const n = Math.min(k, hits.length);
  for (let i = 0; i < n; i += 1) sum += (hits[i] ? 1 : 0) / Math.log2(i + 2);
  return sum;
}

/** 二值 nDCG。理想列表是 min(k, 金标数) 个命中。 */
export function ndcgAt(ranked: readonly string[], gold: readonly string[], k: number): number | null {
  if (gold.length === 0) return null;
  const wanted = new Set(gold);
  const hits = ranked.slice(0, k).map((id) => wanted.has(id));
  const ideal = dcg(Array.from({ length: Math.min(k, wanted.size) }, () => true), k);
  if (ideal === 0) return 0;
  return dcg(hits, k) / ideal;
}

export function recallAt(ranked: readonly string[], gold: readonly string[], k: number): number | null {
  if (gold.length === 0) return null;
  const top = new Set(ranked.slice(0, k));
  const hits = gold.filter((id) => top.has(id)).length;
  return hits / gold.length;
}

export function reciprocalRank(ranked: readonly string[], gold: readonly string[]): number | null {
  if (gold.length === 0) return null;
  const wanted = new Set(gold);
  const index = ranked.findIndex((id) => wanted.has(id));
  return index < 0 ? 0 : 1 / (index + 1);
}

export function snippetCoverage(context: string, snippets: readonly string[]): number | null {
  if (snippets.length === 0) return null;
  const hits = snippets.filter((snippet) => snippet.length > 0 && context.includes(snippet)).length;
  return hits / snippets.length;
}

export function isFalseInjection(ranked: readonly string[], abstain: boolean): boolean | null {
  if (!abstain) return null;
  return ranked.length > 0;
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** 最近秩百分位。p 取 50 或 95。 */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))] ?? null;
}

export function bootstrapInterval(values: readonly number[], iterations = 1000, seed = 20261010): [number, number] | null {
  if (values.length === 0) return null;
  const means: number[] = [];
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  for (let i = 0; i < iterations; i += 1) {
    let sum = 0;
    for (let j = 0; j < values.length; j += 1) sum += values[Math.floor(next() * values.length)] ?? 0;
    means.push(sum / values.length);
  }
  means.sort((a, b) => a - b);
  const lo = means[Math.floor(0.025 * (means.length - 1))] ?? means[0];
  const hi = means[Math.ceil(0.975 * (means.length - 1))] ?? means[means.length - 1];
  if (lo === undefined || hi === undefined) return null;
  return [lo, hi];
}

export function judgeScore(label: JudgeLabel | null, strict: boolean): number | null {
  if (label === null) return null;
  if (label === 'correct') return 1;
  if (label === 'wrong') return 0;
  return strict ? 0 : 0.5;
}

export function assertScoreFixtures(): void {
  if (recallAny(['a', 'b'], ['b', 'c'], 1) !== 0) throw new Error('recall_any fixture failed');
  if (recallAny(['a', 'b'], ['b', 'c'], 2) !== 1) throw new Error('recall_any fixture failed');
  if (recallAny(['a'], [], 5) !== null) throw new Error('recall_any abstain fixture failed');
  const perfect = ndcgAt(['a', 'b'], ['a', 'b'], 2);
  if (perfect === null || Math.abs(perfect - 1) > 1e-9) throw new Error('ndcg fixture failed');
  if (recallAt(['a', 'b'], ['b'], 5) !== 1) throw new Error('recall fixture failed');
  if (recallAt(['a'], ['a', 'b'], 5) !== 0.5) throw new Error('recall fixture failed');
  if (recallAt(['a'], [], 5) !== null) throw new Error('abstain recall fixture failed');
  if (reciprocalRank(['x', 'a'], ['a']) !== 0.5) throw new Error('mrr fixture failed');
  if (snippetCoverage('hello ferry-blobs', ['ferry-blobs']) !== 1) throw new Error('coverage fixture failed');
  if (isFalseInjection(['a'], true) !== true) throw new Error('false injection fixture failed');
  if (isFalseInjection([], true) !== false) throw new Error('false injection fixture failed');
  const interval = bootstrapInterval([1, 0, 1, 1], 200, 1);
  if (!interval || interval[0] > interval[1]) throw new Error('bootstrap fixture failed');
}
