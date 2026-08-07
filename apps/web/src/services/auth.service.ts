import type { UserPublic } from '@agent-recall/dto';
import { Service } from '@rabjs/react';
import { api } from '@/api/client';

export class AuthService extends Service {
  user: UserPublic | null = null;
  ready = false;

  async bootstrap(): Promise<void> {
    try {
      const result = await api.me();
      this.user = result.user;
    } catch {
      this.user = null;
    } finally {
      this.ready = true;
    }
  }

  async login(email: string, password: string): Promise<void> {
    const result = await api.login(email, password);
    this.user = result.user;
  }

  async register(email: string, password: string): Promise<void> {
    const result = await api.register(email, password);
    this.user = result.user;
  }

  async logout(): Promise<void> {
    await api.logout();
    this.user = null;
  }
}
