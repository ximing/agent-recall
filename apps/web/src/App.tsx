import { Navigate, Route, Routes } from 'react-router';
import BoardPage from '@/pages/board';
import CostPage from '@/pages/cost';
import GraphPage from '@/pages/graph';
import GuidePage from '@/pages/guide';
import LoginPage from '@/pages/login';
import McpPage from '@/pages/mcp';
import MemoriesPage from '@/pages/memories';
import OpsPage from '@/pages/ops';
import SessionsPage from '@/pages/sessions';
import SettingsPage from '@/pages/settings';
import StatePage from '@/pages/state';
import TokensPage from '@/pages/tokens';
import { ROUTES } from '@/routes';
import { RequireAuth } from '@/shell/RequireAuth';

export function App() {
  return (
    <Routes>
      <Route path={ROUTES.home} element={<GuidePage />} />
      <Route path={ROUTES.login} element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route path={ROUTES.board.slice(1)} element={<BoardPage />} />
        <Route path={ROUTES.memories.slice(1)} element={<MemoriesPage />} />
        <Route path={ROUTES.sessions.slice(1)} element={<SessionsPage />} />
        <Route path={ROUTES.state.slice(1)} element={<StatePage />} />
        <Route path={ROUTES.graph.slice(1)} element={<GraphPage />} />
        <Route path={ROUTES.ops.slice(1)} element={<OpsPage />} />
        <Route path={ROUTES.tokens.slice(1)} element={<TokensPage />} />
        <Route path={ROUTES.mcp.slice(1)} element={<McpPage />} />
        <Route path={ROUTES.cost.slice(1)} element={<CostPage />} />
        <Route path={ROUTES.settings.slice(1)} element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to={ROUTES.home} replace />} />
    </Routes>
  );
}
