import type { LlmCapability, LlmUsageBreakdown, LlmUsagePublic } from '@agent-recall/dto';
import { Service } from '@rabjs/react';
import { api, errorMessage } from '@/api/client';

export const COST_CAPABILITIES = ['chat', 'embed', 'rerank'] as const satisfies readonly LlmCapability[];

export const COST_TITLES: Record<LlmCapability, string> = {
  chat: '大模型 / 对话',
  embed: '向量 / embedding',
  rerank: '精排 / rerank',
};

export const COST_ROW_LABEL: Record<LlmCapability, string> = {
  chat: '对话 · LLM',
  embed: '向量 · embedding',
  rerank: '精排 · rerank',
};

const EMPTY_BREAKDOWN: LlmUsageBreakdown[] = COST_CAPABILITIES.map((capability) => ({
  capability,
  calls: 0,
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  costEstimate: 0,
}));

export function formatCost(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '$0';
  if (value < 0.0001) return `$${value.toExponential(2)}`;
  const fixed = value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return `$${fixed}`;
}

export function formatTokens(value: number): string {
  return Math.round(value).toLocaleString('zh-CN');
}

export class CostService extends Service {
  logs: LlmUsagePublic[] = [];
  byCapability: LlmUsageBreakdown[] = EMPTY_BREAKDOWN;
  totalCost = 0;
  totalTokens = 0;
  loaded = false;
  error: string | null = null;

  async load(): Promise<void> {
    this.error = null;
    try {
      const usage = await api.listLlmUsage(100);
      const known = new Map(usage.byCapability.map((row) => [row.capability, row]));
      this.byCapability = COST_CAPABILITIES.map((capability) => {
        const row = known.get(capability);
        if (row) return row;
        return { capability, calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, costEstimate: 0 };
      });
      this.logs = usage.logs;
      this.totalCost = usage.totalCost;
      this.totalTokens = usage.totalTokens;
      this.loaded = true;
    } catch (err) {
      this.error = errorMessage(err, '读取调用成本失败');
    }
  }
}
