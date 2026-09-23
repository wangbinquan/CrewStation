import { UpdateIdentityForwardingRequestSchema } from '@crewstation/contracts';
import type { ForwardingCandidate, ProjectDto, ProjectForwardingOverride } from '@crewstation/contracts';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../../../shared/api/client';
import { queryKeys } from '../../../../../shared/api/queryKeys';
import { useApiMutation } from '../../../../../shared/api/useApi';
import { useT } from '../../../../../shared/lib/useT';
import { UnsavedChangesGuard } from '../../../../../shared/navigation/UnsavedChangesGuard';
import { ActionNote } from '../../../../../shared/ui/ActionNote';
import { FormDialog } from '../../../../../shared/ui/dialog/FormDialog';
import { ChoiceField } from '../../../../../shared/ui/selection/ChoiceField';
import { AdminField } from '../../AdminField';
import styles from '../IdentityAdmin.module.css';

/**
 * 添加或编辑项目规则的弹窗（2026-09-23 起由卡片里的行内表单改为弹窗）：组件在草稿存在期间常驻挂载，弹窗只在 `open` 时画出来；
 * 取消、✕、Esc 只关窗，草稿与离开确认都还在。
 */
export function ProjectOverrideForm({ projects, candidates, defaults, initial, open, onSaved, onDirtyChange, onClose, onClear }: {
  readonly projects: readonly ProjectDto[]; readonly candidates: readonly ForwardingCandidate[]; readonly defaults: readonly string[];
  readonly initial?: ProjectForwardingOverride; readonly open: boolean;
  readonly onSaved: () => void; readonly onDirtyChange: (dirty: boolean) => void; readonly onClose: () => void; readonly onClear: () => void;
}) {
  const t = useT(), [projectId, setProjectId] = useState(initial?.projectId ?? '');
  const [fields, setFields] = useState<string[]>([...(initial?.fields ?? defaults)]), [attempt, setAttempt] = useState(0);
  const [errors, setErrors] = useState({ project: false, fields: false });
  const root = useRef<HTMLDivElement>(null), [baseline] = useState(() => JSON.stringify({ projectId, fields }));
  const dirty = JSON.stringify({ projectId, fields }) !== baseline;
  const save = useApiMutation(() => api.auth.setProjectForwarding(projectId, { fields }), { invalidate: [queryKeys.identityForwarding()], onSuccess: onSaved });
  const unknown = fields.filter((key) => !candidates.some((candidate) => candidate.key === key));
  useEffect(() => { onDirtyChange(dirty || save.isPending); return () => onDirtyChange(false); }, [dirty, save.isPending, onDirtyChange]);
  useEffect(() => { if (open) root.current?.querySelector<HTMLElement>(attempt ? '[aria-invalid="true"]' : 'select')?.focus(); }, [attempt, open]);
  return <>
    <UnsavedChangesGuard dirty={dirty || save.isPending} scope={t('admin.auth.overridesTitle')} isNavigationBusy={() => save.isPending} />
    {open ? <FormDialog title={initial ? t('admin.auth.editOverride', { name: projects.find((project) => project.id === initial.projectId)?.name ?? initial.projectId }) : t('admin.identity.addOverride')} busy={save.isPending} submitLabel={t('admin.auth.setOverride')} busyLabel={t('admin.auth.saving')}
      error={save.error?.message} dirty={dirty} onClear={onClear} onClose={onClose}
      onSubmit={() => { const next = { project: !projectId, fields: !UpdateIdentityForwardingRequestSchema.safeParse({ fields }).success }; setErrors(next); setAttempt((n) => n + 1); if (!next.project && !next.fields && !save.isPending) save.mutate(); }}>
      <p className={styles.muted}>{t('admin.auth.overrideNote')}</p>
      <div ref={root} className={styles.fieldStack}>
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
    </FormDialog> : null}
  </>;
}
