import { useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../../shared/api/client';
import { useAdminPage } from '../../shared/admin/useAdminRead';
import { useT } from '../../shared/lib/useT';
import { QueryStatus } from '../../shared/ui/QueryStatus';
import { ProjectResourceCenterView } from '../../features/project-resources';
import { Button } from '../../shared/ui/Button';
import { ProjectResourcePoliciesDialog, AdminSection } from '../../features/admin';
import { ButtonLink } from '../../shared/ui/navigation/ButtonLink';
import { isIntegrationKind } from '../../shared/admin/integrationKinds';

export function AdminProjectResourceCenterPage() {
  const { projectId } = useParams({ strict: false }), t = useT();
  const [policies, setPolicies] = useState(false);
  const { query, me, allowed } = useAdminPage(['project-resource-page', projectId], async () => {
    const project = await api.projects.get(projectId!);
    if (project.id !== projectId) throw new Error(t('admin.directory.invalid'));
    return project;
  }, !!projectId);
  // 接入项目的资源配置从「能力接入」进来，也回那里；项目管理只列数字人（2026-09-24 裁定）。项目还在读时不给返回，免得先显示错的去向。
  const reading = allowed && !!projectId && query.isPending;
  const back = reading ? null : isIntegrationKind(query.data?.kind) ? <ButtonLink to="/admin/capabilities" search={{ tab: 'integrations' }}>{t('nav.admin.backToIntegrations')}</ButtonLink>
    : <ButtonLink to="/admin/projects">{t('nav.admin.backToProjects')}</ButtonLink>;
  return <AdminSection title={query.data ? `${query.data.name} · ${t('resourceCenter.title')}` : t('resourceCenter.title')} description={t('resourceCenter.description')}
    actions={back}>
    <QueryStatus isPending={query.isPending} error={query.error ?? me.error} />
    {allowed && query.data && !query.error ? <><ProjectResourceCenterView key={`${projectId}:${me.data!.id}`} projectId={projectId!} management={<Button size="small" onClick={() => setPolicies(true)}>{t('resourceCenter.managePolicies')}</Button>} /><ProjectResourcePoliciesDialog key={`policies:${projectId}:${me.data!.id}`} open={policies} projectId={projectId!} viewerId={me.data!.id} onClose={() => setPolicies(false)} /></> : null}
  </AdminSection>;
}
