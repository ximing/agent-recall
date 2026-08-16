import { RERANK_DEFAULT_BASE_URL, RERANK_DEFAULT_MODEL, type RecallLogPublic, type SettingsPublic } from '@agent-recall/dto';
import { Service } from '@rabjs/react';
import { api, errorMessage } from '@/api/client';

export type AutoForgetPreview = { expired: number; stale: number; deleted: number };

export class SettingsService extends Service {
  settings: SettingsPublic | null = null;
  recallLogs: RecallLogPublic[] = [];
  rerankEnabled = false;
  rerankBaseUrl = RERANK_DEFAULT_BASE_URL;
  rerankModel = RERANK_DEFAULT_MODEL;
  rerankApiKey = '';
  autoForgetDays = '0';
  saving = false;
  saved = false;
  error: string | null = null;
  expandedLogId: string | null = null;

  /** 立即执行自动遗忘：先 dryRun 预览，确认后真正执行 */
  afPreview: AutoForgetPreview | null = null;
  afResult: AutoForgetPreview | null = null;
  afBusy = false;

  toggleLog(id: string): void {
    this.expandedLogId = this.expandedLogId === id ? null : id;
  }

  get dirty(): boolean {
    if (!this.settings) return false;
    return (
      this.rerankEnabled !== this.settings.rerankEnabled ||
      this.rerankBaseUrl !== this.settings.rerankBaseUrl ||
      this.rerankModel !== this.settings.rerankModel ||
      this.rerankApiKey.length > 0 ||
      this.parsedAutoForgetDays !== this.settings.autoForgetDays
    );
  }

  get parsedAutoForgetDays(): number {
    const value = Number.parseInt(this.autoForgetDays, 10);
    if (Number.isNaN(value)) return 0;
    return Math.min(365, Math.max(0, value));
  }

  /** 召回历史聚合摘要 */
  get logSummary(): { total: number; rerankRate: number; avgLatency: number; rerankFailed: number } {
    const total = this.recallLogs.length;
    if (total === 0) return { total: 0, rerankRate: 0, avgLatency: 0, rerankFailed: 0 };
    const rerankApplied = this.recallLogs.filter((log) => log.rerankApplied).length;
    const rerankFailed = this.recallLogs.filter((log) => log.rerankError !== null).length;
    const latency = this.recallLogs.reduce((sum, log) => sum + log.latencyMs, 0);
    return {
      total,
      rerankRate: Math.round((rerankApplied / total) * 100),
      avgLatency: Math.round(latency / total),
      rerankFailed,
    };
  }

  setRerankEnabled(value: boolean): void {
    this.rerankEnabled = value;
    this.saved = false;
  }

  setRerankBaseUrl(value: string): void {
    this.rerankBaseUrl = value;
    this.saved = false;
  }

  setRerankModel(value: string): void {
    this.rerankModel = value;
    this.saved = false;
  }

  setRerankApiKey(value: string): void {
    this.rerankApiKey = value;
    this.saved = false;
  }

  setAutoForgetDays(value: string): void {
    this.autoForgetDays = value;
    this.saved = false;
  }

  async load(): Promise<void> {
    this.error = null;
    try {
      const [settingsResult, logsResult] = await Promise.all([api.getSettings(), api.listRecallLogs()]);
      this.settings = settingsResult.settings;
      this.recallLogs = logsResult.logs;
      this.rerankEnabled = settingsResult.settings.rerankEnabled;
      this.rerankBaseUrl = settingsResult.settings.rerankBaseUrl;
      this.rerankModel = settingsResult.settings.rerankModel;
      this.rerankApiKey = '';
      this.autoForgetDays = String(settingsResult.settings.autoForgetDays);
    } catch (err) {
      this.error = errorMessage(err, '读取设置失败');
    }
  }

  async save(): Promise<void> {
    this.error = null;
    this.saved = false;
    this.saving = true;
    try {
      const result = await api.updateSettings({
        rerankEnabled: this.rerankEnabled,
        rerankBaseUrl: this.rerankBaseUrl.trim() || undefined,
        rerankModel: this.rerankModel.trim() || undefined,
        // 留空 = 保持已保存的 Key 不变
        ...(this.rerankApiKey.trim() ? { rerankApiKey: this.rerankApiKey.trim() } : {}),
        autoForgetDays: this.parsedAutoForgetDays,
      });
      this.settings = result.settings;
      this.rerankApiKey = '';
      this.autoForgetDays = String(result.settings.autoForgetDays);
      this.saved = true;
    } catch (err) {
      this.error = errorMessage(err, '保存设置失败');
    } finally {
      this.saving = false;
    }
  }

  async clearApiKey(): Promise<void> {
    this.error = null;
    try {
      const result = await api.updateSettings({ rerankEnabled: this.rerankEnabled, rerankApiKey: '' });
      this.settings = result.settings;
      this.rerankApiKey = '';
    } catch (err) {
      this.error = errorMessage(err, '清除 API Key 失败');
    }
  }

  async previewAutoForget(): Promise<void> {
    this.error = null;
    this.afResult = null;
    this.afBusy = true;
    try {
      this.afPreview = await api.autoForget(true);
    } catch (err) {
      this.error = errorMessage(err, '预览自动遗忘失败');
    } finally {
      this.afBusy = false;
    }
  }

  cancelAutoForget(): void {
    this.afPreview = null;
  }

  async confirmAutoForget(): Promise<void> {
    this.error = null;
    this.afBusy = true;
    try {
      this.afResult = await api.autoForget(false);
      this.afPreview = null;
    } catch (err) {
      this.error = errorMessage(err, '执行自动遗忘失败');
    } finally {
      this.afBusy = false;
    }
  }
}
