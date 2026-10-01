import { expect, test } from 'bun:test';
import { centerSnapshot, resourceNodeFixture } from './resourceCenterFixture';
import { resourceTopology, filterResourceTopology } from '../features/project-resources/model/topology';
import { parseCenterSearch, matches, formValues, initialDraft } from '../features/project-resources/model/workspace';
import { messages as zh } from '../features/project-resources/i18n/zh-CN';
import { messages as en } from '../features/project-resources/i18n/en-US';
import { translate } from '../shared/lib/i18n';
import { avoidCards, segmentIntersects } from '../shared/ui/topology/orthogonalRouter';
import { layoutTopology, FULL_METRICS } from '../shared/ui/topology/topologyLayout';
import type { TopologyNode } from '../shared/ui/topology/topologyModel';

test('aggregation preserves directed membership, never sums independent quota scopes, and bilingual keys match', () => {
  const snapshot = centerSnapshot(), graph = resourceTopology(snapshot, (key, values) => translate(zh, key, values));
  expect(graph.groups.size).toBe(2); expect(graph.groups.get('group:execution:compute-profile')).toHaveLength(79);
  expect(graph.groups.get('group:execution:execution-quota')).toHaveLength(1);
  expect(graph.topology.nodes).toHaveLength(2); expect(graph.topology.edges).toEqual([expect.objectContaining({ from: 'group:execution:compute-profile', to: 'group:execution:execution-quota', evidence: 'observed' })]);
  for (const id of graph.groups.keys()) expect(graph.displayed.get(id)!.metrics).toEqual([]);
  expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
  expect(matches(resourceNodeFixture('private'), { q: 'PRIVATE', category: 'execution' })).toBe(true);
  expect(parseCenterSearch({ view: 'bad', category: 'secret', q: 'a'.repeat(200) })).toMatchObject({ view: undefined, category: undefined, q: 'a'.repeat(120) });
});
test('quota form rejects empty, fractional counts and out of range values while preserving booleans', () => {
  const fields = centerSnapshot().nodes[0]!.actions[0]!.fields;
  for (const value of ['', 'NaN', '-1', '1.5', '101']) expect(() => formValues(fields, { ...initialDraft({}), values: { maxConcurrentTasks: value } })).toThrow();
  expect(formValues(fields, initialDraft({ maxConcurrentTasks: 8 }))).toEqual({ maxConcurrentTasks: 8 });
});
test('search retains the matching member group, quota scopes and only real links; no-match does not fabricate resources', () => {
  const snapshot = centerSnapshot(); snapshot.nodes.push(resourceNodeFixture('project', { kind: 'project', category: 'foundation' }));
  const graph = resourceTopology(snapshot, (key, values) => translate(zh, key, values));
  const filtered = filterResourceTopology(graph, new Set(['node-000']));
  expect(filtered.nodes.map((node) => node.id).sort()).toEqual(['group:execution:compute-profile', 'project']);
  expect(filtered.edges).toEqual([]);
  expect(graph.groups.get('group:execution:compute-profile')).toHaveLength(79);
  expect(graph.displayed.get('group:execution:compute-profile')!.metrics).toEqual([]);
  const empty = filterResourceTopology(graph, new Set());
  expect(empty.nodes.map((node) => node.id)).toEqual(['project']); expect(empty.edges).toEqual([]);
  expect(empty.bands.map((band) => band.id)).toEqual(['project']);
});
test('cross-lane and backward routes avoid unrelated cards and retain arrow direction', () => {
  const nodes: TopologyNode[] = [0, 1, 2].map((lane) => ({ id: `n${lane}`, kind: 'component', semantic: 'platform', title: 'node', lane, band: 'b', status: 'ready' }));
  const graph = layoutTopology({ id: 'g', title: 'g', lanes: ['a', 'b', 'c'], bands: [{ id: 'b', title: '', semantic: 'platform' }], nodes, edges: [], observedAt: '', complete: true }, FULL_METRICS);
  const [a, obstacle, b] = graph.nodes;
  for (const [from, to] of [[a!, b!], [b!, a!]] as const) { const start = [from.x + (from === a ? from.w : 0), from.y + from.h / 2] as const, end = [to.x + (to === a ? to.w : 0), to.y + to.h / 2] as const; const route = avoidCards([start, end], graph.nodes, from, to); expect(route.length).toBeGreaterThan(2); expect(route[0]).toEqual(start); expect(route.at(-1)).toEqual(end); for (let i = 1; i < route.length; i++) expect(segmentIntersects(route[i - 1]!, route[i]!, obstacle!)).toBe(false); }
});
