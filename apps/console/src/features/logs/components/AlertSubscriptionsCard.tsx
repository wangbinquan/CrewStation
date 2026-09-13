import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { Button } from '../../../shared/ui/Button';
import { DataTable } from '../../../shared/ui/DataTable';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { ConfirmationPanel } from '../../../shared/ui/ConfirmationPanel';
import { DefinitionList } from '../../../shared/ui/DefinitionList';
import { UnsavedChangesGuard } from '../../../shared/navigation/UnsavedChangesGuard';
import { useAlertSubscriptions } from '../hooks/useAlertSubscriptions';
import { AlertSubscriptionForm } from './AlertSubscriptionForm';

export function AlertSubscriptionsCard({ projectId, canManage }: { readonly projectId: string; readonly canManage: boolean }) {
  const t = useT(), p = useAlertSubscriptions(projectId, canManage), review = p.review;
  const target = review?.kind === 'save' ? review.input : review?.before;
  return <Card compact title={t('logs.alerts.subscription.title')} extra={<Button disabled={p.busy || p.query.isFetching} onClick={() => void p.query.refetch()}>{t('logs.alerts.subscription.refresh')}</Button>}>
    <UnsavedChangesGuard dirty={p.dirty || p.busy} scope={t('logs.alerts.subscription.form')} allowNavigate={(current, next) => current.pathname === next.pathname && 'tab' in next.search && next.search.tab === 'alerts'} />
    <ActionNote tone="neutral">{t('logs.alerts.subscription.deliveryUnavailable')}</ActionNote>
    <QueryStatus isPending={p.query.isPending} error={p.query.error} />
    {!p.unavailable && p.query.data?.items.length === 0 ? <p>{t('logs.alerts.subscription.empty')}</p> : null}
    {!p.unavailable && p.query.data?.items.length ? <DataTable columns={[t('logs.alerts.subscription.member'), t('logs.alerts.subscription.channel'), t('logs.alerts.subscription.target'), t('logs.alerts.actions')]}>
      {p.query.data.items.map((row) => <tr key={row.userId}><td>{p.name(row.userId)}</td><td>{t(`logs.alerts.channel.${row.channel}`)}</td><td>{row.target ?? '—'}</td><td>{canManage ? <>
        <Button disabled={p.busy || !!review} onClick={() => p.start(row)}>{t('logs.alerts.subscription.edit', { name: p.name(row.userId) })}</Button><Button disabled={p.busy || !!review} onClick={() => void p.prepare(row)}>{t('logs.alerts.subscription.remove', { name: p.name(row.userId) })}</Button>
      </> : '—'}</td></tr>)}
    </DataTable> : null}
    {canManage ? <Button disabled={p.busy || !!review} onClick={() => p.start()}>{t('logs.alerts.subscription.add')}</Button> : <p>{t('logs.alerts.subscription.noPermission')}</p>}
    {p.open ? <AlertSubscriptionForm p={p} /> : null}
    {!p.open && p.dirty ? <ActionNote tone="neutral">{t('logs.alerts.subscription.unsaved')} <Button onClick={p.resume}>{t('logs.alerts.subscription.resume')}</Button></ActionNote> : null}
    {review && target ? <ConfirmationPanel question={t(review.kind === 'save' ? 'logs.alerts.subscription.saveQuestion' : 'logs.alerts.subscription.removeQuestion', { name: p.name(target.userId) })} hint={t('logs.alerts.subscription.replaceHint')} confirmLabel={t(review.kind === 'save' ? 'logs.alerts.subscription.save' : 'logs.alerts.subscription.confirmRemove')} cancelLabel={t('logs.alerts.cancel')} busy={p.busy} confirmDisabled={p.stale || !canManage} onConfirm={() => void p.confirm()} onCancel={() => p.setReview(undefined)}>
      <DefinitionList items={[{ label: t('logs.alerts.subscription.userId'), value: <code>{target.userId}</code> }, { label: t('logs.alerts.subscription.channel'), value: t(`logs.alerts.channel.${target.channel}`) }, { label: t('logs.alerts.subscription.target'), value: target.target ?? '—' }, ...(review.kind === 'save' && review.before ? [{ label: t('logs.alerts.subscription.before'), value: `${t(`logs.alerts.channel.${review.before.channel}`)} · ${review.before.target || '—'}` }] : [])]} />
      {p.stale ? <ActionNote tone="error">{t('logs.alerts.subscription.changed')}</ActionNote> : null}
    </ConfirmationPanel> : null}
    {p.replacement ? <ConfirmationPanel question={t('logs.alerts.subscription.replaceDraft')} confirmLabel={t('logs.alerts.subscription.discard')} cancelLabel={t('logs.alerts.subscription.keep')} onConfirm={() => p.apply(p.replacement?.record)} onCancel={() => p.setReplacement(undefined)} /> : null}
    {p.error ? <ActionNote tone="error">{p.error} {t('logs.alerts.subscription.retryHint')}</ActionNote> : null}
    {p.success ? <ActionNote tone="success">{p.success}</ActionNote> : null}
  </Card>;
}
