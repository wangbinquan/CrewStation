import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { Button } from '../../../shared/ui/Button';
import { ActionRow } from '../../../shared/ui/ActionRow';
import { DataTable } from '../../../shared/ui/DataTable';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { ConfirmationDialog } from '../../../shared/ui/dialog/ConfirmationDialog';
import { DefinitionList } from '../../../shared/ui/DefinitionList';
import { UnsavedChangesGuard } from '../../../shared/navigation/UnsavedChangesGuard';
import { useAlertSubscriptions } from '../hooks/useAlertSubscriptions';
import { AlertSubscriptionDialog } from './AlertSubscriptionDialog';

/**
 * 通知订阅：列表在卡片里；添加与编辑是弹窗，提交前的重读核对、移除确认与「换一份配置」的确认也是弹窗（2026-09-23）。
 * 草稿关窗不丢，再点同一个入口恢复；离开本页才进离开确认。
 */
export function AlertSubscriptionsCard({ projectId, canManage }: { readonly projectId: string; readonly canManage: boolean }) {
  const t = useT(), p = useAlertSubscriptions(projectId, canManage), review = p.review;
  const target = review?.kind === 'save' ? review.input : review?.before;
  // 订阅是一张列表：「添加订阅」在卡片头，行内「修改」「移除」紧凑描边、移除为红色（2026-09-23 裁定）。
  return <Card stacked compact title={t('logs.alerts.subscription.title')} extra={canManage ? <Button variant="primary" disabled={p.busy || !!review} onClick={() => p.start()}>{t('logs.alerts.subscription.add')}</Button> : undefined}>
    <UnsavedChangesGuard dirty={p.dirty || p.busy} scope={t('logs.alerts.subscription.form')} allowNavigate={(current, next) => current.pathname === next.pathname && 'tab' in next.search && next.search.tab === 'alerts'} />
    <ActionNote tone="neutral">{t('logs.alerts.subscription.deliveryUnavailable')}</ActionNote>
    <QueryStatus isPending={p.query.isPending} error={p.query.error} />
    {!p.unavailable && p.query.data?.items.length === 0 ? <p>{t('logs.alerts.subscription.empty')}</p> : null}
    {!p.unavailable && p.query.data?.items.length ? <DataTable columns={[t('logs.alerts.subscription.member'), t('logs.alerts.subscription.channel'), t('logs.alerts.subscription.target'), t('logs.alerts.actions')]}>
      {p.query.data.items.map((row) => <tr key={row.userId}><td>{p.name(row.userId)}</td><td>{t(`logs.alerts.channel.${row.channel}`)}</td><td>{row.target ?? '—'}</td><td>{canManage ? <ActionRow>
        <Button size="small" disabled={p.busy || !!review} onClick={() => p.start(row)}>{t('logs.alerts.subscription.edit', { name: p.name(row.userId) })}</Button><Button size="small" variant="danger" disabled={p.busy || !!review} onClick={() => void p.prepare(row)}>{t('logs.alerts.subscription.remove', { name: p.name(row.userId) })}</Button>
      </ActionRow> : '—'}</td></tr>)}
    </DataTable> : null}
    {canManage ? null : <p>{t('logs.alerts.subscription.noPermission')}</p>}
    {p.open ? <AlertSubscriptionDialog p={p} /> : null}
    {review && target ? <ConfirmationDialog size="medium" question={t(review.kind === 'save' ? 'logs.alerts.subscription.saveQuestion' : 'logs.alerts.subscription.removeQuestion', { name: p.name(target.userId) })} hint={t('logs.alerts.subscription.replaceHint')} confirmLabel={t(review.kind === 'save' ? 'logs.alerts.subscription.save' : 'logs.alerts.subscription.confirmRemove')} cancelLabel={t('logs.alerts.cancel')} busy={p.busy} confirmDisabled={p.stale || !canManage} danger={review.kind === 'remove'} onConfirm={() => void p.confirm()} onCancel={() => p.setReview(undefined)}>
      <DefinitionList items={[{ label: t('logs.alerts.subscription.userId'), value: <code>{target.userId}</code> }, { label: t('logs.alerts.subscription.channel'), value: t(`logs.alerts.channel.${target.channel}`) }, { label: t('logs.alerts.subscription.target'), value: target.target ?? '—' }, ...(review.kind === 'save' && review.before ? [{ label: t('logs.alerts.subscription.before'), value: `${t(`logs.alerts.channel.${review.before.channel}`)} · ${review.before.target || '—'}` }] : [])]} />
      {p.stale ? <ActionNote tone="error">{t('logs.alerts.subscription.changed')}</ActionNote> : null}
    </ConfirmationDialog> : null}
    {p.replacement ? <ConfirmationDialog question={t('logs.alerts.subscription.replaceDraft')} confirmLabel={t('logs.alerts.subscription.discard')} cancelLabel={t('logs.alerts.subscription.keep')} focus="cancel" onConfirm={() => p.apply(p.replacement?.record)} onCancel={() => { p.setReplacement(undefined); p.resume(); }} /> : null}
    {p.error && !p.open ? <ActionNote tone="error">{p.error} {t('logs.alerts.subscription.retryHint')}</ActionNote> : null}
    {p.success ? <ActionNote tone="success">{p.success}</ActionNote> : null}
  </Card>;
}
