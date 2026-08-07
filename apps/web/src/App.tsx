import { Route, Routes } from 'react-router';
import LoginPage from '@/pages/login';
import McpPage from '@/pages/mcp';
import MemoriesPage from '@/pages/memories';
import TokensPage from '@/pages/tokens';
import { ROUTES } from '@/routes';
import { RequireAuth } from '@/shell/RequireAuth';

export function App() {
  return (
    <Routes>
      <Route path={ROUTES.login} element={<LoginPage />} />
      <Route path="/" element={<RequireAuth />}>
        <Route index element={<MemoriesPage />} />
        <Route path={ROUTES.memories.slice(1)} element={<MemoriesPage />} />
        <Route path={ROUTES.tokens.slice(1)} element={<TokensPage />} />
        <Route path={ROUTES.mcp.slice(1)} element={<McpPage />} />
      </Route>
    </Routes>
  );
}
