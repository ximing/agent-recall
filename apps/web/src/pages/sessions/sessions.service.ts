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
  crystallizing = false;
  crystalMessage: string | null = null;
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

  /** 选中一个会话并加载时间线；重复点同一个不收起（主从布局）。 */
  async select(sessionId: string): Promise<void> {
    if (this.activeId === sessionId && !this.detailLoading) return;
    this.activeId = sessionId;
    this.activeMemories = [];
    this.crystalMessage = null;
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

  /** 把这场会话的钩子观察收成一条摘要。同一小时内重复调用不会再写一条。 */
  async crystallize(sessionId: string): Promise<void> {
    this.crystallizing = true;
    this.crystalMessage = null;
    this.error = null;
    try {
      await api.crystallizeSession(sessionId);
      this.crystalMessage = '已写入本小时的会话摘要。';
      await this.load();
      if (this.activeId === sessionId) {
        const timeline = await api.getSessionMemories(sessionId);
        this.activeMemories = timeline.memories;
      }
    } catch (err) {
      this.error = errorMessage(err, '结晶失败');
    } finally {
      this.crystallizing = false;
    }
  }
}
