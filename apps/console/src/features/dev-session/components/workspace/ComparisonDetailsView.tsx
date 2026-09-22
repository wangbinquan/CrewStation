import type { ComparisonDetailQuery, VersionComparisonDto } from '@crewstation/contracts';
import { useId, useState } from 'react';
import type { ReactElement } from 'react';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { useApiQuery } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import { DataTable } from '../../../../shared/ui/DataTable';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { comparisonFileStatus } from '../../model/comparisonFileStatus';
import { PaneNotice } from '../PaneNotice';
import styles from './VersionComparisonPanel.module.css';

type Group = ComparisonDetailQuery['tab'];
const GROUPS: readonly Group[] = ['ahead', 'behind', 'files', 'uncommitted'];

/** 四组改动是同一列表上的分组标题（RFC-020 design §5.3），不再嵌页签：标题是可展开的按钮，每组展开时才读取自己的那一页。 */
export function ComparisonDetailsView({ projectId, comparisonId, comparison, onOpenFile }: { readonly projectId: string; readonly comparisonId: string; readonly comparison: VersionComparisonDto; readonly onOpenFile?: (path: string) => void }): ReactElement {
  const t = useT(), id = useId(), preview = comparison.deployment.target === 'preview';
  const first: Group = 'ahead' in comparison.commits ? 'ahead' : 'uncommitted';
  const [open, setOpen] = useState<Record<Group, boolean>>({ ahead: first === 'ahead', behind: false, files: false, uncommitted: first === 'uncommitted' });
  const count = (group: Group): number | undefined => group === 'ahead' || group === 'behind' ? ('ahead' in comparison.commits ? comparison.commits[group] : undefined) : group === 'files' ? (comparison.files.status === 'ready' ? comparison.files.count : undefined) : comparison.workspace.status === 'ready' ? comparison.workspace.uncommittedCount : undefined;
  const unavailable = (group: Group): string | undefined => group === 'uncommitted' ? (comparison.workspace.status === 'unavailable' ? comparison.workspace.reason : undefined)
    : group === 'files' ? (comparison.files.status === 'unavailable' ? comparison.files.reason : undefined)
    : !('ahead' in comparison.commits) ? (comparison.commits.status === 'unavailable' ? comparison.commits.reason : t(preview && comparison.commits.status === 'undeployed' ? 'devSession.compare.previewUndeployed' : `devSession.compare.relation.${comparison.commits.status}`)) : undefined;
  return <div className={styles.groups}>
    {GROUPS.map((group) => {
      const label = t(`devSession.compare.${preview && group !== 'uncommitted' ? 'previewTab' : 'tab'}.${group}`), total = count(group);
      return <section key={group} className={styles.group}>
        <h4 className={styles.groupTitle}><button type="button" className={styles.groupToggle} aria-expanded={open[group]} aria-controls={`${id}-${group}`} onClick={() => setOpen((current) => ({ ...current, [group]: !current[group] }))}>{label}</button>{total !== undefined ? <span className={styles.groupCount}>· {total}</span> : null}</h4>
        {open[group] ? <div id={`${id}-${group}`} role="region" aria-label={label}><ComparisonGroup projectId={projectId} comparisonId={comparisonId} group={group} unavailable={unavailable(group)} onOpenFile={onOpenFile} /></div> : null}
      </section>;
    })}
  </div>;
}

function ComparisonGroup({ projectId, comparisonId, group, unavailable, onOpenFile }: { readonly projectId: string; readonly comparisonId: string; readonly group: Group; readonly unavailable?: string; readonly onOpenFile?: (path: string) => void }): ReactElement {
  const t = useT();
  // 分页游标只对产生它的快照有效：新比较到来时保留正在阅读的文件，丢掉旧游标（十秒重查不能把读者拉回第一页，也不能拿旧游标去查新快照）。
  const [selection, setSelection] = useState<{ comparisonId: string; cursor?: string; path?: string }>({ comparisonId });
  const cursor = selection.comparisonId === comparisonId ? selection.cursor : undefined;
  const input: ComparisonDetailQuery = { tab: group, limit: 50, ...(cursor ? { cursor } : {}), ...(selection.path ? { path: selection.path } : {}) };
  const query = useApiQuery(queryKeys.comparisonDetails(projectId, comparisonId, group, cursor, selection.path), () => api.devSession.versionComparisonDetails(projectId, comparisonId, input), { enabled: unavailable === undefined });
  const data = unavailable === undefined ? query.data : undefined;
  return <>
    {unavailable !== undefined ? <PaneNotice>{unavailable}</PaneNotice> : <QueryStatus isPending={query.isPending} error={query.error} />}
    {unavailable === undefined && query.error ? <PaneNotice tone="warning">{t('devSession.compare.staleHint')}</PaneNotice> : null}
    {selection.path ? <Button variant="ghost" onClick={() => setSelection({ comparisonId })}>{t('devSession.compare.backFiles')}</Button> : null}
    {data?.patch ? <>
      <p><code>{data.patch.path}</code>{data.patch.binary ? ` · ${t('devSession.compare.binary')}` : ''}</p>
      <pre className={styles.patch}>{data.patch.text}</pre>
      {data.patch.truncated ? <PaneNotice tone="warning">{t('devSession.compare.patchTruncated')}</PaneNotice> : null}
    </> : null}
    {data && !data.patch ? <>
      {group === 'ahead' || group === 'behind' ? <DataTable columns={['SHA', t('devSession.compare.subject')]}>
        {data.commits.map((commit) => <tr key={commit.sha}><td><code>{commit.sha.slice(0, 10)}</code></td><td>{commit.subject}</td></tr>)}
      </DataTable> : <DataTable columns={[t('devSession.compare.path'), t('devSession.compare.status'), t('devSession.compare.lines')]}>
        {data.files.map((file) => <tr key={file.path}><td><Button variant="ghost" className={styles.filePath} onClick={() => setSelection({ comparisonId, path: file.path })}>{file.originalPath ? `${file.originalPath} → ` : ''}{file.path}</Button>
          {onOpenFile && !file.binary && !file.status.includes('D') ? <Button variant="ghost" onClick={() => onOpenFile(file.path)}>{t('devSession.location.openFile')}</Button> : null}</td><td title={`Git: ${file.status}`}>{comparisonFileStatus(file, t)}</td><td>{file.binary ? t('devSession.compare.binary') : `+${file.additions ?? '?'} −${file.deletions ?? '?'}`}</td></tr>)}
      </DataTable>}
      {data.commits.length === 0 && data.files.length === 0 ? <p>{t('devSession.compare.empty')}</p> : null}
      <div className={styles.actions}>
        {cursor ? <Button onClick={() => setSelection({ comparisonId, path: selection.path })}>{t('devSession.compare.first')}</Button> : null}
        {data.nextCursor ? <Button onClick={() => setSelection({ comparisonId, cursor: data.nextCursor, path: selection.path })}>{t('devSession.compare.next')}</Button> : null}
      </div>
      {data.truncated ? <PaneNotice tone="warning">{t('devSession.workspace.truncated')}</PaneNotice> : null}
    </> : null}
  </>;
}
