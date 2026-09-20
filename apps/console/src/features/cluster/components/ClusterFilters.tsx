import type { ClusterSummary } from '@crewstation/contracts';
import { ClusterPurposeSchema } from '@crewstation/contracts';
import type { ClusterSearch } from '../model/clusterSearch';
import { useT } from '../../../shared/lib/useT';
import styles from './Cluster.module.css';
export function ClusterFilters({ search, summary, change }: { search: ClusterSearch; summary?: ClusterSummary; change: (patch: ClusterSearch) => void }) {
  const t = useT();
  return <div className={styles.filters}>
    <label>{t('cluster.scope')}<select value={search.scope ?? 'all'} onChange={(e) => change({ scope: e.target.value as ClusterSearch['scope'], projectId: undefined })}>{['all', 'project', 'system', 'unresolved'].map((s) => <option key={s} value={s}>{t(`cluster.${s}`)}</option>)}</select></label>
    <label>{t('cluster.project')}<select value={search.projectId ?? ''} onChange={(e) => change({ projectId: e.target.value || undefined, scope: e.target.value ? 'project' : 'all' })}><option value="">{t('cluster.allProjects')}</option>{summary?.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <label>{t('cluster.namespace')}<input value={search.namespace ?? ''} onChange={(e) => change({ namespace: e.target.value || undefined })} /></label>
    <label>{t('cluster.kind')}<select value={search.kind ?? ''} onChange={(e) => change({ kind: e.target.value || undefined })}><option value="">{t('cluster.allKinds')}</option>{Object.keys(summary?.kinds ?? {}).sort().map((k) => <option key={k}>{k}</option>)}</select></label>
    <label>{t('cluster.purpose')}<select value={search.purpose ?? ''} onChange={(e) => change({ purpose: e.target.value ? ClusterPurposeSchema.parse(e.target.value) : undefined })}><option value="">{t('cluster.allPurposes')}</option>{ClusterPurposeSchema.options.map((p) => <option key={p} value={p}>{t(`cluster.purpose.${p}`)}</option>)}</select></label>
    <label>{t('cluster.status')}<select value={search.status ?? ''} onChange={(e) => change({ status: e.target.value || undefined })}><option value="">{t('cluster.allStatuses')}</option>{['abnormal', 'ready', 'terminating', 'Running', 'Pending', 'Failed', 'Succeeded', 'Unknown', 'Bound'].map((s) => <option key={s} value={s}>{t(`cluster.status.${s}`)}</option>)}</select></label>
    <label>{t('cluster.search')}<input type="search" value={search.q ?? ''} placeholder={t('cluster.searchHint')} onChange={(e) => change({ q: e.target.value || undefined })} /></label>
  </div>;
}
