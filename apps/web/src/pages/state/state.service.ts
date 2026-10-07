import type { KvEntryPublic } from '@agent-recall/dto';
import { Service } from '@rabjs/react';
import { api, errorMessage } from '@/api/client';

export type StateTab =
  | 'actions'
  | 'signals'
  | 'sentinels'
  | 'slots'
  | 'profile'
  | 'leases'
  | 'routines'
  | 'checkpoints';

const KEY_RE = /^[\w.:-]{1,128}$/;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function parseJson(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: '请填写 JSON' };
  try {
    return { ok: true, value: JSON.parse(trimmed) as unknown };
  } catch {
    return { ok: false, error: '不是合法的 JSON' };
  }
}

export class StateService extends Service {
  tab: StateTab = 'actions';
  loading = false;
  error: string | null = null;
  notice: string | null = null;

  entries: KvEntryPublic[] = [];
  pendingKey: string | null = null;

  actionTitle = '';
  actionDetail = '';
  signalName = '';
  signalData = '';
  sentinelName = '';
  sentinelCondition = '';
  sentinelNote = '';
  slotName = '';
  slotJson = '';
  profileKey = '';
  profileValue = '';
  leaseName = '';
  leaseHolder = 'web';
  leaseTtl = '300';
  routineName = '';
  routineJson = '';
  routineOutput = '';
  checkpointName = '';
  checkpointJson = '';

  setTab(tab: StateTab): void {
    this.tab = tab;
    this.notice = null;
    this.error = null;
    this.pendingKey = null;
    this.routineOutput = '';
    this.entries = [];
    void this.load();
  }

  assign(partial: Partial<StateService>): void {
    Object.assign(this, partial);
  }

  async load(): Promise<void> {
    await this.loadEntries(this.tab);
  }

