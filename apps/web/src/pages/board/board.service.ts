import type {
  DiagnoseResult,
  KvEntryPublic,
  MemoryPublic,
  MemoryStats,
  RecallLogPublic,
  SessionSummaryPublic,
  ShareInvitePublic,
} from '@agent-recall/dto';
import { Service } from '@rabjs/react';
import { api, errorMessage } from '@/api/client';

const SLICE_COUNT = 7;

export class BoardService extends Service {
  loading = false;
  error: string | null = null;
  stats: MemoryStats | null = null;
  actions: KvEntryPublic[] | null = null;
  sessions: SessionSummaryPublic[] | null = null;
  memories: MemoryPublic[] | null = null;
  logs: RecallLogPublic[] | null = null;
  invites: ShareInvitePublic[] | null = null;
  diagnose: DiagnoseResult | null = null;

  private seq = 0;

  async load(): Promise<void> {
    const seq = ++this.seq;
    this.loading = true;
    this.error = null;
    const [stats, actions, sessions, memories, logs, invites, diagnose] = await Promise.allSettled([
      api.getMemoryStats(),
      api.listKv('actions'),
      api.listSessions(),
      api.listMemories({ limit: 5 }),
      api.listRecallLogs(),
      api.incomingShares(),
      api.diagnose(),
    ]);
    if (seq !== this.seq) return;

    const failed: Array<{ label: string; reason: unknown }> = [];
    const take = <T>(result: PromiseSettledResult<T>, label: string): T | null => {
      if (result.status === 'fulfilled') return result.value;
      failed.push({ label, reason: result.reason });
      return null;
    };

    const statsBody = take(stats, '统计');
    const actionsBody = take(actions, '行动');
    const sessionsBody = take(sessions, '会话');
    const memoriesBody = take(memories, '记忆');
    const logsBody = take(logs, '召回');
    const invitesBody = take(invites, '分享');
    const diagnoseBody = take(diagnose, '库况');

    this.stats = statsBody?.stats ?? null;
    this.actions = actionsBody?.entries ?? null;
    this.sessions = sessionsBody?.sessions ?? null;
    this.memories = memoriesBody?.memories ?? null;
    this.logs = logsBody?.logs ?? null;
    this.invites = invitesBody?.invites ?? null;
    this.diagnose = diagnoseBody;
    this.error =
      failed.length === 0
        ? null
        : failed.length === SLICE_COUNT
          ? errorMessage(failed[0]?.reason, '读取看板失败')
          : `没有读到${failed.map((item) => item.label).join('、')}。`;
    this.loading = false;
  }
}
