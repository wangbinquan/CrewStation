import type { IdentityForwardingDto, ProjectForwardingOverride } from '@crewstation/contracts';
import { api } from '../../../../../shared/api/client';
import { queryKeys } from '../../../../../shared/api/queryKeys';
import { useApiMutation, useApiQuery } from '../../../../../shared/api/useApi';
import { useDraftTarget } from '../../../../../shared/lib/useDraftTarget';
import { useT } from '../../../../../shared/lib/useT';
import { ActionRow } from '../../../../../shared/ui/ActionRow';
import { Button } from '../../../../../shared/ui/Button';
import { Card } from '../../../../../shared/ui/Card';
import { ConfirmationDialog } from '../../../../../shared/ui/dialog/ConfirmationDialog';
import { InlineConfirm } from '../../../../../shared/ui/InlineConfirm';
import { QueryStatus } from '../../../../../shared/ui/QueryStatus';
import { MutationError } from '../../MutationError';
import { ProjectOverrideForm } from './ProjectOverrideForm';
import styles from '../IdentityAdmin.module.css';

/** 项目规则：列表常驻；添加与编辑是弹窗（2026-09-23 起），草稿关窗不丢，改编辑别的项目前先确认。 */
export function ProjectOverrides({ data }: { readonly data: IdentityForwardingDto }) {
  const t = useT(), projects = useApiQuery(queryKeys.projects(), () => api.projects.list());
  const panel = useDraftTarget<ProjectForwardingOverride | 'new'>((current, next) => (current === 'new' || next === 'new' ? current === next : current.projectId === next.projectId));
  const clear = useApiMutation((id: string) => api.auth.clearProjectForwarding(id), { invalidate: [queryKeys.identityForwarding()] });
  const items = projects.data?.items ?? [], editing = panel.target;
  return <Card className={styles.container} stacked title={t('admin.auth.overridesTitle')} extra={<Button id="override-new" variant="primary" onClick={() => panel.select('new')}>{t('admin.identity.addOverride')}</Button>}>
    <QueryStatus isPending={projects.isPending} error={projects.error} />
    {panel.switching ? <ConfirmationDialog question={t('ui.draft.question', { scope: t('admin.auth.overridesTitle') })} hint={t('ui.draft.hint')} confirmLabel={t('ui.draft.leave')} cancelLabel={t('ui.draft.stay')} focus="cancel" onConfirm={panel.confirm} onCancel={panel.keep} /> : null}
    {panel.hasDraft && editing ? <ProjectOverrideForm key={panel.sequence} open={panel.open} projects={editing === 'new' ? items.filter((project) => !data.projects.some((override) => override.projectId === project.id)) : items} candidates={data.candidates} defaults={data.global.fields} initial={editing === 'new' ? undefined : editing}
      onSaved={panel.close} onDirtyChange={panel.dirtyChanged} onClose={panel.hide} onClear={panel.clear} /> : null}
    {!data.projects.length ? <p className={styles.muted}>{t('admin.auth.overridesEmpty')}</p> : data.projects.map((override) => <div className={styles.providerRow} key={override.projectId}>
      <div className={styles.providerDetails}><strong>{items.find((project) => project.id === override.projectId)?.name ?? t('admin.identity.unknownProject')}</strong><code className={styles.muted}>{override.projectId}</code>
        <span className={styles.muted}>{override.fields.length ? override.fields.map((key) => data.candidates.find((candidate) => candidate.key === key)?.kind === 'fixed' ? t(`admin.auth.field.${key}`) : key).join(' · ') : t('admin.auth.noneForwarded')}</span>
      </div>
      <ActionRow><Button id={`override-${override.projectId}`} size="small" disabled={clear.isPending} onClick={() => panel.select(override)}>{t('admin.auth.edit')}</Button>
        <InlineConfirm variant="danger" size="small" label={t('admin.auth.clearOverride')} question={t('admin.auth.clearOverrideQuestion')} busy={clear.isPending} onConfirm={() => clear.mutate(override.projectId)} />
      </ActionRow>
    </div>)}
    <MutationError error={clear.error} messageKey="admin.auth.forwardingSaveError" />
  </Card>;
}
