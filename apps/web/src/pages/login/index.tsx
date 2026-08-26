import { bindServices, observer, useService } from '@rabjs/react';
import { Link, useNavigate } from 'react-router';
import { ROUTES } from '@/routes';
import { LoginService } from './login.service';
import './login.css';

const LoginPage = observer(function LoginPage() {
  const service = useService(LoginService);
  const navigate = useNavigate();

  return (
    <main className="login-view">
      <section className="panel login-card">
        <p className="brand-mark">召回</p>
        <p className="brand-sub">AGENT RECALL</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void service.submit().then((ok) => {
              if (ok) navigate(ROUTES.memories);
            });
          }}
        >
          <input
            className="field"
            type="email"
            placeholder="邮箱"
            autoComplete="username"
            value={service.email}
            onChange={(event) => service.setEmail(event.target.value)}
          />
          <input
            className="field"
            type="password"
            placeholder="密码（至少 8 位）"
            autoComplete={service.mode === 'login' ? 'current-password' : 'new-password'}
            value={service.password}
            onChange={(event) => service.setPassword(event.target.value)}
          />
          {service.error ? (
            <p className="form-error" role="alert">
              {service.error}
            </p>
          ) : null}
          <button type="submit" className="btn primary" disabled={!service.canSubmit}>
            {service.mode === 'login' ? '登录' : '注册'}
          </button>
        </form>
        <button
          type="button"
          className="login-switch"
          onClick={() => service.setMode(service.mode === 'login' ? 'register' : 'login')}
        >
          {service.mode === 'login' ? '没有账号？去注册' : '已有账号？去登录'}
        </button>
        <p className="login-back">
          <Link to={ROUTES.home}>先看说明</Link>
        </p>
      </section>
    </main>
  );
});

export default bindServices(LoginPage, [LoginService]);
