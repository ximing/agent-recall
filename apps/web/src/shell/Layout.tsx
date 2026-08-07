import { observer, useService } from '@rabjs/react';
import type { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { ROUTES } from '@/routes';
import { AuthService } from '@/services/auth.service';

export const Layout = observer(function Layout({ children }: { children: ReactNode }) {
  const auth = useService(AuthService);
  const navigate = useNavigate();

  return (
    <div className="shell">
      <aside className="rail">
        <p className="mark">召回</p>
        <p className="mark-sub">Agent Recall</p>
        <nav className="rail-nav">
          <NavLink to={ROUTES.memories}>记忆</NavLink>
          <NavLink to={ROUTES.tokens}>令牌</NavLink>
          <NavLink to={ROUTES.mcp}>MCP</NavLink>
        </nav>
        <p className="who">{auth.user?.email}</p>
        <button
          type="button"
          className="text-btn light"
          onClick={() => {
            void auth.logout().then(() => navigate(ROUTES.login));
          }}
        >
          退出
        </button>
      </aside>
      <main className="stage">{children}</main>
    </div>
  );
});
