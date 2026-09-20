import { Outlet, useLocation } from '@tanstack/react-router';
import { AgentActivityProvider } from '../../shared/activity/AgentActivityProvider';

export function AppRoot() {
  const path = useLocation().pathname;
  return <AgentActivityProvider enabled={path.startsWith('/projects/') || path.startsWith('/admin/integrations/')}><Outlet /></AgentActivityProvider>;
}
