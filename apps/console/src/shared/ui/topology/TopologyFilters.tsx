import type { ReactElement } from 'react';
import { useT } from '../../lib/useT';
import { Button } from '../Button';
import type { NodeStatus, Semantic, Topology, TopologyFilter } from './topologyModel';
import { hasFilter, semanticCounts, statusCounts } from './topologyModel';
import styles from './Topology.module.css';

function toggle<T>(set: ReadonlySet<T> | undefined, value: T): ReadonlySet<T> { const next = new Set(set); if (next.has(value)) next.delete(value); else next.add(value); return next; }

/** 筛选只压暗不移除，位置保持稳定；用途与状态两组切换钮加「只看需要关注」。 */
export function TopologyFilters({ topology, filter, onChange }: { readonly topology: Topology; readonly filter: TopologyFilter; readonly onChange: (next: TopologyFilter) => void }): ReactElement {
  const t = useT();
  const abnormal = topology.nodes.filter((node) => node.abnormal).length;
  return <div className={styles.filters} role="group" aria-label={t('topology.filters.label')}>
    <span className={styles.filtersLabel}>{t('topology.filters.purpose')}</span>
    {semanticCounts(topology).map(([semantic]) => <button key={semantic} type="button" className={`${styles.chip} ${styles[`sem_${semantic}`]}`} aria-pressed={filter.semantics?.has(semantic) ?? false} onClick={() => onChange({ ...filter, semantics: toggle<Semantic>(filter.semantics, semantic) })}><i className={styles.swatch} />{t(`topology.semantic.${semantic}`)}</button>)}
    <span className={styles.filtersLabel}>{t('topology.filters.status')}</span>
    {statusCounts(topology.nodes).map(([status]) => <button key={status} type="button" className={`${styles.chip} ${styles[`status_${status}`]}`} aria-pressed={filter.statuses?.has(status) ?? false} onClick={() => onChange({ ...filter, statuses: toggle<NodeStatus>(filter.statuses, status) })}><i className={styles.dot} />{t(`topology.status.${status}`)}</button>)}
    <button type="button" className={`${styles.chip} ${styles.chipAttention}`} aria-pressed={filter.abnormalOnly ?? false} disabled={abnormal === 0} onClick={() => onChange({ ...filter, abnormalOnly: !filter.abnormalOnly })}>{abnormal > 0 ? t('topology.filters.attention', { count: abnormal }) : t('topology.filters.attentionNone')}</button>
    {hasFilter(filter) ? <Button variant="ghost" onClick={() => onChange({})}>{t('topology.filters.clear')}</Button> : null}
  </div>;
}
