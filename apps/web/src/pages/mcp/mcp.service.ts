import type { McpClientPublic } from '@agent-recall/dto';
import { Service } from '@rabjs/react';
import { api, errorMessage } from '@/api/client';
import { copyText } from '@/utils/clipboard';

export class McpService extends Service {
  clients: McpClientPublic[] = [];
  name = '';
  freshConfig: string | null = null;
  freshBaseUrl: string | null = null;
  pendingRevokeId: string | null = null;
  error: string | null = null;
  copied = false;

  setName(value: string): void {
    this.name = value;
  }

  dismissConfig(): void {
    this.freshConfig = null;
    this.freshBaseUrl = null;
    this.copied = false;
  }

  async copyConfig(): Promise<void> {
    if (!this.freshConfig) return;
    this.copied = await copyText(this.freshConfig);
  }

  askRevoke(id: string): void {
    this.pendingRevokeId = id;
  }

  cancelRevoke(): void {
    this.pendingRevokeId = null;
  }

  async load(): Promise<void> {
    this.error = null;
    try {
      const result = await api.listMcpClients();
      this.clients = result.clients;
    } catch (err) {
      this.error = errorMessage(err, '读取 MCP 客户端失败');
    }
  }

  async create(): Promise<void> {
    this.error = null;
    const name = this.name.trim();
    if (!name) {
      this.error = '请填写客户端名称';
      return;
    }
    try {
      const created = await api.createMcpClient(name);
      this.freshConfig = created.config;
      this.freshBaseUrl = created.baseUrl;
      this.name = '';
      this.pendingRevokeId = null;
      this.clients = [created.client, ...this.clients.filter((item) => item.id !== created.client.id)];
      await this.load();
    } catch (err) {
      this.error = errorMessage(err, '注册客户端失败');
    }
  }

  async confirmRevoke(): Promise<void> {
    if (!this.pendingRevokeId) return;
    this.error = null;
    try {
      await api.revokeMcpClient(this.pendingRevokeId);
      this.pendingRevokeId = null;
      await this.load();
    } catch (err) {
      this.error = errorMessage(err, '吊销客户端失败');
    }
  }
}
