// SVG 形态图（RFC-019）：语义色描边＋半透明填充的圆角节点、类型小图标、虚线边界框、正交连线与小字标签、点选／悬停聚焦。
// 视觉语法借鉴 Archify（颜色只表达语义、状态另有非颜色提示、静态标注与观测关系分开），组件本身无业务含义。
import { useMemo, useState } from 'react';
import type { KeyboardEvent, ReactElement } from 'react';
import { useT } from '../../lib/useT';
import type { NodeKind, Topology, TopologyFilter, TopologyNode } from './topologyModel';
import { EDGE_KINDS, matchesFilter, neighbours } from './topologyModel';
import { clipPx, fitMetrics, layoutTopology, textWidth, FULL_METRICS } from './topologyLayout';
import type { LayoutMetrics, PlacedNode } from './topologyLayout';
import { useContainerWidth } from './useContainerWidth';
import styles from './Topology.module.css';

/** 16×16 线框小图标：类型的非颜色提示。 */
const SIGIL: Record<NodeKind, string> = {
  route: 'M2 8h11M9 3.5 13.5 8 9 12.5',
  workload: 'M2 5.5h8.5V14H2zM5.5 2H14v8.5',
  pod: 'M8 1.5l5.6 3.25v6.5L8 14.5l-5.6-3.25v-6.5z',
  database: 'M3 4c0-1.4 2.2-2.5 5-2.5s5 1.1 5 2.5v8c0 1.4-2.2 2.5-5 2.5s-5-1.1-5-2.5zM3 4c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5M3 8c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5',
  volume: 'M2 6.5h12V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1zM4 3h8l2 3.5H2z',
  job: 'M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM8 4.5V8l2.5 1.8',
  component: 'M4.5 4.5h7v7h-7zM2 6.5h2.5M2 9.5h2.5M11.5 6.5H14M11.5 9.5H14M6.5 2v2.5M9.5 2v2.5M6.5 11.5V14M9.5 11.5V14',
  external: 'M5 13h7a3 3 0 0 0 0-6 4 4 0 0 0-7.6-1A3.5 3.5 0 0 0 5 13z',
  summary: 'M2 4h5l1.5 2H14v7.5H2z',
};
const cls = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ');

export interface TopologyDiagramProps {
  readonly topology: Topology;
  readonly metrics?: LayoutMetrics;
  readonly selectedId?: string;
  readonly onSelect?: (id: string | undefined) => void;
  readonly filter?: TopologyFilter;
  readonly label: string;
}

