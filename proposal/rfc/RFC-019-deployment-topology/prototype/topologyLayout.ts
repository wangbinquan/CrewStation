// 确定性的分层排布：横向是泳道（入口 → 工作负载 → Pod → 数据），纵向是横带（每个槽、开发会话、业务任务各一带）。
// 位置只由节点在数据里的顺序（或显式行号）决定，刷新换快照不会重排；没有力导向、没有随机数。
import type { Topology, TopologyBand, TopologyBox, TopologyEdge, TopologyNode } from './topologyModel';

export interface LayoutMetrics {
  readonly nodeW: number; readonly nodeH: number; readonly laneGap: number; readonly rowGap: number;
  readonly bandPad: number; readonly bandTitle: number; readonly bandGap: number; readonly margin: number; readonly laneHeader: number;
}
export const FULL_METRICS: LayoutMetrics = { nodeW: 200, nodeH: 62, laneGap: 64, rowGap: 14, bandPad: 14, bandTitle: 26, bandGap: 22, margin: 18, laneHeader: 26 };
export const SUMMARY_METRICS: LayoutMetrics = { ...FULL_METRICS, nodeW: 210, nodeH: 92, laneGap: 24, laneHeader: 0 };
export const COMPACT_METRICS: LayoutMetrics = { nodeW: 150, nodeH: 44, laneGap: 40, rowGap: 10, bandPad: 10, bandTitle: 20, bandGap: 14, margin: 10, laneHeader: 0 };

