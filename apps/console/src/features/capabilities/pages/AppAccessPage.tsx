import type { AppAccessStatusDto } from '@crewstation/contracts';
import { AppAccessRequestDtoSchema, AppAccessStatusDtoSchema } from '@crewstation/contracts';
import { useParams } from '@tanstack/react-router';
import { useId, useState } from 'react';
import type { ReactElement } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { errorMessage, useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { useDateText } from '../../../shared/lib/useDateText';
import { useT } from '../../../shared/lib/useT';
import { UnsavedChangesGuard } from '../../../shared/navigation/UnsavedChangesGuard';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { ActionRow } from '../../../shared/ui/ActionRow';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { FormField } from '../../../shared/ui/FormField';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { ButtonLink, ExternalButtonLink } from '../../../shared/ui/navigation/ButtonLink';
import { marketHref } from '../components/market/marketHref';

/**
 * 申请访问权限（2026-09-24 裁定）：网关的「没有项目权限」页上点「申请访问权限」新开到这里。理由可选，提交后等负责人或管理员处理；
 * 待处理时每 15 秒自动重读，批准后给「打开应用」。负责人没开放申请（或是接入容器）时只写负责人的名字。
 */
export function AppAccessPage(): ReactElement {
  const t = useT(), { projectId = '' } = useParams({ strict: false });
  const me = useApiQuery(queryKeys.me(), () => api.me.get()), userId = me.data?.id ?? '';
  const status = useApiQuery(queryKeys.appAccess(projectId, userId), async () => AppAccessStatusDtoSchema.parse(await api.projects.getAppAccess(projectId)), {
    enabled: Boolean(me.data && projectId), refetchOnWindowFocus: true,
    refetchIntervalMs: (data) => (data && !data.granted && data.latest?.state === 'pending' ? 15_000 : undefined),
  });
  return <>
    <PageHeader title={t('market.access.title')} />
    <QueryStatus isPending={me.isPending || status.isPending} error={me.error ?? status.error} />
    {status.data ? <AccessStatusCard key={`${userId}:${projectId}`} status={status.data} userId={userId} /> : null}
  </>;
}

function AccessStatusCard({ status, userId }: { readonly status: AppAccessStatusDto; readonly userId: string }): ReactElement {
  const t = useT(), dateText = useDateText(), id = useId(), [reason, setReason] = useState(''), [touched, setTouched] = useState(false);
  const submit = useApiMutation(async (input: { reason?: string }) => AppAccessRequestDtoSchema.parse(await api.projects.requestAppAccess(status.projectId, input)), {
    invalidate: [queryKeys.appAccess(status.projectId, userId)], onSuccess: () => { setReason(''); setTouched(false); },
  });
  const latest = status.latest, href = marketHref(status.appHost), tooLong = reason.trim().length > 500;
  const send = () => { setTouched(true); if (!tooLong && !submit.isPending) submit.mutate(reason.trim() ? { reason: reason.trim() } : {}); };
  const open = !status.granted && latest?.state !== 'pending' && status.allowRequests;
  return <Card stacked>
    <UnsavedChangesGuard dirty={reason.length > 0 || submit.isPending} scope={t('market.access.reason')} />
    <strong>{t(status.granted ? 'market.access.granted' : 'market.access.noAccess', { name: status.name })}</strong>
    <p>{t('market.access.owner', { name: status.owner.name })}</p>
    {status.granted ? <p>{t('market.access.grantedHint')}</p> : null}
    {!status.granted && latest?.state === 'pending' ? <ActionNote tone="neutral"><strong>{t('market.access.pending')}</strong> {t('market.access.pendingAt', { time: dateText(latest.createdAt) })}</ActionNote> : null}
    {!status.granted && latest?.state !== 'pending' && !status.allowRequests ? <ActionNote tone="neutral">{t('market.access.closed', { name: status.owner.name })}</ActionNote> : null}
    {open && latest?.state === 'rejected' ? <ActionNote tone="neutral"><strong>{t('market.access.rejected')}</strong> {t('market.access.rejectedAt', { time: dateText(latest.decidedAt) })}
      {latest.decision ? <> {t('market.access.decision', { decision: latest.decision })}</> : null}</ActionNote> : null}
    {open ? <form noValidate onSubmit={(event) => { event.preventDefault(); send(); }}>
      <FormField label={t('market.access.reason')} hint={t('market.access.reasonHint')} hintId={`${id}-hint`} error={touched && tooLong ? t('market.access.reasonTooLong') : undefined} errorId={`${id}-error`}>
        <textarea rows={4} value={reason} disabled={submit.isPending} aria-invalid={touched && tooLong} aria-describedby={`${id}-hint`} onChange={(event) => setReason(event.target.value)} />
      </FormField>
      {submit.isError ? <ActionNote tone="error">{t('market.access.submitError', { message: errorMessage(submit.error) })}</ActionNote> : null}
      <ActionRow><Button type="submit" variant="primary" disabled={submit.isPending}>{t(submit.isPending ? 'market.access.submitting' : latest?.state === 'rejected' ? 'market.access.again' : 'market.access.submit')}</Button></ActionRow>
    </form> : null}
    <ActionRow>
      {status.granted && href ? <ExternalButtonLink variant="primary" href={href}>{t('market.access.openApp')}</ExternalButtonLink> : null}
      <ButtonLink to="/market">{t('market.access.backToMarket')}</ButtonLink>
    </ActionRow>
  </Card>;
}
