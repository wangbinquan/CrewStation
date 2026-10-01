import type { RuntimeStatistics } from '@crewstation/contracts';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { Button } from '../../../shared/ui/Button';
import { ActionRow } from '../../../shared/ui/ActionRow';
import { DataTable } from '../../../shared/ui/DataTable';
import type { RuntimeSearch } from '../model/runtimeSearch';
import { runtimeSourceLabel, runtimeTokens, runtimeCny } from '../model/runtimeFormat';
import styles from './RuntimeStatistics.module.css';

interface FilterProps { search: RuntimeSearch; change: (search: RuntimeSearch) => void }
export function RuntimeSourceFilter({ search, change }: FilterProps) {
  const t = useT(); return <ActionRow role="group" aria-label={t('runtime.source.title')}>
    {([undefined, 'business-task', 'development-agent'] as const).map((kind) => <Button key={kind ?? 'all'} size="small" variant="ghost" aria-pressed={search.sourceKind === kind}
      onClick={() => change({ ...search, sourceKind: kind, agent: undefined, profile: undefined })}>{kind ? runtimeSourceLabel(kind, t) : t('runtime.source.all')}</Button>)}
  </ActionRow>;
}
export function RuntimeSources({ data, search, change }: FilterProps & { data: RuntimeStatistics }) {
  const t = useT(); if (!data.sources) return null;
  return <Card title={t('runtime.source.title')} footer={t('runtime.source.hint')} stacked>
    <DataTable className={styles.table} columns={['source.title', 'objects', 'input', 'cacheRead', 'cacheWrite', 'output', 'tokens', 'cost', 'source.collection'].map((key) => t('runtime.' + key))}>
      {data.sources.map((row) => <tr key={row.kind} data-runtime-source={row.kind}><td><Button size="small" variant="ghost" onClick={() => change({ ...search, sourceKind: row.kind, tab: 'tasks', agent: undefined, profile: undefined })}>{runtimeSourceLabel(row.kind, t)}</Button></td>
        <td>{row.objects}</td>{(['input', 'cacheRead', 'cacheWrite', 'output'] as const).map((bucket) => <td key={bucket}>{runtimeTokens(row.metrics, bucket)}</td>)}
        <td>{runtimeTokens(row.metrics)}</td><td>{runtimeCny(row.metrics)}</td><td>{t('runtime.source.' + row.collectionState)}<span className={styles.identity}>{t(row.metrics.tokens.complete ? 'runtime.source.complete' : 'runtime.source.partial')}</span></td></tr>)}
    </DataTable>
  </Card>;
}
