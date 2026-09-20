import { api } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queryKeys';
import { useApiQuery } from '../../shared/api/useApi';
import { Outlet, useLocation, useParams } from '@tanstack/react-router';
import { DeveloperGuard } from './DeveloperGuard';
import type { ReactElement } from 'react';
import { AppShell } from './AppShell';
import { WorkbenchNav } from './WorkbenchNav';

/** 应用向所有登录用户开放；项目开发需要当前平台角色。 */
export function WorkbenchLayout(): ReactElement {
  const path = useLocation().pathname, developing = path.startsWith('/projects');
  const { projectId } = useParams({ strict: false });
  const me = useApiQuery(queryKeys.me(), () => api.me.get());
  const eligible = !me.error && (me.data?.platformRole === 'developer' || me.data?.platformRole === 'admin');
  return <AppShell nav={developing && projectId && eligible ? <WorkbenchNav projectId={projectId} /> : null}>{developing ? <DeveloperGuard key={path}><Outlet /></DeveloperGuard> : <Outlet />}</AppShell>;
}
