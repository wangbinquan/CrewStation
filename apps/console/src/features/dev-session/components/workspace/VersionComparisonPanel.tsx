import { useState } from 'react';
import type { ReactElement } from 'react';
import type { ComparisonTarget } from '@crewstation/contracts';
import { useDateText } from '../../../../shared/lib/useDateText';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import type { TaskStreamChannel } from '../../hooks/useTaskStream';
import { useVersionComparison } from '../../hooks/useVersionComparison';
import { PaneNotice } from '../PaneNotice';
import { ComparisonDetailsView } from './ComparisonDetailsView';
import { ComparisonSummary } from './ComparisonSummary';
import styles from './VersionComparisonPanel.module.css';

export function VersionComparisonPanel({ projectId, taskId, channel, canDevelop, compact = false, initiallyExpanded = false, target = 'prod', onTargetChange, onOpenFile, onDetails }: {
  readonly projectId: string; readonly taskId: string; readonly channel: TaskStreamChannel; readonly canDevelop: boolean; readonly compact?: boolean; readonly initiallyExpanded?: boolean;
  readonly target?: ComparisonTarget; readonly onTargetChange?: (target: ComparisonTarget) => void; readonly onOpenFile?: (path: string) => void;
  /** 紧凑状态条上的「查看变更」：打开变更面板。 */ readonly onDetails?: () => void;
}): ReactElement {
  const t = useT();
  const date = useDateText();
  // 对照每 10 秒、回到前台与文件变更后自动重读，不给「重新检查」（2026-09-23 裁定）；「补齐历史并重算」是服务端重算，保留。
  const { query, history } = useVersionComparison(projectId, taskId, channel, target);
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const data = query.data;
  if (compact) return <section className={styles.strip} aria-label={t('devSession.compare.title')}>
    {data ? <ComparisonSummary comparison={data} compact /> : <QueryStatus isPending={query.isPending} error={query.error} />}
    {onDetails ? <Button variant="ghost" size="small" onClick={onDetails}>{t('devSession.compare.viewDetails')}</Button> : null}
    {data && (query.isError || data.freshness === 'stale') ? <span title={`${date(data.checkedAt)} · ${t('devSession.compare.staleHint')}`}>{t('devSession.compare.staleShort')}</span> : null}
  </section>;
  // 变更页签直接铺满：操作钉在顶端，只有下面的内容滚动（2026-09-23，不再内嵌卡片）。
  return <section className={styles.panel} aria-label={t(target === 'preview' ? 'devSession.compare.previewTitle' : 'devSession.compare.title')}>
    <header className={styles.toolbar}>
      {onTargetChange ? <label className={styles.target}>{t('devSession.compare.target')}<select value={target} disabled={history.isPending} onChange={(e) => onTargetChange(e.target.value as ComparisonTarget)}>
        <option value="prod">{t('devSession.compare.production')}</option><option value="preview">{t('devSession.compare.preview')}</option></select></label> : null}
      <Button size="small" title={t('devSession.compare.historyHint')} onClick={() => history.mutate(undefined)} disabled={!canDevelop || history.isPending}>{t(history.isPending ? 'devSession.compare.historyPending' : 'devSession.compare.history')}</Button>
      <Button size="small" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{t(expanded ? 'devSession.compare.collapse' : 'devSession.compare.details')}</Button>
    </header>
    <div className={styles.body}>
      <QueryStatus isPending={query.isPending} error={query.error} />
      <QueryStatus isPending={false} error={history.error} />
      {data ? <>
        <ComparisonSummary comparison={data} />
        <p className={styles.meta}>{t('devSession.workspace.checked', { at: date(data.checkedAt) })}{query.isError || data.freshness === 'stale' ? ` · ${t('devSession.compare.staleHint')}` : ''}</p>
        {expanded ? <>
          <p className={styles.meta}>{t('devSession.workspace.refsHint')}</p>
          {data.comparisonId && data.freshness === 'current' ? <ComparisonDetailsView key={`${projectId}:${taskId}:${target}`} projectId={projectId} comparisonId={data.comparisonId} comparison={data} onOpenFile={onOpenFile} /> : <PaneNotice tone="warning">{t('devSession.compare.staleHint')}</PaneNotice>}
        </> : null}
      </> : null}
    </div>
  </section>;
}
