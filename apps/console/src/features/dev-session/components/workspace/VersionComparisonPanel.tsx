import { useState } from 'react';
import type { ReactElement } from 'react';
import type { ComparisonTarget } from '@crewstation/contracts';
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

export function VersionComparisonPanel({ projectId, taskId, channel, canDevelop, compact = false, initiallyExpanded = false, target = 'prod', onTargetChange, onOpenFile }: {
  readonly projectId: string; readonly taskId: string; readonly channel: TaskStreamChannel; readonly canDevelop: boolean; readonly compact?: boolean; readonly initiallyExpanded?: boolean;
  readonly target?: ComparisonTarget; readonly onTargetChange?: (target: ComparisonTarget) => void; readonly onOpenFile?: (path: string) => void;
}): ReactElement {
  const t = useT();
  const date = useDateText();
  const { query, history } = useVersionComparison(projectId, taskId, channel, target);
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const data = query.data;
  if (compact) return <section className={styles.strip} aria-label={t('devSession.compare.title')}>
    {data ? <ComparisonSummary comparison={data} compact /> : <QueryStatus isPending={query.isPending} error={query.error} />}
    {data && (query.isError || query.isFetching || data.freshness === 'stale') ? <span title={date(data.checkedAt)}>{t('devSession.compare.staleHint')}</span> : null}
  </section>;
  return <Card compact className={styles.panel} title={t(target === 'preview' ? 'devSession.compare.previewTitle' : 'devSession.compare.title')} extra={<>
    {onTargetChange ? <select aria-label={t('devSession.compare.target')} value={target} disabled={history.isPending} onChange={(e) => onTargetChange(e.target.value as ComparisonTarget)}>
      <option value="prod">{t('devSession.compare.production')}</option><option value="preview">{t('devSession.compare.preview')}</option></select> : null}
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
        {data.comparisonId && data.freshness === 'current' ? <ComparisonDetailsView key={data.comparisonId} projectId={projectId} comparisonId={data.comparisonId} comparison={data} onOpenFile={onOpenFile} /> : <PaneNotice tone="warning">{t('devSession.compare.staleHint')}</PaneNotice>}
      </> : null}
    </> : null}
  </Card>;
}
