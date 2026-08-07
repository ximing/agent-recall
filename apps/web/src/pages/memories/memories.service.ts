import type { MemoryPublic, Origin } from '@agent-recall/dto';
import { Service } from '@rabjs/react';
import { api, errorMessage } from '@/api/client';

export const ORIGIN_LABEL: Record<Origin, string> = {
  web: '网页',
  agent: '代理',
  hook: '钩子',
};

export class MemoriesService extends Service {
  memories: MemoryPublic[] = [];
  draft = '';
  editingId: string | null = null;
  editDraft = '';
  pendingDeleteId: string | null = null;
  error: string | null = null;

  setDraft(value: string): void {
    this.draft = value;
  }

  setEditDraft(value: string): void {
    this.editDraft = value;
  }

  startEdit(memory: MemoryPublic): void {
    this.editingId = memory.id;
    this.editDraft = memory.content;
    this.pendingDeleteId = null;
  }

  cancelEdit(): void {
    this.editingId = null;
    this.editDraft = '';
  }

  askDelete(id: string): void {
    this.pendingDeleteId = id;
    this.editingId = null;
  }

  cancelDelete(): void {
    this.pendingDeleteId = null;
  }

  async load(): Promise<void> {
    this.error = null;
    try {
      const result = await api.listMemories();
      this.memories = result.memories;
    } catch (err) {
      this.error = errorMessage(err, '读取记忆失败');
    }
  }

  async create(): Promise<void> {
    this.error = null;
    const content = this.draft.trim();
    if (!content) {
      this.error = '请填写记忆内容';
      return;
    }
    try {
      await api.createMemory(content);
      this.draft = '';
      await this.load();
    } catch (err) {
      this.error = errorMessage(err, '保存记忆失败');
    }
  }

  async saveEdit(): Promise<void> {
    if (!this.editingId) return;
    this.error = null;
    const content = this.editDraft.trim();
    if (!content) {
      this.error = '记忆内容不能为空';
      return;
    }
    try {
      await api.updateMemory(this.editingId, content);
      this.editingId = null;
      this.editDraft = '';
      await this.load();
    } catch (err) {
      this.error = errorMessage(err, '更新记忆失败');
    }
  }

  async confirmDelete(): Promise<void> {
    if (!this.pendingDeleteId) return;
    this.error = null;
    try {
      await api.deleteMemory(this.pendingDeleteId);
      this.pendingDeleteId = null;
      await this.load();
    } catch (err) {
      this.error = errorMessage(err, '删除记忆失败');
    }
  }
}
