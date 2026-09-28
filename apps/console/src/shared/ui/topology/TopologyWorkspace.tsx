// 形态图的页面骨架：来源失败警示、筛选、图框右上角的观测时间标签、图或窄屏列表、图例，详情使用统一弹窗；Esc 只关闭最上层。
// 宽屏整块长满到窗口底边，图框与详情栏各自滚动（2026-09-23 作者裁定，集群管理与项目「部署与运行形态」共用）。
import { useEffect, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Dialog } from '../dialog/Dialog';
import { useViewportFill } from '../../lib/useViewportFill';
import type { LayoutMetrics } from './topologyLayout';
import type { Topology, TopologyFilter } from './topologyModel';
import { TopologyDiagram } from './TopologyDiagram';
import { TopologyFilters } from './TopologyFilters';
import { TopologyLegend } from './TopologyLegend';
import { TopologyList } from './TopologyList';
import { TopologyObserved, TopologyStamp } from './TopologyObserved';
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
  const narrow = useNarrow(), page = useRef<HTMLDivElement>(null);
  useViewportFill(page);
  const opener = useRef<HTMLElement | null>(null);
  const select = (id: string | undefined) => {
    if (id && !selectedId) opener.current = [...(page.current?.querySelectorAll<HTMLElement>('[data-node-id]') ?? [])].find((n) => n.dataset.nodeId === id) ?? null;
    onSelect(id);
  };
  useEffect(() => {
    if (selectedId || !opener.current) return;
    const target = opener.current; opener.current = null;
    requestAnimationFrame(() => { if (target.isConnected) target.focus({ preventScroll: true }); });
  }, [selectedId]);
  const close = () => onSelect(undefined);
  return <div ref={page} className={styles.page}>
    {before}
    <TopologyObserved topology={topology} />
    {filters ? <TopologyFilters topology={topology} filter={filter} onChange={setFilter} /> : null}
    <div className={styles.workspace}>
      <div className={styles.main}>
        <div className={styles.stage}>
          {narrow ? <TopologyList topology={topology} selectedId={selectedId} onSelect={select} filter={filter} /> : <TopologyDiagram key={topology.id} topology={topology} label={label} selectedId={selectedId} onSelect={select} filter={filter} metrics={metrics} />}
          <TopologyStamp topology={topology} />
        </div>
        {legend ? <TopologyLegend topology={topology} /> : null}
      </div>
      {/* 统一弹窗保持图和筛选挂载，关联节点切换只重置详情正文。 */}
      {selectedId && detail ? <Dialog title={topology.nodes.find((node) => node.id === selectedId)?.title ?? label} size="large" onClose={close}><div key={selectedId}>{detail}</div></Dialog> : null}
    </div>
  </div>;
}
