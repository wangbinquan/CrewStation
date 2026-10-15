import { useNavigate } from '@tanstack/react-router';
import type { RuntimeScope, RuntimeSearch } from '../model/runtimeSearch';

/** 在当前层级的统计页内换页签或筛选（地址即状态，可收藏与分享）。 */
export function useRuntimeNavigation(scope: RuntimeScope): (search: RuntimeSearch) => void {
  const navigate = useNavigate();
  return (search) => {
    if (scope.kind === 'system') void navigate({ to: '/admin/observability', search, resetScroll: false });
    else if (scope.space === 'admin') void navigate({ to: '/admin/integrations/$projectId/observability', params: { projectId: scope.projectId }, search, resetScroll: false });
    else void navigate({ to: '/projects/$projectId/observability', params: { projectId: scope.projectId }, search, resetScroll: false });
  };
}
