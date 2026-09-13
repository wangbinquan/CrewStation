import { useState } from 'react';
import type { ReactElement } from 'react';
import { useDateText } from '../../../../shared/lib/useDateText';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import { Card } from '../../../../shared/ui/Card';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import type { TaskStreamChannel } from '../../hooks/useTaskStream';
import { useVersionComparison } from '../../hooks/useVersionComparison';
import { PaneNotice } from '../PaneNotice';
import { ComparisonDetailsView } from './ComparisonDetailsView';
import { ComparisonSummary } from './ComparisonSummary';
import styles from './VersionComparisonPanel.module.css';

export function VersionComparisonPanel({ projectId, taskId, channel, canDevelop, compact = false, initiallyExpanded = false }: { readonly projectId: string; readonly taskId: string; readonly channel: TaskStreamChannel; readonly canDevelop: boolean; readonly compact?: boolean; readonly initiallyExpanded?: boolean }): ReactElement {
  const t = useT();
  const date = useDateText();
  const { query, history } = useVersionComparison(projectId, taskId, channel);
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const data = query.data;
  if (compact) return <section className={styles.strip} aria-label={t('devSession.compare.title')}>
    {data ? <ComparisonSummary comparison={data} compact /> : <QueryStatus isPending={query.isPending} error={query.error} />}
    {data && (query.isError || query.isFetching || data.freshness === 'stale') ? <span title={date(data.checkedAt)}>{t('devSession.compare.staleHint')}</span> : null}
  </section>;
  return <Card compact className={styles.panel} title={t('devSession.compare.title')} extra={<>
    <Button variant="ghost" disabled={query.isFetching || history.isPending} onClick={() => void query.refetch()}>{t(query.isFetching ? 'devSession.compare.refreshing' : 'devSession.workspace.recheck')}</Button>
    <Button variant="ghost" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{t(expanded ? 'devSession.compare.collapse' : 'devSession.compare.details')}</Button>
  </>}>
    <QueryStatus isPending={query.isPending} error={query.error} />
    {data ? <>
      <ComparisonSummary comparison={data} />
      <p className={styles.meta}>{t('devSession.workspace.checked', { at: date(data.checkedAt) })}{query.isFetching || query.isError || data.freshness === 'stale' ? ` · ${t('devSession.compare.staleHint')}` : ''}</p>
      {expanded ? <>
        <p className={styles.meta}>{t('devSession.workspace.refsHint')}</p>
        <p className={styles.meta}>{t('devSession.compare.historyHint')}</p>
        <Button onClick={() => history.mutate(undefined)} disabled={!canDevelop || history.isPending || query.isFetching}>{t(history.isPending ? 'devSession.compare.historyPending' : 'devSession.compare.history')}</Button>
        <QueryStatus isPending={false} error={history.error} />
        {data.comparisonId && data.freshness === 'current' ? <ComparisonDetailsView projectId={projectId} comparisonId={data.comparisonId} comparison={data} /> : <PaneNotice tone="warning">{t('devSession.compare.staleHint')}</PaneNotice>}
      </> : null}
    </> : null}
  </Card>;
}
