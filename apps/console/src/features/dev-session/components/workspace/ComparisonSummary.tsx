import type { VersionComparisonDto } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { Badge } from '../../../../shared/ui/Badge';
import { PaneNotice } from '../PaneNotice';
import styles from './VersionComparisonPanel.module.css';

export function ComparisonSummary({ comparison }: { readonly comparison: VersionComparisonDto }): ReactElement {
  const t = useT();
  const { workspace, deployment, commits, files } = comparison;
  return <div className={styles.summary}>
    <span>{t('devSession.compare.worktree')}: <code>{workspace.status === 'ready' ? `${workspace.branch ?? t('devSession.workspace.detached')} @ ${workspace.headSha?.slice(0, 10) ?? t('devSession.workspace.unborn')}` : t('devSession.compare.unknown')}</code></span>
    <span>{t('devSession.compare.production')}: <code>{deployment.status === 'ready' ? `${deployment.tag} @ ${deployment.commitSha.slice(0, 10)}` : t(`devSession.compare.${deployment.status}`)}</code></span>
    <Badge tone={commits.status === 'equal' ? 'success' : commits.status === 'unavailable' ? 'warning' : 'neutral'}>{t(`devSession.compare.relation.${commits.status}`)}</Badge>
    {'ahead' in commits ? <span>{t('devSession.compare.counts', { ahead: commits.ahead, behind: commits.behind })}</span> : null}
    {files.status === 'ready' ? <span>{t('devSession.compare.files', { count: files.count })}</span> : null}
    {workspace.status === 'ready' ? <>
      <span>{t('devSession.workspace.dirty', { count: workspace.uncommittedCount })}</span>
      <span>{workspace.unpushed.status === 'ready' ? t('devSession.workspace.unpushed', { count: workspace.unpushed.count }) : t('devSession.compare.upstreamUnknown')}</span>
      <span>{workspace.upstream.status === 'ready' ? t('devSession.compare.upstream', { name: workspace.upstream.name, ahead: workspace.upstream.ahead, behind: workspace.upstream.behind }) : t(`devSession.compare.upstream.${workspace.upstream.status}`)}</span>
    </> : <PaneNotice tone="warning">{workspace.reason}</PaneNotice>}
    {deployment.status === 'unavailable' ? <PaneNotice tone="warning">{deployment.reason}</PaneNotice> : null}
    {commits.status === 'unavailable' ? <PaneNotice tone="warning">{commits.reason}</PaneNotice> : null}
    {files.status === 'unavailable' && deployment.status === 'ready' ? <PaneNotice tone="warning">{files.reason}</PaneNotice> : null}
  </div>;
}
