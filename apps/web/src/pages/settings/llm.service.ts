import {
  LLM_DEFAULT_BASE_URL,
  LLM_PROVIDERS,
  LLM_SUGGESTED_MODEL,
  type LlmConfigPublic,
  type LlmProvider,
  type LlmUsagePublic,
} from '@agent-recall/dto';
import { Service } from '@rabjs/react';
import { api, errorMessage } from '@/api/client';

export const LLM_PROVIDER_LABELS: Record<LlmProvider, string> = {
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  claude: 'Claude',
  zhipu: '智谱',
  dashscope: '通义千问',
};

export function formatCost(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '$0';
  if (value < 0.0001) return `$${value.toExponential(2)}`;
  const fixed = value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return `$${fixed}`;
}

export class LlmService extends Service {
  configs: LlmConfigPublic[] = [];
  logs: LlmUsagePublic[] = [];
  totalCost = 0;
  totalTokens = 0;
  provider: LlmProvider = 'openai';
  model = LLM_SUGGESTED_MODEL.openai;
  baseUrl = '';
  apiKey = '';
  makeDefault = true;
  saving = false;
  error: string | null = null;
  notice: string | null = null;
  pendingDeleteId: string | null = null;
  testingId: string | null = null;

  readonly providers = LLM_PROVIDERS;
  readonly labels = LLM_PROVIDER_LABELS;

  setProvider(value: string): void {
    if (!LLM_PROVIDERS.includes(value as LlmProvider)) return;
    const next = value as LlmProvider;
    if (this.model === LLM_SUGGESTED_MODEL[this.provider]) this.model = LLM_SUGGESTED_MODEL[next];
    this.provider = next;
  }

  setModel(value: string): void {
    this.model = value;
  }

  setBaseUrl(value: string): void {
    this.baseUrl = value;
  }

  setApiKey(value: string): void {
    this.apiKey = value;
  }

  setMakeDefault(value: boolean): void {
    this.makeDefault = value;
  }

  askDelete(id: string): void {
    this.pendingDeleteId = id;
  }

  cancelDelete(): void {
    this.pendingDeleteId = null;
  }

  basePlaceholder(): string {
    return LLM_DEFAULT_BASE_URL[this.provider];
  }

  async load(): Promise<void> {
    this.error = null;
    try {
      const [configs, usage] = await Promise.all([api.listLlmConfigs(), api.listLlmUsage()]);
      this.configs = configs.configs;
      this.logs = usage.logs;
      this.totalCost = usage.totalCost;
      this.totalTokens = usage.totalTokens;
      if (this.configs.length === 0) this.makeDefault = true;
    } catch (err) {
      this.error = errorMessage(err, '读取模型配置失败');
    }
  }

  async create(): Promise<void> {
    const model = this.model.trim();
    const apiKey = this.apiKey.trim();
    if (!model || !apiKey) {
      this.error = '请填写模型和 API Key';
      return;
    }
    this.saving = true;
    this.error = null;
    this.notice = null;
    try {
      await api.createLlmConfig({
        provider: this.provider,
        model,
        apiKey,
        baseUrl: this.baseUrl.trim() || null,
        isDefault: this.makeDefault || this.configs.length === 0,
      });
      this.apiKey = '';
      this.baseUrl = '';
      this.notice = '已保存';
      await this.load();
    } catch (err) {
      this.error = errorMessage(err, '保存模型配置失败');
    } finally {
      this.saving = false;
    }
  }

  async confirmDelete(): Promise<void> {
    if (!this.pendingDeleteId) return;
    this.error = null;
    this.notice = null;
    try {
      await api.deleteLlmConfig(this.pendingDeleteId);
      this.pendingDeleteId = null;
      await this.load();
    } catch (err) {
      this.error = errorMessage(err, '删除模型配置失败');
    }
  }

  async makeDefaultConfig(id: string): Promise<void> {
    this.error = null;
    this.notice = null;
    try {
      await api.setDefaultLlmConfig(id);
      await this.load();
    } catch (err) {
      this.error = errorMessage(err, '设置默认模型失败');
    }
  }

  async test(id: string): Promise<void> {
    this.testingId = id;
    this.error = null;
    this.notice = null;
    try {
      const result = await api.testLlmConfig(id);
      this.notice = result.ok ? '连接成功' : `连接失败：${result.error ?? '模型调用失败'}`;
      await this.load();
    } catch (err) {
      this.error = errorMessage(err, '测试模型失败');
    } finally {
      this.testingId = null;
    }
  }
}
