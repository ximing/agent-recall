import type { LongMemQuestion } from './longmemeval.js';

/** 与 agentmemory eval/runner/adapters/grep.ts 相同：小写英文词，丢掉长度不超过 2 的词。 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, ' ')
    .split(/\s+/)
    .filter((term) => term.length > 2);
}

export function rankGrep(question: LongMemQuestion, limit: number): string[] {
  const terms = tokenize(question.question);
  const scored: Array<{ id: string; score: number }> = [];
  for (const session of question.sessions) {
    const body = session.content.toLowerCase();
    let hits = 0;
    for (const term of terms) {
      if (body.includes(term)) hits += 1;
    }
    if (hits > 0) scored.push({ id: session.id, score: hits });
  }
  scored.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
  return scored.slice(0, limit).map((row) => row.id);
}
