import { useRef, useState } from 'react';
import type { ComputeProfileListItem, ProjectComputePolicy, ProjectComputePolicyDto, TaskProfileDto } from '@crewstation/contracts';
import { ProjectComputePolicySchema } from '@crewstation/contracts';
import { api } from '../../../../shared/api/client';
import { errorMessage, useApiMutation } from '../../../../shared/api/useApi';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { useT } from '../../../../shared/lib/useT';
import { UnsavedChangesGuard } from '../../../../shared/navigation/UnsavedChangesGuard';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { ActionRow } from '../../../../shared/ui/ActionRow';
import { Button } from '../../../../shared/ui/Button';
import { Card } from '../../../../shared/ui/Card';
import { FormField } from '../../../../shared/ui/FormField';
import { InlineConfirm } from '../../../../shared/ui/InlineConfirm';
import { Stack } from '../../../../shared/ui/Stack';
import styles from './ProjectComputeForm.module.css';

export function ProjectComputeForm({ initial, profiles, tasks, viewerId, onReload }: {
  readonly initial: ProjectComputePolicyDto; readonly profiles: readonly ComputeProfileListItem[];
  readonly tasks: readonly TaskProfileDto[]; readonly viewerId: string; readonly onReload: () => void;
}) {
  const t = useT(), [base, setBase] = useState(initial), [draft, setDraft] = useState(initial.policy);
  const [errors, setErrors] = useState<Record<string, string>>({}), [saved, setSaved] = useState(false), root = useRef<HTMLFormElement>(null), lock = useRef(false);
  const policy: ProjectComputePolicy = draft.mode === 'inherit' ? { ...draft, allowedProfiles: [], defaultProfile: null } : draft;
  const dirty = JSON.stringify(policy) !== JSON.stringify(base.policy);
  const save = useApiMutation(async (snapshot: ProjectComputePolicy) => {
    const me = await api.me.get();
    if (!me.isAdmin || me.id !== viewerId) throw new Error(t('admin.projectCompute.identityChanged'));
    return api.projects.saveComputePolicy(initial.projectId, { expectedRevision: base.revision, policy: snapshot });
  }, { invalidate: [queryKeys.computeProfiles(), ['projects', initial.projectId]], onSuccess: (next) => { setBase(next); setDraft(next.policy); setSaved(true); } });
  const change = (patch: Partial<ProjectComputePolicy>) => { setDraft((current) => ({ ...current, ...patch })); setSaved(false); setErrors({}); };
  const submit = () => {
    if (lock.current) return;
    const found: Record<string, string> = {}, parsed = ProjectComputePolicySchema.safeParse(policy);
    if (!parsed.success) for (const issue of parsed.error.issues) found[String(issue.path[0])] = t('admin.projectCompute.invalidDefault');
    if (policy.allowedProfiles.some((name) => !profiles.some((p) => p.name === name))) found.allowedProfiles = t('admin.projectCompute.missingProfile');
    if (policy.defaultProfile && profiles.find((p) => p.name === policy.defaultProfile)?.protocol === 'terminal') found.defaultProfile = t('admin.projectCompute.invalidDefault');
    if (policy.devTaskProfile && !tasks.some((p) => p.name === policy.devTaskProfile)) found.devTaskProfile = t('admin.projectCompute.missingTask');
    setErrors(found);
    if (Object.keys(found).length) { queueMicrotask(() => root.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()); return; }
    lock.current = true; setSaved(false); save.mutate(policy, { onSettled: () => { lock.current = false; } });
  };
  const known = new Set(profiles.map((profile) => profile.name));
  return <Card stacked title={t('admin.projectCompute.title')} footer={t('admin.projectCompute.effect')}>
    <UnsavedChangesGuard dirty={dirty || save.isPending} scope={t('admin.projectCompute.title')} isNavigationBusy={() => save.isPending} />
    <form ref={root} onSubmit={(event) => { event.preventDefault(); submit(); }}><Stack>
      <FormField label={t('admin.projectCompute.mode')} hint={t('admin.projectCompute.modeHint')}><select value={draft.mode} disabled={save.isPending} onChange={(event) => change({ mode: event.target.value as ProjectComputePolicy['mode'] })}>
        <option value="inherit">{t('admin.projectCompute.inherit')}</option><option value="restricted">{t('admin.projectCompute.restricted')}</option>
      </select></FormField>
      {draft.mode === 'restricted' ? <>
        <fieldset className={styles.profiles} disabled={save.isPending} aria-invalid={!!errors.allowedProfiles} tabIndex={-1}><legend>{t('admin.projectCompute.allowed')}</legend>
          <p>{t('admin.projectCompute.allowedHint')}</p>
          {profiles.map((profile) => <label key={profile.name} className={styles.choice}><input type="checkbox" checked={draft.allowedProfiles.includes(profile.name)} onChange={(event) => change({ allowedProfiles: event.target.checked ? [...draft.allowedProfiles, profile.name] : draft.allowedProfiles.filter((name) => name !== profile.name) })} />
            <span><strong>{profile.name}</strong> · {t(profile.defaultVisible === false ? 'admin.profile.defaultHidden' : 'admin.profile.defaultVisible')}<small>{profile.description || t(`admin.profile.protocol.${profile.protocol}`)}{!profile.availability.available ? ` · ${profile.availability.reason ?? t('admin.projectCompute.unavailable')}` : ''}</small></span></label>)}
          {draft.allowedProfiles.filter((name) => !known.has(name)).map((name) => <label key={name} className={styles.choice}><input type="checkbox" checked onChange={() => change({ allowedProfiles: draft.allowedProfiles.filter((value) => value !== name) })} /><span>{name} · {t('admin.projectCompute.missingProfile')}</span></label>)}
          {errors.allowedProfiles ? <ActionNote tone="error">{errors.allowedProfiles}</ActionNote> : null}
        </fieldset>
        <FormField label={t('admin.projectCompute.default')} hint={t('admin.projectCompute.defaultHint')} error={errors.defaultProfile}><select value={draft.defaultProfile ?? ''} aria-invalid={!!errors.defaultProfile} disabled={save.isPending} onChange={(event) => change({ defaultProfile: event.target.value || null })}>
          <option value="">{t('admin.projectCompute.noDefault')}</option>
          {profiles.filter((profile) => draft.allowedProfiles.includes(profile.name) && profile.protocol !== 'terminal').map((profile) => <option key={profile.name} value={profile.name}>{profile.name}</option>)}
          {draft.defaultProfile && !profiles.some((p) => p.name === draft.defaultProfile && draft.allowedProfiles.includes(p.name) && p.protocol !== 'terminal') ? <option value={draft.defaultProfile}>{draft.defaultProfile} · {t('admin.projectCompute.invalidDefault')}</option> : null}
        </select></FormField>
      </> : <ActionNote tone="neutral">{t('admin.projectCompute.inheritedDefault', { name: profiles.find((profile) => profile.isDefault)?.name ?? t('admin.projectCompute.noDefault') })}</ActionNote>}
      <FormField label={t('admin.projectCompute.devTask')} hint={t('admin.projectCompute.devHint')} error={errors.devTaskProfile}><select value={draft.devTaskProfile ?? ''} aria-invalid={!!errors.devTaskProfile} disabled={save.isPending} onChange={(event) => change({ devTaskProfile: event.target.value || null })}>
        <option value="">{t('admin.profile.defaultTaskProfile')}</option>{tasks.map((p) => <option key={p.name} value={p.name}>{p.name} · CPU {p.cpu} · {p.memory} · {p.storage}</option>)}
        {draft.devTaskProfile && !tasks.some((p) => p.name === draft.devTaskProfile) ? <option value={draft.devTaskProfile}>{draft.devTaskProfile} · {t('admin.projectCompute.missingTask')}</option> : null}
      </select></FormField>
      {save.error ? <ActionNote tone="error">{errorMessage(save.error)}</ActionNote> : null}{saved ? <ActionNote tone="success">{t('admin.projectCompute.saved')}</ActionNote> : null}
      <ActionRow><Button type="submit" variant="primary" disabled={save.isPending || !dirty}>{t(save.isPending ? 'admin.profile.working' : 'admin.projectCompute.save')}</Button>
        {dirty ? <InlineConfirm label={t('admin.projectCompute.reload')} question={t('admin.projectCompute.discard')} busy={save.isPending} onConfirm={onReload} /> : <Button disabled={save.isPending} onClick={onReload}>{t('admin.projectCompute.reload')}</Button>}
      </ActionRow>
    </Stack></form>
  </Card>;
}
