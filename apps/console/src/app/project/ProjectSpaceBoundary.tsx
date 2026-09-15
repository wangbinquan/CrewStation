import { Link, useLocation, useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
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
import { TesterProjectPage } from '../../features/projects/pages/TesterProjectPage';

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
  const pending = !!redirectTo || project.isPending || (integration && me.isPending);
  const failed = (((!project.data || [401, 403, 404].includes(project.error?.status ?? 0)) && project.error) || (integration && me.error));
  const visible = !pending && !denied && !failed && !project.previewOnly;
  const [visited, setVisited] = useState(false);
  if (visible && !visited) setVisited(true);
  let notice: ReactNode;
  if (pending) notice = <QueryStatus isPending error={null} />;
  else if (denied) notice = <EmptyState title={t('admin.denied.title')} description={t('admin.denied.description')} action={<Link to="/">{t('admin.denied.back')}</Link>} />;
  else if (failed) notice = <><QueryStatus isPending={false} error={project.error ?? me.error} /><Button onClick={() => { void project.refetch(); if (me.error) void me.refetch(); }}>{t('projectContext.retry')}</Button></>;
  else notice = <><QueryStatus isPending={false} error={project.error} />{project.previewOnly ? <TesterProjectPage /> : null}</>;
  // 只保留曾经打开的页面，避免身份刷新清掉草稿；首次以测试者进入不挂载内部页面。
  return <>{notice}<div hidden={!visible} style={visible ? { display: 'contents' } : undefined}>{visible || visited ? children : null}</div></>;
}
