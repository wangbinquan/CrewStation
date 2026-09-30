import { useMemo, useState } from 'react';
import { TopologyDiagram, FULL_METRICS } from './ui';
import { fitMetrics, layoutTopology, textWidth } from '../../../../apps/console/src/shared/ui/topology/topologyLayout';
import type { PlacedNode, Rect } from '../../../../apps/console/src/shared/ui/topology/topologyLayout';
import type { Topology, TopologyEdge } from '../../../../apps/console/src/shared/ui/topology/topologyModel';
import { useContainerWidth } from '../../../../apps/console/src/shared/ui/topology/useContainerWidth';

const METRICS = { ...FULL_METRICS, nodeW: 230, nodeH: 98, laneGap: 58, rowGap: 20, bandGap: 28, margin: 20 };
type Point = [number, number];
function hits(a: Point, b: Point, rect: Rect): boolean {
  const inset = 2;
  if (a[0] === b[0]) return a[0] > rect.x - inset && a[0] < rect.x + rect.w + inset && Math.max(a[1], b[1]) > rect.y - inset && Math.min(a[1], b[1]) < rect.y + rect.h + inset;
  return a[1] > rect.y - inset && a[1] < rect.y + rect.h + inset && Math.max(a[0], b[0]) > rect.x - inset && Math.min(a[0], b[0]) < rect.x + rect.w + inset;
}
function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const prev = out.at(-1), prev2 = out.at(-2);
    if (prev && prev[0] === point[0] && prev[1] === point[1]) continue;
    if (prev && prev2 && ((prev2[0] === prev[0] && prev[0] === point[0]) || (prev2[1] === prev[1] && prev[1] === point[1]))) out.pop();
    out.push(point);
  }
  return out;
}
function route(edge: TopologyEdge, from: PlacedNode, to: PlacedNode, nodes: readonly PlacedNode[]) {
  const right = to.node.lane > from.node.lane;
  const same = to.node.lane === from.node.lane;
  const start: Point = [right ? from.x + from.w : from.x, from.y + from.h / 2];
  const end: Point = [right || same ? to.x : to.x + to.w, to.y + to.h / 2];
  const outX = start[0] + (right ? 1 : -1) * METRICS.laneGap / 2;
  const inX = end[0] + (right || same ? -1 : 1) * METRICS.laneGap / 2;
  const choices: Point[][] = [[start, [outX, start[1]], [outX, end[1]], end]];
  for (const y of [to.y - METRICS.rowGap / 2, to.y + to.h + METRICS.rowGap / 2]) {
    choices.push([start, [outX, start[1]], [outX, y], [inX, y], [inX, end[1]], end]);
  }
  const score = (points: Point[]) => points.slice(1).reduce((sum, point, index) => {
    const prev = points[index]!;
    return sum + Math.abs(point[0] - prev[0]) + Math.abs(point[1] - prev[1]) + 100000 * nodes.filter((n) => n.node.id !== edge.from && n.node.id !== edge.to && hits(prev, point, n)).length;
  }, 0);
  const points = simplify(choices.sort((a, b) => score(a) - score(b))[0]!);
  let label = { x: 0, y: 0, width: 0 };
  points.slice(1).forEach((point, index) => { const prev = points[index]!; if (point[1] === prev[1] && Math.abs(point[0] - prev[0]) >= label.width) label = { x: (point[0] + prev[0]) / 2, y: point[1] - 6, width: Math.abs(point[0] - prev[0]) }; });
  return { d: points.map((p, index) => `${index ? 'L' : 'M'}${p[0]},${p[1]}`).join(' '), label };
}

/** 原型适配层：节点、测量、确定性布局仍复用现有组件；预演跨列连线避障，产品代码未改动。 */
export function ResourceTopology({ topology, selectedId, onSelect, matching }: { topology: Topology; selectedId?: string; onSelect: (id: string | undefined) => void; matching?: ReadonlySet<string> }) {
  const [ref, width] = useContainerWidth<HTMLDivElement>();
  const [hover, setHover] = useState<string>();
  const focus = hover ?? selectedId;
  const layout = useMemo(() => layoutTopology(topology, fitMetrics(METRICS, topology.lanes.length, width)), [topology, width]);
  const paths = topology.edges.flatMap((edge) => { const from = layout.nodes.find((n) => n.node.id === edge.from), to = layout.nodes.find((n) => n.node.id === edge.to); return from && to ? [{ edge, ...route(edge, from, to, layout.nodes) }] : []; });
  return <div ref={ref} className="resource-topology" onMouseOver={(event) => setHover((event.target as Element).closest('[data-node-id]')?.getAttribute('data-node-id') ?? undefined)} onMouseLeave={() => setHover(undefined)}>
    <TopologyDiagram topology={topology} metrics={METRICS} label="项目资源拓扑" selectedId={selectedId} onSelect={onSelect} />
    <svg className="resource-edges" width={layout.width} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true"><defs><marker id="resource-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M1 1.5 8.5 5 1 8.5z" /></marker></defs>{paths.map(({ edge, d, label }) => <g key={`${edge.from}-${edge.to}`} className={[edge.evidence === 'static' ? 'proposed-edge' : '', (focus && edge.from !== focus && edge.to !== focus) || (matching && !matching.has(edge.from) && !matching.has(edge.to)) ? 'unrelated-edge' : ''].join(' ')}><path d={d} markerEnd="url(#resource-arrow)" /><title>{edge.from} → {edge.to} · {edge.label}</title>{edge.label && textWidth(edge.label, 10) + 8 < label.width ? <text x={label.x} y={label.y} textAnchor="middle">{edge.label}</text> : null}</g>)}</svg>
  </div>;
}
