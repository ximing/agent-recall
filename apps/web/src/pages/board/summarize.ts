import type { KvEntryPublic, MemoryType, Origin, RecallLogPublic, SessionSummaryPublic } from '@agent-recall/dto';

export interface ActionView {
  key: string;
  title: string;
  detail: string | null;
  status: 'open' | 'blocked';
}

export interface ActionSummary {
  open: number;
  blocked: number;
  done: number;
  shown: ActionView[];
  rest: number;
}

export interface RecallSummary {
  total: number;
  /** 精排实际生效的比例，四舍五入到整数。与设置页召回历史同一算法。 */
  rerankRate: number;
  avgLatency: number;
  rerankFailed: number;
  recent: Array<{
    id: string;
    query: string;
    latencyMs: number;
    resultCount: number;
    rerankFailed: boolean;
  }>;
}

export interface MixRow {
  key: string;
  label: string;
  count: number;
  /** 相对最大值的百分比。有数据时至少留出一段可见的长度。 */
  width: number;
}

export interface ProjectRollup {
  name: string;
  sessions: number;
  lastAt: string;
}

const SHOWN_ACTIONS = 8;

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

/** 进行中与受阻排在前面，受阻优先。已完成只计数。 */
export function summarizeActions(entries: KvEntryPublic[]): ActionSummary {
  const open: ActionView[] = [];
  const blocked: ActionView[] = [];
  let done = 0;
  for (const entry of entries) {
    const value = recordOf(entry.value);
    const status = value.status;
    if (status === 'done') {
      done += 1;
      continue;
    }
    if (status !== 'open' && status !== 'blocked') continue;
    const item: ActionView = {
      key: entry.key,
      title: textOf(value.title) ?? entry.key,
      detail: textOf(value.detail),
      status,
    };
    if (status === 'blocked') blocked.push(item);
    else open.push(item);
  }
  const ranked = [...blocked, ...open];
  return {
    open: open.length,
    blocked: blocked.length,
    done,
    shown: ranked.slice(0, SHOWN_ACTIONS),
    rest: Math.max(ranked.length - SHOWN_ACTIONS, 0),
  };
}

/** 召回日志接口最多返回 50 条。比例和平均延迟与设置页一致。 */
export function summarizeRecall(logs: RecallLogPublic[]): RecallSummary {
  const total = logs.length;
  if (total === 0) {
    return { total: 0, rerankRate: 0, avgLatency: 0, rerankFailed: 0, recent: [] };
  }
  const rerankApplied = logs.filter((log) => log.rerankApplied).length;
  const rerankFailed = logs.filter((log) => log.rerankError !== null).length;
  const latency = logs.reduce((sum, log) => sum + log.latencyMs, 0);
  return {
    total,
    rerankRate: Math.round((rerankApplied / total) * 100),
    avgLatency: Math.round(latency / total),
    rerankFailed,
    recent: logs.slice(0, 5).map((log) => ({
      id: log.id,
      query: log.query,
      latencyMs: log.latencyMs,
      resultCount: log.resultCount,
      rerankFailed: log.rerankError !== null,
    })),
  };
}

export function mixRows(
  counts: Record<string, number>,
  order: readonly string[],
  labelOf: (key: string) => string,
): MixRow[] {
  const extras = Object.keys(counts).filter((key) => !order.includes(key));
  const rows = [...order, ...extras].map((key) => ({
    key,
    label: labelOf(key),
    count: counts[key] ?? 0,
  }));
  const max = Math.max(1, ...rows.map((row) => row.count));
  return rows.map((row) => ({
    ...row,
    width: row.count === 0 ? 0 : Math.max((row.count / max) * 100, 3),
  }));
}

/** 按会话出现次数汇总项目。一场会话跨多个项目时，每个项目各计一场。 */
export function rollupProjects(sessions: SessionSummaryPublic[], limit = 6): ProjectRollup[] {
  const map = new Map<string, ProjectRollup>();
  for (const session of sessions) {
    for (const name of session.projects) {
      const current = map.get(name);
      if (!current) {
        map.set(name, { name, sessions: 1, lastAt: session.lastAt });
        continue;
      }
      current.sessions += 1;
      if (Date.parse(session.lastAt) > Date.parse(current.lastAt)) current.lastAt = session.lastAt;
    }
  }
  return [...map.values()]
    .sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt) || b.sessions - a.sessions)
    .slice(0, limit);
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value);
}

export function typeLabel(key: string, labels: Record<MemoryType, string>): string {
  return key in labels ? labels[key as MemoryType] : key;
}

export function originLabel(key: string, labels: Record<Origin, string>): string {
  return key in labels ? labels[key as Origin] : key;
}
