import { Link, useLocation, useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { api } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queryKeys';
import { useApiQuery } from '../../shared/api/useApi';
import { useT } from '../../shared/lib/useT';
import { useProjectScope } from '../../shared/project/ProjectScope';
import { PROJECT_PATHS, projectPageFromPath } from '../../shared/project/projectPaths';
import { useProjectIdentity } from '../../shared/project/useProjectIdentity';
import { EmptyState } from '../../shared/ui/EmptyState';
import { QueryStatus } from '../../shared/ui/QueryStatus';
import { Button } from '../../shared/ui/Button';

/** 只在对象种类与身份都明确后接续空间，避免子页面先挂载和附着会话。 */
export function ProjectSpaceBoundary({ children }: { readonly children: ReactNode }) {
  const { projectId, space } = useProjectScope(), t = useT();
  const project = useProjectIdentity(projectId), me = useApiQuery(queryKeys.me(), () => api.me.get());
  const pathname = useLocation().pathname, search = useSearch({ strict: false }), navigate = useNavigate();
  const kind = project.data?.kind, integration = kind === 'APIProxy' || kind === 'EventProducer';
  const denied = integration && !me.isPending && !me.error && me.data?.isAdmin !== true;
  const target = integration ? 'admin' : kind === 'DigitalWorker' ? 'workbench' : undefined;
  const page = projectPageFromPath(pathname, projectId, space);
  const redirectTo = target && target !== space && page && !project.error && !me.error && (target === 'workbench' || me.data?.isAdmin === true) ? PROJECT_PATHS[target][page] : undefined;
  useEffect(() => { if (redirectTo) void navigate({ to: redirectTo, params: { projectId }, search, replace: true }); }, [redirectTo, projectId, search, navigate]);
  if (redirectTo || project.isPending || (integration && me.isPending)) return <QueryStatus isPending error={null} />;
  if (denied) return <EmptyState title={t('admin.denied.title')} description={t('admin.denied.description')} action={<Link to="/">{t('admin.denied.back')}</Link>} />;
  if (((!project.data || [401, 403, 404].includes(project.error?.status ?? 0)) && project.error) || (integration && me.error)) return <><QueryStatus isPending={false} error={project.error ?? me.error} /><Button onClick={() => { void project.refetch(); if (me.error) void me.refetch(); }}>{t('projectContext.retry')}</Button></>;
  return <><QueryStatus isPending={false} error={project.error} />{children}</>;
}
