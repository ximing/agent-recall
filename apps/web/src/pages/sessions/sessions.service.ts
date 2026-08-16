import type { MemoryPublic, SessionSummaryPublic } from '@agent-recall/dto';
import { Service } from '@rabjs/react';
import { api, errorMessage } from '@/api/client';

export class SessionsService extends Service {
  sessions: SessionSummaryPublic[] = [];
  loading = false;
  error: string | null = null;

  /** 展开的会话及其记忆时间线（升序） */
  activeId: string | null = null;
  activeMemories: MemoryPublic[] = [];
  detailLoading = false;
  private detailSeq = 0;

  async load(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const result = await api.listSessions();
      this.sessions = result.sessions;
    } catch (err) {
      this.error = errorMessage(err, '读取会话失败');
    } finally {
      this.loading = false;
    }
  }

  async toggle(sessionId: string): Promise<void> {
    if (this.activeId === sessionId) {
      this.activeId = null;
      this.activeMemories = [];
      this.detailSeq += 1;
      return;
    }
    this.activeId = sessionId;
    this.activeMemories = [];
    this.detailLoading = true;
    const seq = ++this.detailSeq;
    try {
      const result = await api.getSessionMemories(sessionId);
      if (seq !== this.detailSeq) return;
      this.activeMemories = result.memories;
    } catch (err) {
      if (seq !== this.detailSeq) return;
      this.error = errorMessage(err, '读取会话记忆失败');
    } finally {
      if (seq === this.detailSeq) this.detailLoading = false;
    }
  }
}
