/** Reciprocal rank fusion. Rank is 1-based. k defaults to 60. Ties keep first-seen order. */
export const RRF_K = 60;

export function rrfMerge(lists: string[][], k = RRF_K): string[] {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, index) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + index + 1));
    });
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}
