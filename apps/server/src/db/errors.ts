export function isUniqueViolation(err: unknown): boolean {
  const seen = new Set<unknown>();
  const queue = [err];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    if (typeof current === 'object') {
      const code = (current as { code?: unknown }).code;
      if (code === '23505') return true;
      const cause = (current as { cause?: unknown }).cause;
      if (cause) queue.push(cause);
    }
  }
  const text = err instanceof Error ? err.message : String(err);
  return text.includes('23505') || text.toLowerCase().includes('duplicate key');
}
