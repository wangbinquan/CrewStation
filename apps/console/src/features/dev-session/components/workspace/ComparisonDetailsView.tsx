import type { ComparisonDetailQuery, VersionComparisonDto } from '@crewstation/contracts';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { useApiQuery } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import { DataTable } from '../../../../shared/ui/DataTable';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { Tabs } from '../../../../shared/ui/Tabs';
import { PaneNotice } from '../PaneNotice';
import styles from './VersionComparisonPanel.module.css';

const tabs = ['ahead', 'behind', 'files', 'uncommitted'] as const;
export function ComparisonDetailsView({ projectId, comparisonId, comparison, onOpenFile }: { readonly projectId: string; readonly comparisonId: string; readonly comparison: VersionComparisonDto; readonly onOpenFile?: (path: string) => void }): ReactElement {
  const t = useT();
  const [selection, setSelection] = useState<ComparisonDetailQuery>({ tab: 'ahead' in comparison.commits ? 'ahead' : 'uncommitted', limit: 50 });
  const preview = comparison.deployment.target === 'preview';
  const unavailable = selection.tab === 'uncommitted' ? (comparison.workspace.status === 'unavailable' ? comparison.workspace.reason : undefined)
    : selection.tab === 'files' ? (comparison.files.status === 'unavailable' ? comparison.files.reason : undefined)
    : !('ahead' in comparison.commits) ? (comparison.commits.status === 'unavailable' ? comparison.commits.reason : t(preview && comparison.commits.status === 'undeployed' ? 'devSession.compare.previewUndeployed' : `devSession.compare.relation.${comparison.commits.status}`)) : undefined;
  const query = useApiQuery(queryKeys.comparisonDetails(projectId, comparisonId, selection.tab, selection.cursor, selection.path), () => api.devSession.versionComparisonDetails(projectId, comparisonId, selection), { enabled: unavailable === undefined });
  const data = unavailable === undefined ? query.data : undefined;
  return <Tabs label={t('devSession.compare.details')} items={tabs.map((tab) => ({ value: tab, label: t(`devSession.compare.${preview && tab !== 'uncommitted' ? 'previewTab' : 'tab'}.${tab}`) }))} value={selection.tab} onChange={(tab) => setSelection({ tab: tab as ComparisonDetailQuery['tab'], limit: 50 })}>
    {unavailable !== undefined ? <PaneNotice>{unavailable}</PaneNotice> : <QueryStatus isPending={query.isPending} error={query.error} />}
    {unavailable === undefined && query.error ? <PaneNotice tone="warning">{t('devSession.compare.staleHint')}</PaneNotice> : null}
    {data?.patch ? <>
      <Button variant="ghost" onClick={() => setSelection({ tab: selection.tab, limit: 50 })}>{t('devSession.compare.backFiles')}</Button>
      <p><code>{data.patch.path}</code>{data.patch.binary ? ` · ${t('devSession.compare.binary')}` : ''}</p>
      <pre className={styles.patch}>{data.patch.text}</pre>
      {data.patch.truncated ? <PaneNotice tone="warning">{t('devSession.compare.patchTruncated')}</PaneNotice> : null}
    </> : null}
    {data && !data.patch ? <>
      {selection.tab === 'ahead' || selection.tab === 'behind' ? <DataTable columns={['SHA', t('devSession.compare.subject')]}>
        {data.commits.map((commit) => <tr key={commit.sha}><td><code>{commit.sha.slice(0, 10)}</code></td><td>{commit.subject}</td></tr>)}
      </DataTable> : <DataTable columns={[t('devSession.compare.path'), t('devSession.compare.status'), t('devSession.compare.lines')]}>
        {data.files.map((file) => <tr key={file.path}><td><Button variant="ghost" onClick={() => setSelection({ ...selection, path: file.path })}>{file.originalPath ? `${file.originalPath} → ` : ''}{file.path}</Button>
          {onOpenFile && !file.binary && !file.status.includes('D') ? <Button variant="ghost" onClick={() => onOpenFile(file.path)}>{t('devSession.location.openFile')}</Button> : null}</td><td>{file.status}{file.untracked ? ` · ${t('devSession.compare.untracked')}` : ''}</td><td>{file.binary ? t('devSession.compare.binary') : `+${file.additions ?? '?'} −${file.deletions ?? '?'}`}</td></tr>)}
      </DataTable>}
      {data.commits.length === 0 && data.files.length === 0 ? <p>{t('devSession.compare.empty')}</p> : null}
      <div className={styles.actions}>
        {selection.cursor ? <Button onClick={() => setSelection({ tab: selection.tab, limit: 50 })}>{t('devSession.compare.first')}</Button> : null}
        {data.nextCursor ? <Button onClick={() => setSelection({ ...selection, cursor: data.nextCursor })}>{t('devSession.compare.next')}</Button> : null}
      </div>
      {data.truncated ? <PaneNotice tone="warning">{t('devSession.workspace.truncated')}</PaneNotice> : null}
    </> : null}
  </Tabs>;
}
