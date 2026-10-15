import { useState } from 'react';
import { DeveloperAccessPageSchema, DeveloperAccessRequestDtoSchema } from '@crewstation/contracts';
import type { DeveloperAccessRequestDto } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { useApiMutation, useApiQuery, errorMessage } from '../../../shared/api/useApi';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { Button } from '../../../shared/ui/Button';
import { DataTable } from '../../../shared/ui/DataTable';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { FormField } from '../../../shared/ui/FormField';
import { FormDialog } from '../../../shared/ui/dialog/FormDialog';

interface ReviewDraft { decision: 'approved' | 'rejected'; note: string }
const emptyDraft: ReviewDraft = { decision: 'approved', note: '' };
export function DeveloperAccessReview() {
  const t = useT(), [state, setState] = useState<'pending' | 'approved' | 'rejected'>('pending'), [cursor, setCursor] = useState<string>(), [selected, setSelected] = useState<DeveloperAccessRequestDto>();
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({});
  const key = ['developer-access', state, cursor], query = useApiQuery(key, async () => DeveloperAccessPageSchema.parse(await api.users.developerAccess({ state, cursor, limit: 20 })), { refetchIntervalMs: 15_000 });
  return <Card stacked title={t('admin.developer.title')}>
    <label>{t('admin.developer.status')} <select value={state} onChange={event => { setState(event.target.value as typeof state); setCursor(undefined); }}>{(['pending', 'approved', 'rejected'] as const).map(value => <option key={value} value={value}>{t(`projects.developer.state.${value}`)}</option>)}</select></label>
    <QueryStatus isPending={query.isPending} error={query.error} />
    <DataTable columns={[t('admin.developer.applicant'), t('projects.developer.reason'), t('admin.developer.status'), t('catalog.details')]}>
      {query.data?.items.map(item => <tr key={item.id}><td>{item.userName}<br />{item.userEmail}</td><td>{item.reason}</td><td>{t(`projects.developer.state.${item.state}`)}</td><td><Button size="small" disabled={!!query.error} onClick={() => setSelected(item)}>{t('catalog.details')}</Button></td></tr>)}
    </DataTable>
    {!query.isPending && !query.error && !query.data?.items.length ? <p>{t('admin.developer.empty')}</p> : null}
    <div><Button disabled={!cursor || query.isPending} onClick={() => setCursor(undefined)}>{t('catalog.first')}</Button> <Button disabled={!query.data?.nextCursor || !!query.error || query.isPending} onClick={() => setCursor(query.data?.nextCursor)}>{t('catalog.next')}</Button></div>
    {selected ? <ReviewDialog request={selected} draft={drafts[selected.id] ?? emptyDraft} onEdit={draft => setDrafts(current => ({ ...current, [selected.id]: draft }))} onSuccess={() => { setDrafts(current => { const next = { ...current }; delete next[selected.id]; return next; }); setSelected(undefined); }} onClose={() => setSelected(undefined)} /> : null}
  </Card>;
}
function ReviewDialog({ request, draft, onEdit, onClose, onSuccess }: { readonly request: DeveloperAccessRequestDto; readonly draft: ReviewDraft; readonly onEdit: (draft: ReviewDraft) => void; readonly onClose: () => void; readonly onSuccess: () => void }) {
  const t = useT(), { decision, note } = draft;
  const review = useApiMutation(async () => DeveloperAccessRequestDtoSchema.parse(await api.users.reviewDeveloperAccess(request.id, { decision, note, expectedRevision: request.revision })), { invalidate: [['developer-access'], queryKeys.users()], onSuccess });
  return <FormDialog title={t('admin.developer.review')} submitLabel={t('admin.developer.submit')} busy={review.isPending} submitDisabled={request.state !== 'pending' || !note.trim()} onClose={onClose} onSubmit={() => review.mutate()} error={review.error ? errorMessage(review.error) : undefined}>
    <p>{request.userName} · {request.userEmail}</p><p>{request.reason}</p>
    {request.state === 'pending' ? <>
      <FormField label={t('admin.developer.decision')}><select value={decision} onChange={event => onEdit({ ...draft, decision: event.target.value as typeof decision })} disabled={review.isPending}><option value="approved">{t('admin.developer.approve')}</option><option value="rejected">{t('admin.developer.reject')}</option></select></FormField>
      <p>{t('admin.developer.effect')}</p><FormField label={t('admin.developer.note')}><textarea value={note} maxLength={500} rows={3} disabled={review.isPending} onChange={event => onEdit({ ...draft, note: event.target.value })} /></FormField>
    </> : <p>{t(`projects.developer.state.${request.state}`)} · {request.note}</p>}
  </FormDialog>;
}
