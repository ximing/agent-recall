import { observer, useService } from '@rabjs/react';
import { Bookmark, History, KeyRound, ListTodo, Monitor, Moon, Settings, Sun, Waypoints, Wrench } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router';
import { ROUTES } from '@/routes';
import { AuthService } from '@/services/auth.service';
import { ThemeService } from '@/services/theme.service';

export const Layout = observer(function Layout({ children }: { children: ReactNode }) {
  const auth = useService(AuthService);
  const theme = useService(ThemeService);
  const navigate = useNavigate();

  return (
    <div className="shell">
      <aside className="rail">
        <Link to={ROUTES.home} className="brand">
          <p className="brand-mark">召回</p>
          <p className="brand-sub">AGENT RECALL</p>
        </Link>
        <nav className="rail-nav">
          <p className="rail-group">记录</p>
          <NavLink to={ROUTES.memories}>
            <Bookmark size={16} strokeWidth={1.6} />
            记忆
          </NavLink>
          <NavLink to={ROUTES.sessions}>
            <History size={16} strokeWidth={1.6} />
            会话
          </NavLink>
          <NavLink to={ROUTES.state}>
            <ListTodo size={16} strokeWidth={1.6} />
            状态
          </NavLink>
          <p className="rail-group">洞察</p>
          <NavLink to={ROUTES.graph}>
            <Waypoints size={16} strokeWidth={1.6} />
            关系
          </NavLink>
          <NavLink to={ROUTES.ops}>
            <Wrench size={16} strokeWidth={1.6} />
            治理
          </NavLink>
          <p className="rail-group">系统</p>
          <NavLink to={ROUTES.tokens}>
            <KeyRound size={16} strokeWidth={1.6} />
            令牌
          </NavLink>
          <NavLink to={ROUTES.mcp}>
            <Monitor size={16} strokeWidth={1.6} />
            MCP 客户端
          </NavLink>
          <NavLink to={ROUTES.settings}>
            <Settings size={16} strokeWidth={1.6} />
            设置
          </NavLink>
        </nav>
        <div className="rail-foot">
          <div className="theme-toggle" role="group" aria-label="主题">
            <button
              type="button"
              className={theme.theme === 'light' ? 'active' : ''}
              onClick={() => theme.set('light')}
            >
              <Sun size={13} strokeWidth={1.6} />
              明亮
            </button>
            <button
              type="button"
              className={theme.theme === 'dark' ? 'active' : ''}
              onClick={() => theme.set('dark')}
            >
              <Moon size={13} strokeWidth={1.6} />
              暗色
            </button>
          </div>
          <div className="rail-user">
            <span className="avatar">{auth.user?.email?.[0] ?? '?'}</span>
            <span className="email">{auth.user?.email}</span>
            <button
              type="button"
              className="logout"
              onClick={() => {
                void auth.logout().then(() => navigate(ROUTES.login));
              }}
            >
              退出
            </button>
          </div>
        </div>
      </aside>
      <main className="stage">{children}</main>
    </div>
  );
});
