import type { IdentityForwardingDto, ProjectForwardingOverride } from '@crewstation/contracts';
import { useRef, useState } from 'react';
import { api } from '../../../../../shared/api/client';
import { queryKeys } from '../../../../../shared/api/queryKeys';
import { useApiMutation, useApiQuery } from '../../../../../shared/api/useApi';
import { useT } from '../../../../../shared/lib/useT';
import { ActionRow } from '../../../../../shared/ui/ActionRow';
import { Button } from '../../../../../shared/ui/Button';
import { Card } from '../../../../../shared/ui/Card';
import { InlineConfirm } from '../../../../../shared/ui/InlineConfirm';
import { QueryStatus } from '../../../../../shared/ui/QueryStatus';
import { MutationError } from '../../MutationError';
import { ProjectOverrideForm } from './ProjectOverrideForm';
import styles from '../IdentityAdmin.module.css';

export function ProjectOverrides({ data }: { readonly data: IdentityForwardingDto }) {
  const t = useT(), projects = useApiQuery(queryKeys.projects(), () => api.projects.list());
  const [editing, setEditing] = useState<ProjectForwardingOverride | 'new'>(), opener = useRef('');
  const clear = useApiMutation((id: string) => api.auth.clearProjectForwarding(id), { invalidate: [queryKeys.identityForwarding()] });
  const items = projects.data?.items ?? [];
  const open = (value: ProjectForwardingOverride | 'new') => { opener.current = value === 'new' ? 'override-new' : `override-${value.projectId}`; setEditing(value); };
  const close = () => { setEditing(undefined); requestAnimationFrame(() => document.getElementById(opener.current)?.focus()); };
  return <Card className={styles.container} stacked title={t('admin.auth.overridesTitle')} extra={!editing ? <Button id="override-new" variant="primary" onClick={() => open('new')}>{t('admin.identity.addOverride')}</Button> : null}>
    <QueryStatus isPending={projects.isPending} error={projects.error} />
    {editing ? <ProjectOverrideForm projects={editing === 'new' ? items.filter((project) => !data.projects.some((override) => override.projectId === project.id)) : items} candidates={data.candidates} defaults={data.global.fields} initial={editing === 'new' ? undefined : editing} onClose={close} /> : <>
      {!data.projects.length ? <p className={styles.muted}>{t('admin.auth.overridesEmpty')}</p> : data.projects.map((override) => <div className={styles.providerRow} key={override.projectId}>
        <div className={styles.providerDetails}><strong>{items.find((project) => project.id === override.projectId)?.name ?? t('admin.identity.unknownProject')}</strong><code className={styles.muted}>{override.projectId}</code>
          <span className={styles.muted}>{override.fields.length ? override.fields.map((key) => data.candidates.find((candidate) => candidate.key === key)?.kind === 'fixed' ? t(`admin.auth.field.${key}`) : key).join(' · ') : t('admin.auth.noneForwarded')}</span>
        </div>
        <ActionRow><Button id={`override-${override.projectId}`} size="small" disabled={clear.isPending} onClick={() => open(override)}>{t('admin.auth.edit')}</Button>
          <InlineConfirm variant="danger" size="small" label={t('admin.auth.clearOverride')} question={t('admin.auth.clearOverrideQuestion')} busy={clear.isPending} onConfirm={() => clear.mutate(override.projectId)} />
        </ActionRow>
      </div>)}
    </>}
    <MutationError error={clear.error} messageKey="admin.auth.forwardingSaveError" />
  </Card>;
}
