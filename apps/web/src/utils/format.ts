export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 过期判定：expiresAt 已过当前时间 */
export function isExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  const time = new Date(expiresAt).getTime();
  return !Number.isNaN(time) && time < Date.now();
}

/** ISO 字符串 → input[type=date] 的 yyyy-MM-dd（本地时区） */
export function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  return formatDate(iso);
}

/** input[type=date] 的 yyyy-MM-dd → ISO（本地当天 23:59:59）；空串 → null */
export function fromDateInputValue(value: string): string | null {
  if (!value) return null;
  const date = new Date(`${value}T23:59:59`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export type DiffLine = { kind: 'same' | 'add' | 'del'; text: string };

/**
 * 行级 LCS diff：新增行 kind='add'，删除行 kind='del'，未变行 kind='same'。
 * 行数乘积过大时退化为「整段删除 + 整段新增」，避免 O(n*m) 爆内存。
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.length ? before.split('\n') : [];
  const b = after.length ? after.split('\n') : [];
  if (a.length === 0 && b.length === 0) return [];
  if (a.length === 0) return b.map((text) => ({ kind: 'add' as const, text }));
  if (b.length === 0) return a.map((text) => ({ kind: 'del' as const, text }));
  if (a.length * b.length > 250_000) {
    return [...a.map((text) => ({ kind: 'del' as const, text })), ...b.map((text) => ({ kind: 'add' as const, text }))];
  }

  const m = a.length;
  const n = b.length;
  const width = n + 1;
  // dp[i][j] = a[i:] 与 b[j:] 的 LCS 长度，压平成一维
  const dp = new Uint32Array((m + 1) * width);
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      dp[i * width + j] =
        a[i] === b[j]
          ? dp[(i + 1) * width + j + 1] + 1
          : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
    }
  }

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      lines.push({ kind: 'same', text: a[i] });
      i += 1;
      j += 1;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
      lines.push({ kind: 'del', text: a[i] });
      i += 1;
    } else {
      lines.push({ kind: 'add', text: b[j] });
      j += 1;
    }
  }
  while (i < m) {
    lines.push({ kind: 'del', text: a[i] });
    i += 1;
  }
  while (j < n) {
    lines.push({ kind: 'add', text: b[j] });
    j += 1;
  }
  return lines;
}
