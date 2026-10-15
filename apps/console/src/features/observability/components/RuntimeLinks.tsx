import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { ButtonLink } from '../../../shared/ui/navigation/ButtonLink';
import type { RuntimeScope, RuntimeSearch } from '../model/runtimeSearch';

/** 任务详情是独立路由：可在新标签页打开、可分享，返回时回到原筛选。 */
export function RuntimeTaskLink({ scope, taskId, search, children }: { scope: RuntimeScope; taskId: string; search: RuntimeSearch; children: ReactNode }) {
  if (scope.kind === 'system') return <Link to="/admin/observability/tasks/$taskId" params={{ taskId }} search={search}>{children}</Link>;
  const params = { projectId: scope.projectId, taskId };
  return scope.space === 'admin'
    ? <Link to="/admin/integrations/$projectId/observability/tasks/$taskId" params={params} search={search}>{children}</Link>
    : <Link to="/projects/$projectId/observability/tasks/$taskId" params={params} search={search}>{children}</Link>;
}

export function RuntimeBackLink({ scope, search, children }: { scope: RuntimeScope; search: RuntimeSearch; children: ReactNode }) {
  if (scope.kind === 'system') return <ButtonLink variant="ghost" to="/admin/observability" search={search}>{children}</ButtonLink>;
  const params = { projectId: scope.projectId };
  return scope.space === 'admin'
    ? <ButtonLink variant="ghost" to="/admin/integrations/$projectId/observability" params={params} search={search}>{children}</ButtonLink>
    : <ButtonLink variant="ghost" to="/projects/$projectId/observability" params={params} search={search}>{children}</ButtonLink>;
}

/** 系统页按项目比较后，点进同一时间范围的项目页。 */
export function RuntimeProjectLink({ projectId, search, children }: { projectId: string; search: RuntimeSearch; children: ReactNode }) {
  return <Link to="/projects/$projectId/observability" params={{ projectId }} search={search}>{children}</Link>;
}
