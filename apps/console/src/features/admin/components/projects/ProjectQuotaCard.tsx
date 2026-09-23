import { useId, useRef, useState } from 'react';
import { QuotaDtoSchema, SetQuotaRequestSchema } from '@crewstation/contracts';
import type { QuotaDto } from '@crewstation/contracts';
import { api } from '../../../../shared/api/client';
import { errorMessage, useApiMutation } from '../../../../shared/api/useApi';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { useAdminPage } from '../../../../shared/admin/useAdminRead';
import { useT } from '../../../../shared/lib/useT';
import { UnsavedChangesGuard } from '../../../../shared/navigation/UnsavedChangesGuard';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { ActionRow } from '../../../../shared/ui/ActionRow';
import { Button } from '../../../../shared/ui/Button';
import { Card } from '../../../../shared/ui/Card';
import { FormField } from '../../../../shared/ui/FormField';
import { InlineConfirm } from '../../../../shared/ui/InlineConfirm';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { Stack } from '../../../../shared/ui/Stack';

interface Props { readonly projectId: string; readonly viewerId: string }
export function ProjectQuotaCard({ projectId, viewerId }: Props) {
  const t = useT(), [generation, setGeneration] = useState(0);
  const { query } = useAdminPage(['project-quota-editor', projectId, generation], async () => QuotaDtoSchema.parse(await api.projects.getQuota(projectId)));
  return <Card stacked title={t('admin.resources.quota')} footer={t('admin.resources.quotaEffect')}>
    <QueryStatus isPending={query.isPending} error={query.error} />
    {query.data && !query.error ? <QuotaForm key={generation} projectId={projectId} viewerId={viewerId} initial={query.data} onReload={() => setGeneration((value) => value + 1)} /> : null}
  </Card>;
}

function QuotaForm({ projectId, viewerId, initial, onReload }: Props & { readonly initial: QuotaDto; readonly onReload: () => void }) {
  const t = useT(), id = useId(), [base, setBase] = useState(initial), [value, setValue] = useState(String(initial.maxConcurrentTasks)), [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null), lock = useRef(false), dirty = value !== String(base.maxConcurrentTasks);
  const save = useApiMutation(async (count: number) => {
    const me = await api.me.get();
    if (!me.isAdmin || me.id !== viewerId) throw new Error(t('admin.projectCompute.identityChanged'));
    const next = QuotaDtoSchema.parse(await api.projects.setQuota(projectId, { maxConcurrentTasks: count, expectedMaxConcurrentTasks: base.maxConcurrentTasks }));
    if (next.maxConcurrentTasks !== count) throw new Error(t('admin.resources.invalidReceipt'));
    return next;
  }, { invalidate: [queryKeys.quota(projectId)], onSuccess: (next) => { setBase(next); setValue(String(next.maxConcurrentTasks)); } });
  const submit = () => {
    if (lock.current) return;
    if (!/^\d+$/.test(value) || !SetQuotaRequestSchema.safeParse({ maxConcurrentTasks: Number(value) }).success) { setError(t('admin.resources.quotaHint')); input.current?.focus(); return; }
    lock.current = true; setError(undefined); save.mutate(Number(value), { onSettled: () => { lock.current = false; } });
  };
  return <form onSubmit={(event) => { event.preventDefault(); submit(); }}><Stack>
    <UnsavedChangesGuard dirty={dirty || save.isPending} scope={t('admin.resources.quota')} isNavigationBusy={() => save.isPending} />
    <p>{t('admin.resources.usage', { running: base.running, limit: base.maxConcurrentTasks })}</p>
    <FormField label={t('admin.resources.quotaLimit')} hint={t('admin.resources.quotaHint')} hintId={`${id}-hint`} error={error} errorId={`${id}-error`}>
      <input ref={input} inputMode="numeric" value={value} disabled={save.isPending} aria-invalid={!!error} aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`} onChange={(event) => { setValue(event.target.value); setError(undefined); save.reset(); }} />
    </FormField>
    {save.error ? <ActionNote tone="error">{errorMessage(save.error)}</ActionNote> : null}{save.isSuccess ? <ActionNote tone="success">{t('admin.resources.quotaSaved')}</ActionNote> : null}
    <ActionRow><Button type="submit" variant="primary" disabled={save.isPending || !dirty}>{t(save.isPending ? 'admin.profile.working' : 'admin.resources.saveQuota')}</Button>
      {dirty ? <InlineConfirm variant="ghost" label={t('admin.resources.discardQuotaAction')} question={t('admin.resources.discardQuota')} busy={save.isPending} onConfirm={onReload} /> : null}
    </ActionRow>
  </Stack></form>;
}
