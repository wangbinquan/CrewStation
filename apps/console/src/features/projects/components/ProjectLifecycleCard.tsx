import type { ProjectDto } from '@crewstation/contracts';
import { useRef, useState } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { errorMessage, useApiMutation } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { ConfirmDialog } from '../../../shared/ui/dialog/ConfirmDialog';
import { ProjectStateBadge } from './ProjectStateBadge';

/**
 * 仅接既有归档动作；同步状态与异步路由处理分开说明。归档没有恢复入口，确认走弹窗并输入 archive
 * （2026-09-23 作者裁定）；请求进行中弹窗锁住，结束后关闭，结果显示在卡片上。
 */
export function ProjectLifecycleCard({ project, isAdmin, unavailable }: { readonly project: ProjectDto; readonly isAdmin: boolean; readonly unavailable: boolean }) {
  const t = useT(), lock = useRef(false), [confirming, setConfirming] = useState(false);
  const archive = useApiMutation(() => api.projects.archive(project.id), { invalidate: [queryKeys.projects(), ['market'], queryKeys.gateway()] });
  const canArchive = ['active', 'failed'].includes(project.state);
  const submit = async () => {
    if (lock.current || unavailable || !canArchive || !isAdmin) return;
    lock.current = true;
    try { await archive.mutateAsync(undefined); } catch { /* 真实错误由下面呈现。 */ }
    finally { lock.current = false; setConfirming(false); }
  };
  return <Card stacked compact title={t('projects.lifecycle.archive')}>
    <p><ProjectStateBadge state={project.state} /> {project.message}</p>
    <p>{t('projects.lifecycle.effect')}</p>
    <p>{t('projects.lifecycle.retained')}</p>
    {project.state === 'archived' ? <ActionNote tone="neutral">{t('projects.lifecycle.archived')}</ActionNote> : !isAdmin ? <p>{t('projects.lifecycle.adminOnly')}</p> : !canArchive ? <p>{t('projects.lifecycle.provisioning')}</p>
      : <Button variant="danger" disabled={unavailable || archive.isPending} onClick={() => { archive.reset(); setConfirming(true); }}>{archive.isPending ? t('projects.lifecycle.archiving') : t('projects.lifecycle.archive')}</Button>}
    {confirming ? <ConfirmDialog title={t('projects.lifecycle.archive')} question={t('projects.lifecycle.question', { name: project.name, slug: project.slug })} confirmWord="archive"
      confirmLabel={t('projects.lifecycle.confirm')} busy={archive.isPending} busyLabel={t('projects.lifecycle.archiving')} confirmDisabled={unavailable} onConfirm={() => { void submit(); }} onCancel={() => setConfirming(false)}>
      <ul>
        <li>{t('projects.lifecycle.impact.routes')}</li>
        <li>{t('projects.lifecycle.impact.retained')}</li>
        <li>{t('projects.lifecycle.impact.processes')}</li>
        <li>{t('projects.lifecycle.impact.noRestore')}</li>
      </ul>
    </ConfirmDialog> : null}
    {archive.isError ? <ActionNote tone="error">{t('projects.lifecycle.error', { message: errorMessage(archive.error) })}</ActionNote> : null}
    {archive.isSuccess ? <ActionNote tone="success">{t('projects.lifecycle.saved', { state: t(`projects.state.${archive.data.state}`) })}</ActionNote> : null}
  </Card>;
}
