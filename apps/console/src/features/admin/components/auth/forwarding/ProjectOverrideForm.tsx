import { UpdateIdentityForwardingRequestSchema } from '@crewstation/contracts';
import type { ForwardingCandidate, ProjectDto, ProjectForwardingOverride } from '@crewstation/contracts';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../../../shared/api/client';
import { queryKeys } from '../../../../../shared/api/queryKeys';
import { useApiMutation } from '../../../../../shared/api/useApi';
import { useT } from '../../../../../shared/lib/useT';
import { UnsavedChangesGuard } from '../../../../../shared/navigation/UnsavedChangesGuard';
import { ActionNote } from '../../../../../shared/ui/ActionNote';
import { Button } from '../../../../../shared/ui/Button';
import { ConfirmationPanel } from '../../../../../shared/ui/ConfirmationPanel';
import { ChoiceField } from '../../../../../shared/ui/selection/ChoiceField';
import { AdminField } from '../../AdminField';
import { AdminForm } from '../../AdminForm';
import styles from '../IdentityAdmin.module.css';

export function ProjectOverrideForm({ projects, candidates, defaults, initial, onClose }: {
  readonly projects: readonly ProjectDto[]; readonly candidates: readonly ForwardingCandidate[]; readonly defaults: readonly string[];
  readonly initial?: ProjectForwardingOverride; readonly onClose: () => void;
}) {
  const t = useT(), [projectId, setProjectId] = useState(initial?.projectId ?? '');
  const [fields, setFields] = useState<string[]>([...(initial?.fields ?? defaults)]), [attempt, setAttempt] = useState(0);
  const [discard, setDiscard] = useState(false), [errors, setErrors] = useState({ project: false, fields: false });
  const root = useRef<HTMLDivElement>(null), [baseline] = useState(() => JSON.stringify({ projectId, fields }));
  const dirty = JSON.stringify({ projectId, fields }) !== baseline;
  const save = useApiMutation(() => api.auth.setProjectForwarding(projectId, { fields }), { invalidate: [queryKeys.identityForwarding()], onSuccess: onClose });
  const unknown = fields.filter((key) => !candidates.some((candidate) => candidate.key === key));
  useEffect(() => { root.current?.querySelector<HTMLElement>(attempt ? '[aria-invalid="true"]' : 'select')?.focus(); }, [attempt]);
  return <div ref={root}>
    <UnsavedChangesGuard dirty={dirty || save.isPending} scope={t('admin.auth.overridesTitle')} isNavigationBusy={() => save.isPending} />
    <AdminForm stacked busy={save.isPending} incomplete={false} submitLabel={t('admin.auth.setOverride')} busyLabel={t('admin.auth.saving')}
      note={t('admin.auth.overrideNote')} error={save.error?.message} extraActions={<Button variant="ghost" disabled={save.isPending} onClick={() => dirty ? setDiscard(true) : onClose()}>{t('admin.auth.cancelEdit')}</Button>}
      onSubmit={() => { const next = { project: !projectId, fields: !UpdateIdentityForwardingRequestSchema.safeParse({ fields }).success }; setErrors(next); setAttempt((n) => n + 1); if (!next.project && !next.fields && !save.isPending && !discard) save.mutate(); }}>
      <div className={styles.fieldStack}>
        <AdminField label={t('admin.auth.project')} value={projectId} disabled={Boolean(initial) || save.isPending} onChange={setProjectId} hint={t('admin.identity.projectHint')} error={errors.project ? t('admin.identity.projectRequired') : undefined}
          options={[{ value: '', label: t('admin.identity.chooseProject') }, ...projects.map((project) => ({ value: project.id, label: `${project.name} · ${project.id}` })), ...(initial && !projects.some((project) => project.id === initial.projectId) ? [{ value: initial.projectId, label: initial.projectId }] : [])]} />
        {projectId ? <code className={styles.muted}>{projectId}</code> : null}
        <p className={styles.muted}>{t('admin.identity.fieldsHint')}</p>
        <fieldset disabled={save.isPending} className={styles.choices} aria-label={t('admin.auth.forwardedFields')} aria-invalid={errors.fields} tabIndex={-1}>
          {candidates.map((candidate) => <ChoiceField key={candidate.key} label={candidate.kind === 'fixed' ? t(`admin.auth.field.${candidate.key}`) : candidate.key} description={`${candidate.key} · ${t(candidate.kind === 'fixed' ? 'admin.auth.sourceFixed' : 'admin.auth.sourceMapped')}${candidate.providers.length ? ` · ${candidate.providers.join(', ')}` : ''}`} checked={fields.includes(candidate.key)} onChange={(e) => setFields((current) => e.target.checked ? [...current, candidate.key] : current.filter((key) => key !== candidate.key))} />)}
          {unknown.map((key) => <ChoiceField key={key} label={key} description={t('admin.identity.unknownField')} checked onChange={() => setFields((current) => current.filter((field) => field !== key))} />)}
        </fieldset>
        {!fields.length ? <ActionNote tone="neutral">{t('admin.auth.noneForwarded')}</ActionNote> : null}
        {errors.fields ? <ActionNote tone="error">{t('admin.identity.fieldsError')}</ActionNote> : null}
      </div>
    </AdminForm>
    {discard ? <ConfirmationPanel question={t('ui.draft.question', { scope: t('admin.auth.overridesTitle') })} confirmLabel={t('ui.draft.leave')} cancelLabel={t('ui.draft.stay')} onConfirm={onClose} onCancel={() => setDiscard(false)} /> : null}
  </div>;
}
