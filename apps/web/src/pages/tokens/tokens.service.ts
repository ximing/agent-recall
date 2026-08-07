import type { TokenPublic } from '@agent-recall/dto';
import { Service } from '@rabjs/react';
import { api, errorMessage } from '@/api/client';

export class TokensService extends Service {
  tokens: TokenPublic[] = [];
  name = '';
  freshSecret: string | null = null;
  pendingRevokeId: string | null = null;
  error: string | null = null;

  setName(value: string): void {
    this.name = value;
  }

  dismissSecret(): void {
    this.freshSecret = null;
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
      const result = await api.listTokens();
      this.tokens = result.tokens;
    } catch (err) {
      this.error = errorMessage(err, '读取令牌失败');
    }
  }

  async create(): Promise<void> {
    this.error = null;
    const name = this.name.trim();
    if (!name) {
      this.error = '请填写令牌名称';
      return;
    }
    try {
      const created = await api.createToken(name);
      this.freshSecret = created.secret;
      this.name = '';
      this.pendingRevokeId = null;
      await this.load();
    } catch (err) {
      this.error = errorMessage(err, '创建令牌失败');
    }
  }

  async confirmRevoke(): Promise<void> {
    if (!this.pendingRevokeId) return;
    this.error = null;
    try {
      await api.revokeToken(this.pendingRevokeId);
      this.pendingRevokeId = null;
      await this.load();
    } catch (err) {
      this.error = errorMessage(err, '吊销令牌失败');
    }
  }
}
