import type { ProjectDto } from '@crewstation/contracts';
import { useRef } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { errorMessage, useApiMutation } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { Card } from '../../../shared/ui/Card';
import { DefinitionList } from '../../../shared/ui/DefinitionList';
import { InlineConfirm } from '../../../shared/ui/InlineConfirm';
import { ProjectStateBadge } from './ProjectStateBadge';

/** 仅接既有归档动作；同步状态与异步路由处理分开说明。 */
export function ProjectLifecycleCard({ project, isAdmin, unavailable }: { readonly project: ProjectDto; readonly isAdmin: boolean; readonly unavailable: boolean }) {
  const t = useT(), lock = useRef(false);
  const archive = useApiMutation(() => api.projects.archive(project.id), { invalidate: [queryKeys.projects(), ['market'], queryKeys.gateway()] });
  const canArchive = ['active', 'paused', 'failed'].includes(project.state);
  const submit = async () => {
    if (lock.current || unavailable || !canArchive || !isAdmin) return;
    lock.current = true;
    try { await archive.mutateAsync(undefined); } catch { /* 真实错误由下面呈现。 */ }
    finally { lock.current = false; }
  };
  return <Card compact title={t('settings.tab.lifecycle')}>
    <p><ProjectStateBadge state={project.state} /> {project.message}</p>
    <p>{t('projects.lifecycle.effect')}</p>
    <p>{t('projects.lifecycle.retained')}</p>
    {project.state === 'archived' ? <ActionNote tone="neutral">{t('projects.lifecycle.archived')}</ActionNote> : !isAdmin ? <p>{t('projects.lifecycle.adminOnly')}</p> : !canArchive ? <p>{t('projects.lifecycle.provisioning')}</p> : <InlineConfirm label={t('projects.lifecycle.archive')} question={t('projects.lifecycle.question', { name: project.name, slug: project.slug })} confirmLabel={t('projects.lifecycle.confirm')} busy={unavailable || archive.isPending} busyLabel={t('projects.lifecycle.archiving')} onConfirm={() => { void submit(); }} />}
    {archive.isError ? <ActionNote tone="error">{t('projects.lifecycle.error', { message: errorMessage(archive.error) })}</ActionNote> : null}
    {archive.isSuccess ? <ActionNote tone="success">{t('projects.lifecycle.saved', { state: t(`projects.state.${archive.data.state}`) })}</ActionNote> : null}
    <details><summary>{t('settings.technicalDetails')}</summary><DefinitionList items={[
      { label: 'Project ID', value: <code>{project.id}</code> },
      { label: 'Service ID', value: <code>{project.serviceId ?? '—'}</code> },
      { label: 'Namespace', value: <code>{project.namespace}</code> },
    ]} /></details>
  </Card>;
}
