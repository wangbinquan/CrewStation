import { useLocation, useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queryKeys';
import { useApiQuery } from '../../shared/api/useApi';
import { useT } from '../../shared/lib/useT';
import { useProjectScope } from '../../shared/project/ProjectScope';
import { PROJECT_PATHS, projectPageFromPath } from '../../shared/project/projectPaths';
import { useProjectIdentity } from '../../shared/project/useProjectIdentity';
import { isIntegrationKind } from '../../shared/admin/integrationKinds';
import { EmptyState } from '../../shared/ui/EmptyState';
import { QueryStatus } from '../../shared/ui/QueryStatus';
import { DialogVisibility } from '../../shared/ui/dialog/DialogHost';
import { TesterProjectPage } from '../../features/projects/pages/TesterProjectPage';
import { ButtonLink } from '../../shared/ui/navigation/ButtonLink';

/** 只在对象种类与身份都明确后接续空间，避免子页面先挂载和附着会话。 */
export function ProjectSpaceBoundary({ children }: { readonly children: ReactNode }) {
  const { projectId, space } = useProjectScope(), t = useT();
  const project = useProjectIdentity(projectId), me = useApiQuery(queryKeys.me(), () => api.me.get());
  const pathname = useLocation().pathname, search = useSearch({ strict: false }), navigate = useNavigate();
  const kind = project.data?.kind, integration = isIntegrationKind(kind);
  const denied = integration && !me.isPending && !me.error && me.data?.isAdmin !== true;
  const target = integration ? 'admin' : kind === 'DigitalWorker' ? 'workbench' : undefined;
  const page = projectPageFromPath(pathname, projectId, space);
  const redirectTo = target && target !== space && page && !project.error && !me.error && (target === 'workbench' || me.data?.isAdmin === true) ? PROJECT_PATHS[target][page] : undefined;
  useEffect(() => { if (redirectTo) void navigate({ to: redirectTo, params: { projectId }, search, replace: true }); }, [redirectTo, projectId, search, navigate]);
  const pending = !!redirectTo || project.isPending || (integration && me.isPending);
  const failed = (((!project.data || [401, 403, 404].includes(project.error?.status ?? 0)) && project.error) || (integration && me.error));
  // 404 与 403 同样表示“不存在或不是成员”（服务端不区分），给明确的对象说明与返回路径，而不是可重试的读取失败。
  const missing = !!failed && !me.error && [403, 404].includes(project.error?.status ?? 0);
  const visible = !pending && !denied && !failed && !project.previewOnly;
  const [visited, setVisited] = useState(false);
  if (visible && !visited) setVisited(true);
  let notice: ReactNode;
  if (pending) notice = <QueryStatus isPending error={null} />;
  else if (denied) notice = <EmptyState title={t('admin.denied.title')} description={t('admin.denied.description')} action={<ButtonLink to="/">{t('admin.denied.back')}</ButtonLink>} />;
  // 没有「重新读取项目」按钮（2026-09-23 裁定）：读不到项目时每 30 秒自己再读（useProjectIdentity），网络与 5xx 失败按 15 秒重读。
  // 管理空间的项目空间只装接入项目，返回「能力接入」的接入容器页签（2026-09-24 裁定：项目管理只列数字人）。
  else if (missing) notice = <EmptyState title={t('projectContext.missingTitle')} description={t('projectContext.missingDescription', { projectId })}
    action={space === 'admin' ? <ButtonLink to="/admin/capabilities" search={{ tab: 'integrations' }}>{t('nav.admin.backToIntegrations')}</ButtonLink> : <ButtonLink to="/projects">{t('projectContext.backToProjects')}</ButtonLink>} />;
  else if (failed) notice = <QueryStatus isPending={false} error={project.error ?? me.error} />;
  else notice = <><QueryStatus isPending={false} error={project.error} />{project.previewOnly ? <TesterProjectPage /> : null}</>;
  // 只保留曾经打开的页面，避免身份刷新清掉草稿；首次以测试者进入不挂载内部页面。藏起时里面的弹窗也不画（草稿仍在）。
  return <>{notice}<div hidden={!visible} style={visible ? { display: 'contents' } : undefined}>{visible || visited ? <DialogVisibility hidden={!visible}>{children}</DialogVisibility> : null}</div></>;
}
