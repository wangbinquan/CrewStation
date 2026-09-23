import { Outlet, useLocation } from '@tanstack/react-router';
import { AgentActivityProvider } from '../../shared/activity/AgentActivityProvider';
import { DialogHost } from '../../shared/ui/dialog/DialogHost';

/** 根路由的透传层：全局的 Agent 动态，以及全站弹窗的挂载点（弹窗不再落在打开它的组件里）。 */
export function AppRoot() {
  const path = useLocation().pathname;
  return <AgentActivityProvider enabled={path.startsWith('/projects/') || path.startsWith('/admin/integrations/')}><DialogHost><Outlet /></DialogHost></AgentActivityProvider>;
}
