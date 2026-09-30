interface Rect { x: number; y: number; w: number; h: number }
interface PlacedNode extends Rect { node: { id: string } }

export type RoutePoint = readonly [number, number];
export function segmentIntersects(a: RoutePoint, b: RoutePoint, r: Rect): boolean {
  return a[1] === b[1] ? a[1] > r.y && a[1] < r.y + r.h && Math.max(a[0], b[0]) > r.x && Math.min(a[0], b[0]) < r.x + r.w
    : a[0] > r.x && a[0] < r.x + r.w && Math.max(a[1], b[1]) > r.y && Math.min(a[1], b[1]) < r.y + r.h;
}
const distance = (a: RoutePoint, b: RoutePoint) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
const sorted = (v: number[]) => [...new Set(v)].sort((a, b) => a - b);

/** A visibility grid provides a deterministic Manhattan route around every card, including skipped lanes and backward links. */
export function avoidCards(points: RoutePoint[], nodes: readonly PlacedNode[], from: PlacedNode, to: PlacedNode): RoutePoint[] {
  const obstacles = nodes.map((node) => { const pad = node === from || node === to ? 0 : 5; return { x: node.x - pad, y: node.y - pad, w: node.w + pad * 2, h: node.h + pad * 2 }; });
  const clear = (a: RoutePoint, b: RoutePoint) => !obstacles.some((r) => segmentIntersects(a, b, r));
  if (points.slice(1).every((p, i) => clear(points[i]!, p))) return points;
  const start = points[0]!, end = points.at(-1)!;
  const a: RoutePoint = [start[0] + (start[0] === from.x ? -10 : 10), start[1]];
  const b: RoutePoint = [end[0] + (end[0] === to.x ? -10 : 10), end[1]];
  const xs = sorted([a[0], b[0], ...obstacles.flatMap((r) => [r.x - 2, r.x + r.w + 2])]);
  const ys = sorted([a[1], b[1], ...obstacles.flatMap((r) => [r.y - 2, r.y + r.h + 2])]);
  const width = xs.length, id = (x: number, y: number) => y * width + x;
  const first = id(xs.indexOf(a[0]), ys.indexOf(a[1])), last = id(xs.indexOf(b[0]), ys.indexOf(b[1]));
  const point = (key: number): RoutePoint => [xs[key % width]!, ys[Math.floor(key / width)]!];
  const queue = new MinQueue(); queue.push(first, distance(a, b));
  const costs = new Map<number, number>([[first, 0]]), previous = new Map<number, number>(), visited = new Set<number>();
  while (queue.size) {
    const current = queue.pop(); if (visited.has(current)) continue;
    if (current === last) { const route: RoutePoint[] = [b]; let key = last; while (key !== first) { key = previous.get(key)!; route.push(point(key)); } return compact([start, ...route.reverse(), end]); }
    visited.add(current); const x = current % width, y = Math.floor(current / width), p = point(current);
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nx! < 0 || ny! < 0 || nx! >= width || ny! >= ys.length) continue;
      const next = id(nx!, ny!), q = point(next); if (visited.has(next) || !clear(p, q)) continue;
      const cost = costs.get(current)! + distance(p, q);
      if (cost < (costs.get(next) ?? Infinity)) { costs.set(next, cost); previous.set(next, current); queue.push(next, cost + distance(q, b)); }
    }
  }
  // A malformed overlapping layout cannot safely draw a relationship through unrelated cards.
  return [];
}
function compact(points: RoutePoint[]): RoutePoint[] {
  const out: RoutePoint[] = [];
  for (const p of points) { if (out.at(-1)?.[0] === p[0] && out.at(-1)?.[1] === p[1]) continue; const a = out.at(-2), b = out.at(-1); if (a && b && ((a[0] === b[0] && b[0] === p[0]) || (a[1] === b[1] && b[1] === p[1]))) out.pop(); out.push(p); }
  return out;
}
class MinQueue {
  private heap: { id: number; score: number }[] = [];
  get size() { return this.heap.length; }
  push(id: number, score: number) { const row = { id, score }; this.heap.push(row); let i = this.heap.length - 1; while (i > 0) { const parent = Math.floor((i - 1) / 2); if (this.heap[parent]!.score <= score) break; this.heap[i] = this.heap[parent]!; i = parent; } this.heap[i] = row; }
  pop(): number { const first = this.heap[0]!, end = this.heap.pop()!; if (this.heap.length) { let i = 0; while (i * 2 + 1 < this.heap.length) { let child = i * 2 + 1; if (child + 1 < this.heap.length && this.heap[child + 1]!.score < this.heap[child]!.score) child++; if (this.heap[child]!.score >= end.score) break; this.heap[i] = this.heap[child]!; i = child; } this.heap[i] = end; } return first.id; }
}
