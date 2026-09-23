import type { TraceChainDto } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useDateText } from '../../../shared/lib/useDateText';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import type { BadgeTone } from '../../../shared/ui/Badge';
import { Card } from '../../../shared/ui/Card';
import { CopyButton } from '../../../shared/ui/clipboard/CopyButton';
import { DefinitionList } from '../../../shared/ui/DefinitionList';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { useTraceChain, useUserNames } from '../hooks/useTraceReads';
import { statusTone } from '../model/traceView';
import { TraceTaskBlock } from './TraceTaskBlock';
import styles from './Trace.module.css';

const deliveryTone = (state: NonNullable<TraceChainDto['event']>['state']): BadgeTone => (state === 'dead' ? 'danger' : state === 'delivered' ? 'success' : 'info');

/** 右侧的分层回放：起点事件 → 各个任务 → Agent 执行；没选时说明怎么选，本项目没有这条链时写明原因。 */
export function TraceDetail({ projectId, traceId }: { readonly projectId: string; readonly traceId?: string }): ReactElement {
  const t = useT(), dateText = useDateText(), names = useUserNames(projectId);
  const chain = useTraceChain(projectId, traceId);
  const title = t('traces.detail.title');
  if (!traceId) return <Card compact title={title}><EmptyState title={t('traces.detail.placeholder')} /></Card>;
  if (chain.error?.status === 404) return <Card compact title={title}><EmptyState title={t('traces.detail.notFound')} description={t('traces.detail.notFoundHint')} /></Card>;
  const data = chain.data;
  return <Card stacked compact title={title} {...(data ? { extra: <Badge tone={statusTone(data.status)}>{t(`traces.status.${data.status}`)}</Badge> } : {})}>
    <QueryStatus isPending={chain.isPending} error={chain.error} />
    {data ? <>
      <DefinitionList items={[
        { label: t('traces.detail.traceId'), value: <span className={styles.nodeLine}><code className={styles.mono}>{data.traceId}</code><CopyButton value={data.traceId} /></span> },
        { label: t('traces.detail.started'), value: dateText(data.startedAt) },
        { label: t('traces.detail.lastActivity'), value: dateText(data.lastActivityAt) },
      ]} />
      {data.event ? <TraceOrigin event={data.event} /> : null}
      {data.tasks.map((task) => <TraceTaskBlock key={task.taskId} projectId={projectId} traceId={data.traceId} task={task} names={names} />)}
      {data.event && data.tasks.length === 0 ? <p className={styles.muted}>{t('traces.detail.noTasks')}</p> : null}
    </> : null}
  </Card>;
}

/** 起点事件：类型、投递结果与尝试次数；还在重试的写下次时间，失败的写最近一次错误。 */
function TraceOrigin({ event }: { readonly event: NonNullable<TraceChainDto['event']> }): ReactElement {
  const t = useT(), dateText = useDateText();
  return <section className={styles.section} aria-label={t('traces.detail.origin')}>
    <div className={styles.head}>
      <h3 className={styles.headTitle}>{t('traces.detail.origin')} · {t('traces.detail.eventTitle', { type: event.eventType })}</h3>
      <Badge tone={deliveryTone(event.state)}>{t(`traces.delivery.${event.state}`)}</Badge>
    </div>
    <p className={styles.facts}>
      <span className={styles.factPart}>{dateText(event.createdAt)}</span>
      <span className={styles.factPart}>{t('traces.delivery.attempts', { count: event.attempts })}</span>
      {event.deliveredAt ? <span className={styles.factPart}>{t('traces.detail.delivered', { time: dateText(event.deliveredAt) })}</span> : null}
      {event.nextAttemptAt && event.state !== 'delivered' && event.state !== 'dead' ? <span className={styles.factPart}>{t('traces.detail.nextAttempt', { time: dateText(event.nextAttemptAt) })}</span> : null}
    </p>
    {event.lastError ? <p className={styles.error}>{t('traces.detail.lastError', { error: event.lastError })}</p> : null}
  </section>;
}
