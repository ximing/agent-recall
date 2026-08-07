import { observer, useService } from '@rabjs/react';
import { Navigate, Outlet } from 'react-router';
import { ROUTES } from '@/routes';
import { AuthService } from '@/services/auth.service';
import { Layout } from './Layout';

export const RequireAuth = observer(function RequireAuth() {
  const auth = useService(AuthService);
  if (!auth.ready) return <p className="splash">正在确认登录状态</p>;
  if (!auth.user) return <Navigate to={ROUTES.login} replace />;
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
});
