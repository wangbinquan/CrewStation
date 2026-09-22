import { describe, expect, test } from 'bun:test';
import { clipPx, fitMetrics, layoutTopology, textWidth, FULL_METRICS } from '../shared/ui/topology/topologyLayout';
import { hasFilter, matchesFilter, neighbours, semanticCounts, statusCounts, worstStatus } from '../shared/ui/topology/topologyModel';
import { layoutFixture } from './topologyFixture';

// RFC-019 design §5：确定性分层排布——位置只由数据顺序或显式行号决定，换快照不重排；标签只在放得下时画。
const at = (layout: ReturnType<typeof layoutTopology>, id: string) => layout.nodes.find((n) => n.node.id === id)!;

describe('topology layout', () => {
  test('lanes run left to right, bands top to bottom, explicit rows are honoured and free rows fill from the top', () => {
    const layout = layoutTopology(layoutFixture, FULL_METRICS), m = FULL_METRICS;
    expect(at(layout, 'route').x).toBeLessThan(at(layout, 'deploy').x); expect(at(layout, 'deploy').x).toBeLessThan(at(layout, 'pod').x);
    expect(at(layout, 'pod').y).toBeLessThan(at(layout, 'ws').y);
    expect(at(layout, 'cli').y).toBe(at(layout, 'ws').y + 2 * (m.nodeH + m.rowGap));
    expect(layout.width).toBe(m.margin * 2 + 3 * m.nodeW + 2 * m.laneGap);
  });
  test('a band box wraps only the boxed nodes and is at least as wide as its own title, never more than 56px past the nodes', () => {
    const layout = layoutTopology(layoutFixture, FULL_METRICS), m = FULL_METRICS, band = layout.bands[0]!, box = band.boxes[0]!;
    expect(band.titleOnBox).toBe(true);
    expect(box.rect.x).toBeGreaterThan(at(layout, 'route').x + at(layout, 'route').w);
    expect(box.rect.x).toBe(at(layout, 'deploy').x - m.bandPad);
    const nodesWidth = 2 * m.nodeW + m.laneGap + 2 * m.bandPad;
    expect(box.rect.w).toBeGreaterThanOrEqual(nodesWidth); expect(box.rect.w).toBeLessThanOrEqual(nodesWidth + 56);
    expect(layout.bands[1]!.boxes).toHaveLength(0);
  });
  test('edges leave the right side and enter the left; a reversed pair is offset; same-lane children use the left gutter; label space is the longest horizontal run', () => {
    const layout = layoutTopology(layoutFixture, FULL_METRICS), route = at(layout, 'route'), ws = at(layout, 'ws');
    const edge = (from: string, to: string) => layout.edges.find((e) => e.edge.from === from && e.edge.to === to)!;
    expect(edge('route', 'deploy').d.startsWith(`M${route.x + route.w} `)).toBe(true);
    expect(edge('pod', 'route').d).not.toBe(edge('route', 'pod').d);
    expect(edge('ws', 'cli').d).toContain(`${ws.x - 12} `);
    expect(edge('route', 'deploy').labelSpace).toBe(FULL_METRICS.laneGap / 2);
    expect(layoutTopology(layoutFixture, { ...FULL_METRICS, laneGap: 160 }).edges[0]!.labelSpace).toBe(80);
  });
  test('changing status or titles never moves a node; the same ids keep the same coordinates across snapshots', () => {
    const before = layoutTopology(layoutFixture, FULL_METRICS);
    const after = layoutTopology({ ...layoutFixture, nodes: layoutFixture.nodes.map((n) => ({ ...n, status: 'failed' as const, title: `${n.title}-renamed`, statusText: 'CrashLoopBackOff' })) }, FULL_METRICS);
    for (const placed of before.nodes) { const next = at(after, placed.node.id); expect([next.x, next.y]).toEqual([placed.x, placed.y]); }
  });
  test('fitMetrics widens nodes to fill the container within [0.9×base, 360] and leaves the base alone without a width', () => {
    expect(fitMetrics(FULL_METRICS, 4, 0)).toEqual(FULL_METRICS);
    expect(fitMetrics(FULL_METRICS, 4, 1470).nodeW).toBe(Math.floor((1470 - 2 - 36 - 3 * 64) / 4));
    expect(fitMetrics(FULL_METRICS, 4, 8000).nodeW).toBe(360);
    expect(fitMetrics(FULL_METRICS, 4, 600).nodeW).toBe(Math.round(FULL_METRICS.nodeW * 0.9));
    expect(fitMetrics(FULL_METRICS, 4, 1470).laneGap).toBe(FULL_METRICS.laneGap);
  });
  test('text clipping estimates CJK wider than latin and always ends with an ellipsis when cut', () => {
    expect(textWidth('中文', 10)).toBeGreaterThan(textWidth('ab', 10));
    expect(clipPx('演示数字人服务槽', 40, 13).endsWith('…')).toBe(true);
    expect(clipPx('short', 400, 13)).toBe('short');
  });
  test('model helpers: neighbours, filters, counts and the worst status', () => {
    expect([...neighbours(layoutFixture, 'route')].sort()).toEqual(['deploy', 'pod', 'route']);
    expect(matchesFilter(layoutFixture.nodes[3]!, { semantics: new Set(['development']) })).toBe(true);
    expect(matchesFilter(layoutFixture.nodes[0]!, { semantics: new Set(['development']) })).toBe(false);
    expect(matchesFilter(layoutFixture.nodes[4]!, { abnormalOnly: true })).toBe(true);
    expect(hasFilter({})).toBe(false); expect(hasFilter({ abnormalOnly: true })).toBe(true);
    expect(semanticCounts(layoutFixture)).toEqual([['gateway', 1], ['service', 2], ['development', 2]]);
    expect(statusCounts(layoutFixture.nodes)).toEqual([['pending', 1], ['running', 1], ['ready', 3]]);
    expect(worstStatus(layoutFixture.nodes)).toBe('pending'); expect(worstStatus([])).toBe('idle');
  });
});
