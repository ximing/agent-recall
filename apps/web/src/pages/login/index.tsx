import { bindServices, observer, useService } from '@rabjs/react';
import { useNavigate } from 'react-router';
import { ROUTES } from '@/routes';
import { LoginService } from './login.service';

const LoginPage = observer(function LoginPage() {
  const service = useService(LoginService);
  const navigate = useNavigate();

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <p className="mark ink">召回</p>
        <h1>把代理做过的事留下来</h1>
        <p className="lede">网页、代理和钩子写入的记忆，都归你自己的账号。</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void service.submit().then((ok) => {
              if (ok) navigate(ROUTES.memories);
            });
          }}
        >
          <label>
            邮箱
            <input
              type="email"
              autoComplete="username"
              value={service.email}
              onChange={(event) => service.setEmail(event.target.value)}
            />
          </label>
          <label>
            密码
            <input
              type="password"
              autoComplete={service.mode === 'login' ? 'current-password' : 'new-password'}
              value={service.password}
              onChange={(event) => service.setPassword(event.target.value)}
            />
          </label>
          {service.error ? (
            <p className="form-error" role="alert">
              {service.error}
            </p>
          ) : null}
          <button type="submit" className="primary" disabled={!service.canSubmit}>
            {service.mode === 'login' ? '登录' : '注册'}
          </button>
        </form>
        <button
          type="button"
          className="text-btn"
          onClick={() => service.setMode(service.mode === 'login' ? 'register' : 'login')}
        >
          {service.mode === 'login' ? '没有账号？去注册' : '已有账号？去登录'}
        </button>
      </section>
    </main>
  );
});

export default bindServices(LoginPage, [LoginService]);