export function TopologyDiagram({ topology, metrics: base = FULL_METRICS, selectedId, onSelect, filter, label }: TopologyDiagramProps): ReactElement {
  const [frame, frameWidth] = useContainerWidth<HTMLDivElement>();
  const metrics = useMemo(() => fitMetrics(base, topology.lanes.length, frameWidth), [base, topology.lanes.length, frameWidth]);
  const layout = useMemo(() => layoutTopology(topology, metrics), [topology, metrics]);
  const [hover, setHover] = useState<string>();
  const focus = hover ?? selectedId;
  const near = useMemo(() => (focus ? neighbours(topology, focus) : undefined), [topology, focus]);
  const filtered = useMemo(() => new Set(topology.nodes.filter((node) => !filter || matchesFilter(node, filter)).map((node) => node.id)), [topology, filter]);
  const dimNode = (node: TopologyNode) => (near ? !near.has(node.id) : false) || !filtered.has(node.id);
  const dimEdge = (from: string, to: string) => (near ? !(focus === from || focus === to) : false) || !(filtered.has(from) && filtered.has(to));
  return <div ref={frame} className={styles.frame}>
    <svg className={styles.svg} viewBox={`0 0 ${layout.width} ${layout.height}`} width={layout.width} role="group" aria-label={label} onMouseLeave={() => setHover(undefined)}>
      <defs>
        <pattern id="cs-topo-grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.9" className={styles.gridDot} /></pattern>
        {EDGE_KINDS.map((kind) => <marker key={kind} id={`cs-topo-arrow-${kind}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M1 1.5 8.5 5 1 8.5z" className={cls(styles.arrow, styles[`edge_${kind}`])} /></marker>)}
      </defs>
      <rect width={layout.width} height={layout.height} className={styles.canvas} />
      <rect width={layout.width} height={layout.height} fill="url(#cs-topo-grid)" />
      {layout.lanes.map((lane) => lane.title ? <text key={`${lane.title}-${lane.x}`} x={lane.x} y={metrics.margin + 12} className={styles.lane}>{lane.title}</text> : null)}
      {layout.bands.map(({ band, y, boxes, titleOnBox }) => <g key={band.id} className={styles[`sem_${band.semantic}`]}>
        {!titleOnBox && band.title ? <text x={metrics.margin} y={y + 17} className={styles.bandTitle}>{band.title}{band.note ? <tspan className={styles.bandNote}> · {band.note}</tspan> : null}</text> : null}
        {boxes.map(({ box, rect }) => <g key={box.id} className={styles[`sem_${box.semantic ?? band.semantic}`]}>
          <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={10} className={styles.bandBox} />
          {box.title ? <text x={rect.x + 10} y={rect.y + 17} className={styles.bandTitle}><title>{box.note ? `${box.title} · ${box.note}` : box.title}</title>{clipPx(box.title, rect.w - 20, 11)}{box.note && textWidth(`${box.title} · ${box.note}`, 11) <= rect.w - 20 ? <tspan className={styles.bandNote}> · {box.note}</tspan> : null}</text> : null}
        </g>)}
      </g>)}
      {layout.edges.map(({ edge, d, labelX, labelY, labelSpace }) => <g key={`${edge.from}→${edge.to}`} className={cls(styles.edge, styles[`edge_${edge.kind}`], styles[`evidence_${edge.evidence}`], dimEdge(edge.from, edge.to) && styles.is_dim)} data-evidence={edge.evidence}>
        <path d={d} className={styles.edgePath} markerEnd={`url(#cs-topo-arrow-${edge.kind})`} />
        {edge.label && textWidth(edge.label, 10) <= labelSpace - 10 ? <text x={labelX} y={labelY} textAnchor="middle" className={styles.edgeLabel}>{edge.label}</text> : null}
      </g>)}
      {layout.nodes.map((placed) => <TopologyNodeView key={placed.node.id} placed={placed} selected={placed.node.id === selectedId} dim={dimNode(placed.node)}
        onSelect={() => onSelect?.(placed.node.id === selectedId ? undefined : placed.node.id)} onHover={(on) => setHover(on ? placed.node.id : undefined)} />)}
    </svg>
  </div>;
}

function TopologyNodeView({ placed, selected, dim, onSelect, onHover }: { placed: PlacedNode; selected: boolean; dim: boolean; onSelect: () => void; onHover: (on: boolean) => void }): ReactElement {
  const t = useT();
  const { node, x, y, w, h } = placed;
  const status = node.statusText ?? t(`topology.status.${node.status}`);
  const statusWidth = textWidth(status, 10.5) + 16;
  const title = clipPx(node.title, w - 34 - 22, 13), subtitle = node.subtitle ? clipPx(node.subtitle, w - 34 - 8 - statusWidth, 11) : undefined;
  // 计数行只在高卡片（项目层、横带汇总）里逐行画；普通高度的节点把计数并成一行事实。
  const tallCounts = node.counts && h >= 84;
  const meta = tallCounts ? undefined : (node.counts ? node.counts.map(([key, value]) => `${key} ${value}`) : node.meta)?.join(' · ');
  const onKey = (event: KeyboardEvent<SVGGElement>) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(); } };
  return <g className={cls(styles.node, styles[`sem_${node.semantic}`], styles[`status_${node.status}`], styles[`kind_${node.kind}`], selected && styles.is_selected, dim && styles.is_dim)} data-node-id={node.id} data-dim={dim ? 'true' : undefined}
    transform={`translate(${x} ${y})`} tabIndex={0} role="button" aria-pressed={selected} aria-label={`${node.title}，${status}${node.subtitle ? `，${node.subtitle}` : ''}`}
    onClick={onSelect} onKeyDown={onKey} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)} onFocus={() => onHover(true)} onBlur={() => onHover(false)}>
    <title>{`${node.title}${node.subtitle ? ` · ${node.subtitle}` : ''} · ${status}${meta ? ` · ${meta}` : ''}`}</title>
    <rect width={w} height={h} rx={9} className={styles.nodeBox} />
    <path d={SIGIL[node.kind]} className={styles.sigil} transform="translate(11 11)" />
    <text x={34} y={23} className={styles.title}>{title}</text>
    {subtitle ? <text x={34} y={39} className={styles.subtitle}>{subtitle}</text> : null}
    {tallCounts ? node.counts!.slice(0, 3).map(([key, value], index) => <text key={key} x={12} y={54 + index * 13} className={styles.meta}><tspan className={styles.metaKey}>{key}</tspan> {clipPx(value, w - 30 - textWidth(key, 10.5), 10.5)}</text>)
      : meta ? <text x={12} y={h - 8} className={styles.meta}>{clipPx(meta, w - 22, 10.5)}</text> : null}
    <circle r={4} cx={w - 13} cy={12} className={styles.statusDot} />
    <text x={w - 10} y={39} textAnchor="end" className={styles.statusText}>{clipPx(status, 130, 10.5)}</text>
    {node.abnormal ? <path d="M8 1.5 14.5 13h-13z M8 6v3.5 M8 11v.5" transform={`translate(${w - 34} 4)`} className={styles.warn} /> : null}
  </g>;
}