  private async loadEntries(namespace: string): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const result = await api.listKv(namespace);
      this.entries = result.entries;
    } catch (err) {
      this.error = errorMessage(err, '读取状态失败');
    } finally {
      this.loading = false;
    }
  }

  private checkedKey(raw: string): string | null {
    const key = raw.trim();
    if (!KEY_RE.test(key)) {
      this.error = '名称只能包含字母、数字、下划线、点、冒号和连字符';
      return null;
    }
    return key;
  }

  async createAction(): Promise<void> {
    const title = this.actionTitle.trim();
    if (!title) {
      this.error = '填写行动标题';
      return;
    }
    this.error = null;
    try {
      const id = crypto.randomUUID();
      await api.putKv('actions', id, {
        value: { title, detail: this.actionDetail.trim() || null, status: 'open' },
      });
      this.actionTitle = '';
      this.actionDetail = '';
      this.notice = '已记下这条行动';
      await this.loadEntries('actions');
    } catch (err) {
      this.error = errorMessage(err, '创建行动失败');
    }
  }

  async setActionStatus(entry: KvEntryPublic, status: 'open' | 'done' | 'blocked'): Promise<void> {
    this.error = null;
    try {
      const current = asRecord(entry.value);
      await api.putKv('actions', entry.key, { value: { ...current, status } });
      await this.loadEntries('actions');
    } catch (err) {
      this.error = errorMessage(err, '更新行动失败');
    }
  }

  async sendSignal(): Promise<void> {
    const name = this.checkedKey(this.signalName);
    if (!name) return;
    this.error = null;
    try {
      await api.appendKv('signals', name, { data: this.signalData, at: new Date().toISOString() });
      this.signalData = '';
      this.notice = `已追加到信号 ${name}`;
      await this.loadEntries('signals');
    } catch (err) {
      this.error = errorMessage(err, '发送信号失败');
    }
  }

  async createSentinel(): Promise<void> {
    const name = this.checkedKey(this.sentinelName);
    const condition = this.sentinelCondition.trim();
    if (!name) return;
    if (!condition) {
      this.error = '填写触发条件';
      return;
    }
    this.error = null;
    try {
      await api.putKv('sentinels', name, { value: { condition, fires: [] } });
      this.notice = `已创建哨兵 ${name}`;
      await this.loadEntries('sentinels');
    } catch (err) {
      this.error = errorMessage(err, '创建哨兵失败');
    }
  }

  async triggerSentinel(entry: KvEntryPublic): Promise<void> {
    this.error = null;
    try {
      const current = asRecord(entry.value);
      const fires = Array.isArray(current.fires) ? [...(current.fires as unknown[])] : [];
      fires.push({ note: this.sentinelNote.trim() || null, at: new Date().toISOString() });
      await api.putKv('sentinels', entry.key, { value: { ...current, fires } });
      this.sentinelNote = '';
      this.notice = `哨兵 ${entry.key} 已触发`;
      await this.loadEntries('sentinels');
    } catch (err) {
      this.error = errorMessage(err, '触发哨兵失败');
    }
  }

  async saveSlot(append: boolean): Promise<void> {
    const name = this.checkedKey(this.slotName);
    if (!name) return;
    const parsed = parseJson(this.slotJson);
    const value = parsed.ok ? parsed.value : this.slotJson;
    if (!parsed.ok && !append && !this.slotJson.trim()) {
      this.error = parsed.error;
      return;
    }
    this.error = null;
    try {
      if (append) await api.appendKv('slots', name, value);
      else await api.putKv('slots', name, { value });
      this.notice = append ? `已追加到槽位 ${name}` : `已写入槽位 ${name}`;
      await this.loadEntries('slots');
    } catch (err) {
      this.error = errorMessage(err, '写入槽位失败');
    }
  }

  async saveProfile(): Promise<void> {
    const key = this.checkedKey(this.profileKey);
    if (!key) return;
    this.error = null;
    try {
      await api.putKv('profile', key, { value: this.profileValue });
      this.notice = `已写入档案 ${key}`;
      await this.loadEntries('profile');
    } catch (err) {
      this.error = errorMessage(err, '写入档案失败');
    }
  }

  async acquireLease(): Promise<void> {
    const name = this.checkedKey(this.leaseName);
    const holder = this.leaseHolder.trim();
    const ttlSeconds = Number.parseInt(this.leaseTtl, 10);
    if (!name) return;
    if (!holder) {
      this.error = '填写持有者';
      return;
    }
    if (!Number.isFinite(ttlSeconds) || ttlSeconds < 1) {
      this.error = 'TTL 至少 1 秒';
      return;
    }
    this.error = null;
    try {
      const result = await api.acquireLease(name, holder, ttlSeconds);
      const heldBy = asRecord(result.entry.value).holder;
      this.notice = result.acquired ? `已取得租约 ${name}` : `租约 ${name} 已被 ${String(heldBy ?? '他人')} 持有`;
      await this.loadEntries('leases');
    } catch (err) {
      this.error = errorMessage(err, '获取租约失败');
    }
  }

  async saveRoutine(): Promise<void> {
    const name = this.checkedKey(this.routineName);
    if (!name) return;
    const parsed = parseJson(this.routineJson);
    if (!parsed.ok) {
      this.error = parsed.error;
      return;
    }
    this.error = null;
    try {
      await api.putKv('routines', name, { value: parsed.value });
      this.notice = `已写入例程 ${name}`;
      await this.loadEntries('routines');
    } catch (err) {
      this.error = errorMessage(err, '写入例程失败');
    }
  }

  async runRoutine(name: string): Promise<void> {
    this.error = null;
    this.routineOutput = '';
    try {
      const result = await api.getKv('routines', name);
      const value = asRecord(result.entry.value);
      const payload = 'steps' in value ? { name, steps: value.steps } : { name, value: result.entry.value };
      this.routineOutput = JSON.stringify(payload, null, 2);
    } catch (err) {
      this.error = errorMessage(err, '运行例程失败');
    }
  }

  async saveCheckpoint(): Promise<void> {
    const name = this.checkedKey(this.checkpointName);
    if (!name) return;
    const parsed = parseJson(this.checkpointJson);
    if (!parsed.ok) {
      this.error = parsed.error;
      return;
    }
    this.error = null;
    try {
      await api.putKv('checkpoints', name, { value: parsed.value });
      this.notice = `已写入检查点 ${name}`;
      await this.loadEntries('checkpoints');
    } catch (err) {
      this.error = errorMessage(err, '写入检查点失败');
    }
  }

  askDelete(key: string): void {
    this.pendingKey = key;
  }

  cancelDelete(): void {
    this.pendingKey = null;
  }

  async confirmDelete(): Promise<void> {
    if (!this.pendingKey) return;
    const key = this.pendingKey;
    this.error = null;
    try {
      await api.deleteKv(this.tab, key);
      this.pendingKey = null;
      this.notice = `已删除 ${key}`;
      await this.loadEntries(this.tab);
    } catch (err) {
      this.error = errorMessage(err, '删除失败');
    }
  }
}
