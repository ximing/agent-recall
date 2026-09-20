import type {
  AuditEntryPublic,
  ConsolidateResult,
  DiagnoseResult,
  ImportStrategy,
  MemoryPublic,
  ShareInvitePublic,
  SnapshotPublic,
} from '@agent-recall/dto';
import { Service } from '@rabjs/react';
import { api, errorMessage } from '@/api/client';

export class OpsService extends Service {
  error: string | null = null;

  diagnose: DiagnoseResult | null = null;
  healArmed = false;
  healNote: string | null = null;

  consolidatePreview: ConsolidateResult | null = null;
  consolidateNote: string | null = null;

  reflectDays = '7';
  reflectProject = '';
  reflectNote: string | null = null;

  snapshotNote = '';
  snapshots: SnapshotPublic[] = [];
  snapshotMessage: string | null = null;
  restoreId: string | null = null;
  restoreStrategy: ImportStrategy = 'skip';

  audit: AuditEntryPublic[] = [];
  invites: ShareInvitePublic[] = [];
  feed: MemoryPublic[] = [];

  peerUrl = 'http://127.0.0.1:8787';
  peerToken = '';
  meshStrategy: ImportStrategy = 'skip';
  meshNote: string | null = null;

  assign(partial: Partial<OpsService>): void {
    Object.assign(this, partial);
  }

  async load(): Promise<void> {
    this.error = null;
    await Promise.all([this.loadDiagnose(), this.loadSnapshots(), this.loadAudit(), this.loadFeed()]);
  }

  async loadDiagnose(): Promise<void> {
    try {
      this.diagnose = await api.diagnose();
    } catch (err) {
      this.error = errorMessage(err, '诊断失败');
    }
  }

  armHeal(): void {
    this.healArmed = true;
    this.healNote = null;
  }

  cancelHeal(): void {
    this.healArmed = false;
  }

  async confirmHeal(): Promise<void> {
    this.error = null;
    try {
      const result = await api.heal();
      this.healArmed = false;
      this.healNote = `已重新索引 ${result.reindexed} 条，清除 ${result.autoForget.deleted} 条。`;
      await this.loadDiagnose();
      await this.loadAudit();
    } catch (err) {
      this.error = errorMessage(err, '自愈失败');
    }
  }

  async previewConsolidate(): Promise<void> {
    this.error = null;
    this.consolidateNote = null;
    try {
      this.consolidatePreview = await api.consolidate(true);
    } catch (err) {
      this.error = errorMessage(err, '预览合并失败');
    }
  }

  cancelConsolidate(): void {
    this.consolidatePreview = null;
  }

  async confirmConsolidate(): Promise<void> {
    this.error = null;
    try {
      const result = await api.consolidate(false);
      this.consolidatePreview = null;
      this.consolidateNote = `合并了 ${result.merged} 条重复链，共 ${result.groups} 组。`;
      await this.loadAudit();
    } catch (err) {
      this.error = errorMessage(err, '合并失败');
    }
  }

  async reflect(): Promise<void> {
    const days = Number.parseInt(this.reflectDays, 10);
    if (!Number.isFinite(days) || days < 1 || days > 90) {
      this.error = '反思天数要在 1 到 90 之间';
      return;
    }
    this.error = null;
    try {
      const result = await api.reflect({
        days,
        project: this.reflectProject.trim() || undefined,
      });
      const line = result.memory.content.split('\n').find((item) => item.trim().length > 0) ?? '已写入反思';
      this.reflectNote = result.deduped ? `今天的反思已经有了：${line}` : line;
    } catch (err) {
      this.error = errorMessage(err, '反思失败');
    }
  }

  async loadSnapshots(): Promise<void> {
    try {
      const result = await api.listSnapshots();
      this.snapshots = result.snapshots;
    } catch (err) {
      this.error = errorMessage(err, '读取快照失败');
    }
  }

  async createSnapshot(): Promise<void> {
    this.error = null;
    try {
      await api.createSnapshot(this.snapshotNote.trim() || undefined);
      this.snapshotNote = '';
      this.snapshotMessage = '快照已保存。列表里不包含正文。';
      await this.loadSnapshots();
    } catch (err) {
      this.error = errorMessage(err, '创建快照失败');
    }
  }

  armRestore(id: string): void {
    this.restoreId = id;
  }

  cancelRestore(): void {
    this.restoreId = null;
  }

  async confirmRestore(): Promise<void> {
    if (!this.restoreId) return;
    this.error = null;
    try {
      const result = await api.restoreSnapshot(this.restoreId, this.restoreStrategy);
      this.restoreId = null;
      this.snapshotMessage = `恢复完成：导入 ${result.imported}，跳过 ${result.skipped}，替换 ${result.replaced}。`;
      await this.loadAudit();
    } catch (err) {
      this.error = errorMessage(err, '恢复快照失败');
    }
  }

  async loadAudit(): Promise<void> {
    try {
      const result = await api.listAudit(50);
      this.audit = result.entries;
    } catch (err) {
      this.error = errorMessage(err, '读取审计失败');
    }
  }

  async loadFeed(): Promise<void> {
    try {
      const [feed, incoming] = await Promise.all([api.sharedFeed(), api.incomingShares()]);
      this.feed = feed.memories;
      this.invites = incoming.invites;
    } catch (err) {
      this.error = errorMessage(err, '读取共享失败');
    }
  }

  async acceptInvite(id: string): Promise<void> {
    this.error = null;
    try {
      await api.acceptShare(id);
      await this.loadFeed();
    } catch (err) {
      this.error = errorMessage(err, '接受分享失败');
    }
  }

  async rejectInvite(id: string): Promise<void> {
    this.error = null;
    try {
      await api.rejectShare(id);
      await this.loadFeed();
    } catch (err) {
      this.error = errorMessage(err, '拒绝分享失败');
    }
  }

  async meshSync(): Promise<void> {
    const peerUrl = this.peerUrl.trim();
    const peerToken = this.peerToken.trim();
    if (!peerUrl || !peerToken) {
      this.error = '填写对端地址和令牌';
      return;
    }
    this.error = null;
    this.meshNote = null;
    try {
      const result = await api.meshSync({ peerUrl, peerToken, strategy: this.meshStrategy });
      this.meshNote = `对端 ${result.peerCount} 条，导入 ${result.imported}，跳过 ${result.skipped}，替换 ${result.replaced}。`;
      this.peerToken = '';
    } catch (err) {
      this.error = errorMessage(err, '同步失败');
    }
  }
}