export interface Rect { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
export interface PlacedNode { readonly node: TopologyNode; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
export interface PlacedBox { readonly box: TopologyBox; readonly rect: Rect }
export interface PlacedBand { readonly band: TopologyBand; readonly y: number; readonly h: number; readonly boxes: readonly PlacedBox[]; readonly titleOnBox: boolean }
export interface PlacedEdge { readonly edge: TopologyEdge; readonly d: string; readonly labelX: number; readonly labelY: number; readonly labelSpace: number }
export interface Layout { readonly width: number; readonly height: number; readonly lanes: readonly { title: string; x: number }[]; readonly bands: readonly PlacedBand[]; readonly nodes: readonly PlacedNode[]; readonly edges: readonly PlacedEdge[] }

const IMPLICIT_BOX = '__band';

export function layoutTopology(topology: Topology, m: LayoutMetrics): Layout {
  const laneX = (lane: number) => m.margin + lane * (m.nodeW + m.laneGap);
  const placed = new Map<string, PlacedNode>();
  const bands: PlacedBand[] = [];
  let y = m.margin + m.laneHeader;
  for (const band of topology.bands) {
    const members = topology.nodes.filter((node) => node.band === band.id);
    const rowsByNode = assignRows(members);
    const rows = Math.max(1, ...[...rowsByNode.values()].map((row) => row + 1));
    const contentTop = y + m.bandTitle + m.bandPad, contentH = rows * m.nodeH + (rows - 1) * m.rowGap;
    for (const node of members) placed.set(node.id, { node, x: laneX(node.lane), y: contentTop + rowsByNode.get(node.id)! * (m.nodeH + m.rowGap), w: m.nodeW, h: m.nodeH });
    const boxes = placeBoxes(band, members, placed, m);
    const bandH = m.bandTitle + m.bandPad + contentH + m.bandPad;
    bands.push({ band, y, h: bandH, boxes, titleOnBox: boxes.length === 1 && boxes[0]?.box.id === IMPLICIT_BOX });
    y += bandH + m.bandGap;
  }
  const nodes = [...placed.values()];
  const reversed = new Set(topology.edges.filter((edge) => topology.edges.some((other) => other.from === edge.to && other.to === edge.from)).map((edge) => `${edge.from}→${edge.to}`));
  const edges = topology.edges.flatMap((edge) => {
    const from = placed.get(edge.from), to = placed.get(edge.to);
    if (!from || !to) return [];
    const offset = reversed.has(`${edge.from}→${edge.to}`) ? (edge.from < edge.to ? -7 : 7) : 0;
    return [routeEdge(edge, from, to, m, offset)];
  });
  const width = m.margin * 2 + topology.lanes.length * m.nodeW + (topology.lanes.length - 1) * m.laneGap;
  return { width, height: y - m.bandGap + m.margin, lanes: topology.lanes.map((title, lane) => ({ title, x: laneX(lane) })), bands, nodes, edges };
}

/** 每条泳道内：显式 row 优先占位，其余按出现顺序填入空行。 */
function assignRows(members: readonly TopologyNode[]): Map<string, number> {
  const rows = new Map<string, number>();
  const used = new Map<number, Set<number>>();
  const take = (lane: number, row: number) => { used.set(lane, (used.get(lane) ?? new Set()).add(row)); };
  for (const node of members) if (node.row !== undefined) { rows.set(node.id, node.row); take(node.lane, node.row); }
  for (const node of members) if (node.row === undefined) {
    let row = 0;
    while (used.get(node.lane)?.has(row)) row += 1;
    rows.set(node.id, row); take(node.lane, row);
  }
  return rows;
}

function placeBoxes(band: TopologyBand, members: readonly TopologyNode[], placed: Map<string, PlacedNode>, m: LayoutMetrics): PlacedBox[] {
  const boxes = band.boxes ?? (members.some((node) => node.box !== undefined) ? [{ id: IMPLICIT_BOX, title: band.title, semantic: band.semantic, note: band.note }] : []);
  return boxes.flatMap((box) => {
    const inside = members.filter((node) => node.box === box.id || (box.id === IMPLICIT_BOX && node.box !== undefined)).map((node) => placed.get(node.id)!);
    if (inside.length === 0) return [];
    const rect = boundingBox(inside, m), title = box.title ? `${box.title}${box.note ? ` · ${box.note}` : ''}` : '';
    const titleWidth = [...title].reduce((sum, char) => sum + (char.charCodeAt(0) > 0x2e7f ? 11.5 : 6.9), 0) + 24;
    return [{ box, rect: { ...rect, w: Math.min(rect.w + 56, Math.max(rect.w, titleWidth)) } }];
  });
}

function boundingBox(nodes: readonly PlacedNode[], m: LayoutMetrics): Rect {
  const x = Math.min(...nodes.map((n) => n.x)) - m.bandPad, y = Math.min(...nodes.map((n) => n.y)) - m.bandPad - m.bandTitle;
  const right = Math.max(...nodes.map((n) => n.x + n.w)) + m.bandPad, bottom = Math.max(...nodes.map((n) => n.y + n.h)) + m.bandPad;
  return { x, y, w: right - x, h: bottom - y };
}

type Point = readonly [number, number];

/** 正交折线：相邻泳道从右侧出、左侧进；反向则镜像；同一泳道走左侧沟槽（多个子节点共用一条竖线）。 */
function routeEdge(edge: TopologyEdge, from: PlacedNode, to: PlacedNode, m: LayoutMetrics, offset: number): PlacedEdge {
  const fromCy = from.y + from.h / 2 + offset, toCy = to.y + to.h / 2 + offset;
  let points: Point[];
  if (to.node.lane > from.node.lane) {
    const midX = from.x + from.w + m.laneGap / 2 + offset;
    points = [[from.x + from.w, fromCy], [midX, fromCy], [midX, toCy], [to.x, toCy]];
  } else if (to.node.lane < from.node.lane) {
    const midX = from.x - m.laneGap / 2 + offset;
    points = [[from.x, fromCy], [midX, fromCy], [midX, toCy], [to.x + to.w, toCy]];
  } else {
    const gutter = from.x - 12;
    points = [[from.x, fromCy + 10], [gutter, fromCy + 10], [gutter, toCy], [to.x, toCy]];
  }
  const label = longestHorizontal(points);
  return { edge, d: roundedPath(points, 8), labelX: label.x, labelY: label.y - 6, labelSpace: label.length };
}

function longestHorizontal(points: readonly Point[]): { x: number; y: number; length: number } {
  const first = points[0]!;
  let best = { length: -1, x: first[0], y: first[1] };
  for (let i = 1; i < points.length; i += 1) {
    const [ax, ay] = points[i - 1]!, [bx, by] = points[i]!;
    if (ay === by && Math.abs(bx - ax) > best.length) best = { length: Math.abs(bx - ax), x: (ax + bx) / 2, y: ay };
  }
  return best;
}

function roundedPath(points: readonly Point[], radius: number): string {
  const start = points[0]!;
  const parts = [`M${start[0]} ${start[1]}`];
  for (let i = 1; i < points.length - 1; i += 1) {
    const [px, py] = points[i - 1]!, [cx, cy] = points[i]!, [nx, ny] = points[i + 1]!;
    const inLen = Math.hypot(cx - px, cy - py), outLen = Math.hypot(nx - cx, ny - cy);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    if (r <= 0.5) { parts.push(`L${cx} ${cy}`); continue; }
    const ix = cx - Math.sign(cx - px) * r, iy = cy - Math.sign(cy - py) * r;
    const ox = cx + Math.sign(nx - cx) * r, oy = cy + Math.sign(ny - cy) * r;
    parts.push(`L${ix} ${iy}`, `Q${cx} ${cy} ${ox} ${oy}`);
  }
  const [lx, ly] = points[points.length - 1]!;
  parts.push(`L${lx} ${ly}`);
  return parts.join(' ');
}
