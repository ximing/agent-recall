import { Service } from '@rabjs/react';
import { errorMessage } from '@/api/client';
import { AuthService } from '@/services/auth.service';

export class LoginService extends Service {
  mode: 'login' | 'register' = 'register';
  email = '';
  password = '';
  error: string | null = null;

  get auth(): AuthService {
    return this.resolve(AuthService);
  }

  get canSubmit(): boolean {
    return this.email.trim().length > 0 && this.password.length >= 8 && !this.$model.submit.loading;
  }

  setMode(mode: 'login' | 'register'): void {
    this.mode = mode;
    this.error = null;
  }

  setEmail(value: string): void {
    this.email = value;
  }

  setPassword(value: string): void {
    this.password = value;
  }

  async submit(): Promise<boolean> {
    this.error = null;
    const email = this.email.trim();
    if (email.length === 0 || this.password.length < 8) {
      this.error = '请填写邮箱，密码至少 8 位';
      return false;
    }
    try {
      if (this.mode === 'login') await this.auth.login(email, this.password);
      else await this.auth.register(email, this.password);
      return true;
    } catch (err) {
      this.error = errorMessage(err, this.mode === 'login' ? '登录失败' : '注册失败');
      return false;
    }
  }
}
