import type { ReactElement } from 'react';
import { useT } from '../../lib/useT';
import type { Topology, TopologyFilter } from './topologyModel';
import { matchesFilter } from './topologyModel';
import styles from './Topology.module.css';

/** 窄屏（≤640px）不画 SVG：按横带分组的列表，语义色在左边框、状态点与状态短语与图一致。 */
export function TopologyList({ topology, selectedId, onSelect, filter }: { readonly topology: Topology; readonly selectedId?: string; readonly onSelect: (id: string | undefined) => void; readonly filter?: TopologyFilter }): ReactElement {
  const t = useT();
  return <div className={styles.list} aria-label={t('topology.list.label')}>
    {topology.bands.map((band) => {
      const members = topology.nodes.filter((node) => node.band === band.id && (!filter || matchesFilter(node, filter)));
      if (members.length === 0) return null;
      return <section key={band.id} className={`${styles.listBand} ${styles[`sem_${band.semantic}`]}`} aria-label={band.title || t('topology.list.label')}>
        {band.title ? <h3 className={styles.listTitle}><i className={styles.swatch} />{band.title}{band.note ? <small> · {band.note}</small> : null}</h3> : null}
        <ul>{members.map((node) => <li key={node.id}><button type="button" className={`${styles.listRow} ${styles[`sem_${node.semantic}`]} ${styles[`status_${node.status}`]}`} aria-pressed={node.id === selectedId} onClick={() => onSelect(node.id === selectedId ? undefined : node.id)}>
          <i className={styles.dot} /><span className={styles.listMain}><strong>{node.title}</strong>{node.subtitle ? <small>{node.subtitle}</small> : null}</span><span className={styles.listStatus}>{node.statusText ?? t(`topology.status.${node.status}`)}{node.abnormal ? ' ⚠' : ''}</span>
        </button></li>)}</ul>
      </section>;
    })}
  </div>;
}
