import type { ReactElement } from 'react';
import { useT } from '../../lib/useT';
import type { Topology } from './topologyModel';
import { semanticCounts, statusCounts } from './topologyModel';
import styles from './Topology.module.css';

/** 图例：语义（带计数）、状态、连线种类与证据；静态标注明写「不是实测」。 */
export function TopologyLegend({ topology }: { readonly topology: Topology }): ReactElement {
  const t = useT();
  const edgeKinds = [...new Set(topology.edges.map((edge) => edge.kind))];
  const hasStatic = topology.edges.some((edge) => edge.evidence === 'static'), hasObserved = topology.edges.some((edge) => edge.evidence === 'observed');
  return <div className={styles.legend} aria-label={t('topology.legend.label')}>
    <div className={styles.legendGroup}><span className={styles.legendHeading}>{t('topology.legend.semantic')}</span>{semanticCounts(topology).map(([semantic, count]) => <span key={semantic} className={`${styles.legendItem} ${styles[`sem_${semantic}`]}`}><i className={styles.swatch} />{t(`topology.semantic.${semantic}`)}<b>{count}</b></span>)}</div>
    <div className={styles.legendGroup}><span className={styles.legendHeading}>{t('topology.legend.status')}</span>{statusCounts(topology.nodes).map(([status, count]) => <span key={status} className={`${styles.legendItem} ${styles[`status_${status}`]}`}><i className={styles.dot} />{t(`topology.status.${status}`)}<b>{count}</b></span>)}</div>
    {edgeKinds.length > 0 ? <div className={styles.legendGroup}><span className={styles.legendHeading}>{t('topology.legend.edges')}</span>
      {edgeKinds.map((kind) => <span key={kind} className={`${styles.legendItem} ${styles[`edge_${kind}`]}`}><i className={styles.line} />{t(`topology.edge.${kind}`)}</span>)}
      {hasObserved ? <span className={styles.legendItem}><i className={styles.line} />{t('topology.legend.observed')}</span> : null}
      {hasStatic ? <span className={styles.legendItem}><i className={`${styles.line} ${styles.lineStatic}`} />{t('topology.legend.static')}</span> : null}
    </div> : null}
  </div>;
}
