import { useRef, useState } from 'react';
import { ProjectServicePolicyDtoSchema, ProjectServicePolicySchema } from '@crewstation/contracts';
import type { ProjectServicePolicy, ProjectServicePolicyDto, ServicePlanDto } from '@crewstation/contracts';
import { api } from '../../../../shared/api/client';
import { errorMessage, useApiMutation } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { UnsavedChangesGuard } from '../../../../shared/navigation/UnsavedChangesGuard';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { ActionRow } from '../../../../shared/ui/ActionRow';
import { Button } from '../../../../shared/ui/Button';
import { FormField } from '../../../../shared/ui/FormField';
import { InlineConfirm } from '../../../../shared/ui/InlineConfirm';
import { Stack } from '../../../../shared/ui/Stack';
import styles from './ProjectComputeForm.module.css';

export function ProjectServiceForm({ initial, plans, viewerId, onReload }: { readonly initial: ProjectServicePolicyDto; readonly plans: readonly ServicePlanDto[]; readonly viewerId: string; readonly onReload: () => void }) {
  const t = useT(), [base, setBase] = useState(initial), [draft, setDraft] = useState(initial.policy), [error, setError] = useState<string>();
  const lock = useRef(false), root = useRef<HTMLFormElement>(null);
  const policy: ProjectServicePolicy = draft.mode === 'inherit' ? { mode: 'inherit', allowedPlanIds: [] } : draft;
  const dirty = JSON.stringify(policy) !== JSON.stringify(base.policy);
  const save = useApiMutation(async (snapshot: ProjectServicePolicy) => {
    const me = await api.me.get();
    if (!me.isAdmin || me.id !== viewerId) throw new Error(t('admin.projectCompute.identityChanged'));
    const next = ProjectServicePolicyDtoSchema.parse(await api.projects.saveServicePolicy(initial.projectId, { expectedRevision: base.revision, policy: snapshot }));
    if (next.projectId !== initial.projectId || next.revision !== base.revision + 1 || JSON.stringify(next.policy) !== JSON.stringify(snapshot)) throw new Error(t('admin.resources.invalidReceipt'));
    return next;
  }, { invalidate: [['projects', initial.projectId]], onSuccess: (next) => { setBase(next); setDraft(next.policy); } });
  const change = (next: ProjectServicePolicy) => { setDraft(next); setError(undefined); save.reset(); };
  const submit = () => {
    if (lock.current) return;
    const valid = ProjectServicePolicySchema.safeParse(policy).success && policy.allowedPlanIds.every((id) => plans.some((plan) => plan.id === id));
    if (!valid) { setError(t('admin.resources.invalidPlans')); queueMicrotask(() => root.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()); return; }
    lock.current = true; setError(undefined); save.mutate(policy, { onSettled: () => { lock.current = false; } });
  };
  return <form ref={root} onSubmit={(event) => { event.preventDefault(); submit(); }}><Stack>
    <UnsavedChangesGuard dirty={dirty || save.isPending} scope={t('admin.resources.service')} isNavigationBusy={() => save.isPending} />
    <FormField label={t('admin.resources.serviceMode')} hint={t('admin.resources.serviceModeHint')}><select value={draft.mode} disabled={save.isPending} onChange={(event) => change({ ...draft, mode: event.target.value as ProjectServicePolicy['mode'] })}>
      <option value="inherit">{t('admin.resources.inheritService')}</option><option value="restricted">{t('admin.resources.restrictService')}</option>
    </select></FormField>
    {draft.mode === 'restricted' ? <fieldset className={styles.profiles} disabled={save.isPending} aria-invalid={!!error} aria-describedby="service-plan-constraint" tabIndex={-1}>
      <legend>{t('admin.resources.allowedPlans')}</legend><p id="service-plan-constraint">{error ?? t('admin.resources.allowedPlansHint')}</p>
      {plans.map((plan) => <label className={styles.choice} key={plan.id}><input type="checkbox" checked={draft.allowedPlanIds.includes(plan.id)} onChange={(event) => change({ ...draft, allowedPlanIds: event.target.checked ? [...draft.allowedPlanIds, plan.id] : draft.allowedPlanIds.filter((id) => id !== plan.id) })} />
        <span><strong>{plan.name}</strong><small>CPU {plan.cpu} · {plan.memory} · {t('admin.resources.replicas', { count: plan.maxReplicas })}</small></span>
      </label>)}
      {draft.allowedPlanIds.filter((id) => !plans.some((plan) => plan.id === id)).map((id) => <label key={id} className={styles.choice}><input type="checkbox" checked onChange={() => change({ ...draft, allowedPlanIds: draft.allowedPlanIds.filter((value) => value !== id) })} /><span>{id} · {t('admin.resources.missingPlan')}</span></label>)}
      {!plans.length ? <ActionNote tone="neutral">{t('admin.resources.emptyPlans')}</ActionNote> : null}
    </fieldset> : <ActionNote tone="neutral">{t('admin.resources.inheritedService', { count: plans.length })}</ActionNote>}
    {save.error ? <ActionNote tone="error">{errorMessage(save.error)}</ActionNote> : null}
    {save.isSuccess ? <ActionNote tone="success">{t('admin.resources.serviceSaved')}</ActionNote> : null}
    <ActionRow><Button type="submit" variant="primary" disabled={save.isPending || !dirty}>{t(save.isPending ? 'admin.profile.working' : 'admin.resources.saveService')}</Button>
      {dirty ? <InlineConfirm variant="ghost" label={t('admin.resources.discardServiceAction')} question={t('admin.resources.discardService')} busy={save.isPending} onConfirm={onReload} /> : null}
    </ActionRow>
  </Stack></form>;
}
