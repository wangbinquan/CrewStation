import type { WorkspaceStatusDto } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useDateText } from '../../../../shared/lib/useDateText';
import { useT } from '../../../../shared/lib/useT';
import { Badge } from '../../../../shared/ui/Badge';
import { PaneNotice } from '../PaneNotice';
import styles from './WorkspaceInspection.module.css';

/** 只展示一次真实预检；未推送相对已知 remote refs，不能称为未上线。 */
export function WorkspaceInspection({ workspace }: { readonly workspace: WorkspaceStatusDto }): ReactElement {
  const t = useT();
  const dateText = useDateText();
  if (workspace.status === 'unavailable') return <PaneNotice tone="warning">{t('devSession.workspace.unavailable', { reason: workspace.reason })}</PaneNotice>;
  const unpushed = workspace.unpushed;
  return (
    <div className={styles.inspection}>
      <p><code>{workspace.branch ?? t('devSession.workspace.detached')} @ {workspace.headSha?.slice(0, 10) ?? t('devSession.workspace.unborn')}</code></p>
      <p className={styles.meta}>{t('devSession.workspace.checked', { at: dateText(workspace.checkedAt) })}</p>
      <p><Badge tone={workspace.uncommittedCount > 0 ? 'warning' : 'neutral'}>{t('devSession.workspace.dirty', { count: workspace.uncommittedCount })}</Badge></p>
      {workspace.uncommitted.length > 0 ? <ul className={styles.list}>
        {workspace.uncommitted.map((file) => <li key={file.path}><code>{file.index}{file.worktree} {file.originalPath ? `${file.originalPath} → ` : ''}{file.path}</code></li>)}
      </ul> : null}
      {workspace.uncommittedTruncated ? <p>{t('devSession.workspace.truncated')}</p> : null}
      {unpushed.status === 'unavailable' ? <PaneNotice tone="warning">{t('devSession.workspace.unpushedUnknown', { reason: unpushed.reason })}</PaneNotice> : <>
        <p><Badge tone={unpushed.count > 0 ? 'warning' : 'neutral'}>{t('devSession.workspace.unpushed', { count: unpushed.count })}</Badge></p>
        {unpushed.commits.length > 0 ? <ul className={styles.list}>
          {unpushed.commits.map((commit) => <li key={commit.sha}><code>{commit.sha.slice(0, 10)}</code> {commit.subject}</li>)}
        </ul> : null}
        {unpushed.truncated ? <p>{t('devSession.workspace.truncated')}</p> : null}
      </>}
      <p className={styles.meta}>{t('devSession.workspace.refsHint')}</p>
    </div>
  );
}
