// 形态图的页面骨架：观测行、筛选、图或窄屏列表、图例，右侧详情插槽（作者裁定放右侧）；Esc 关闭详情。
import { useEffect, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { LayoutMetrics } from './topologyLayout';
import type { Topology, TopologyFilter } from './topologyModel';
import { TopologyDiagram } from './TopologyDiagram';
import { TopologyFilters } from './TopologyFilters';
import { TopologyLegend } from './TopologyLegend';
import { TopologyList } from './TopologyList';
import { TopologyObserved } from './TopologyObserved';
import styles from './Topology.module.css';

export function useNarrow(maxWidth = 640): boolean {
  const query = `(max-width: ${maxWidth}px)`;
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(query), sync = () => setNarrow(media.matches);
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, [query]);
  return narrow;
}

export interface TopologyWorkspaceProps {
  readonly topology: Topology;
  readonly label: string;
  readonly selectedId?: string;
  readonly onSelect: (id: string | undefined) => void;
  readonly metrics?: LayoutMetrics;
  readonly detail?: ReactNode;
  readonly before?: ReactNode;
  readonly filters?: boolean;
  readonly legend?: boolean;
}

export function TopologyWorkspace({ topology, label, selectedId, onSelect, metrics, detail, before, filters = true, legend = true }: TopologyWorkspaceProps): ReactElement {
  const [filter, setFilter] = useState<TopologyFilter>({});
  const narrow = useNarrow();
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onSelect(undefined); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, onSelect]);
  return <div className={styles.page}>
    {before}
    <TopologyObserved topology={topology} />
    {filters ? <TopologyFilters topology={topology} filter={filter} onChange={setFilter} /> : null}
    <div className={`${styles.workspace}${selectedId && detail ? ` ${styles.hasDetail}` : ''}`}>
      <div className={styles.main}>
        {narrow ? <TopologyList topology={topology} selectedId={selectedId} onSelect={onSelect} filter={filter} /> : <TopologyDiagram key={topology.id} topology={topology} label={label} selectedId={selectedId} onSelect={onSelect} filter={filter} metrics={metrics} />}
        {legend ? <TopologyLegend topology={topology} /> : null}
      </div>
      {selectedId && detail ? <div className={styles.detail}>{detail}</div> : null}
    </div>
  </div>;
}
