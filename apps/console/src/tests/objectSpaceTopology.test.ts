import { expect, test } from 'bun:test';
import type { ClusterResource } from '@crewstation/contracts';
import { translate } from '../shared/lib/i18n';
import type { Translate } from '../shared/lib/useT';
import { messages } from '../features/object-storage/i18n/zh-CN';
import { appendObjectSpaces } from '../shared/topology/objectSpaces';
import type { TopologyParts } from '../shared/topology/storageTopology';
import { resourceRecord } from './resourceRecordFixture';

const t: Translate = (key, values) => translate(messages, key, values);
test('object space persists without a service Pod and is never drawn as a mounted task volume', () => {
  const parts: TopologyParts = { nodes: [], edges: [], bands: [] };
  const space = resourceRecord({ id: Bun.randomUUIDv7(), kind: 'object-space', phase: 'degraded', display: { serviceId: 'app', env: 'production', backend: 'Garage', quotaBytes: '1024', usedBytes: '30', observedAt: '' } });
  appendObjectSpaces(parts, [space], [], t);
  expect(parts.nodes).toHaveLength(1); expect(parts.nodes[0]).toMatchObject({ id: space.id, kind: 'object-space', title: '生产', subtitle: 'Garage', abnormal: true });
  expect(parts.edges).toEqual([]); expect(parts.nodes[0]?.facts).toContainEqual(['采集时间', '—']);
});
test('both slots link only with their actual deployed release contract, not from project membership or stale replacement UID', () => {
  const parts: TopologyParts = { nodes: ['blue', 'green', 'unrelated'].map((id) => ({ id, resourceId: id, kind: 'workload', title: id, semantic: 'service', status: 'ready', lane: 1, band: id })), edges: [], bands: [] };
  const space = resourceRecord({ id: Bun.randomUUIDv7(), kind: 'object-space', display: { env: 'production', serviceId: 'app' } });
  const slots = ['blue', 'green', 'unrelated'].map((id) => resourceRecord({ kind: 'service-slot', id, display: { serviceId: id === 'unrelated' ? 'other-app' : 'app', objectStorage: 'true', releaseId: `release-${id}` }, children: [{ kind: 'Deployment', name: id, uid: `uid-${id}`, phase: 'Available', ready: true }] }));
  const resources = ['blue', 'green', 'unrelated'].map((id) => ({ resourceId: id, uid: `uid-${id}`, releaseId: `release-${id}` })) as ClusterResource[];
  appendObjectSpaces(parts, [space, ...slots], resources, t);
  expect(parts.edges.map((e) => e.from)).toEqual(['blue', 'green']); expect(parts.edges.every((e) => e.kind === 'uses' && e.to === space.id)).toBe(true);
  parts.edges.length = 0; parts.nodes.pop(); parts.bands.length = 0;
  appendObjectSpaces(parts, [space, ...slots], resources.map((r) => ({ ...r, uid: `${r.uid}-replacement` })), t);
  expect(parts.edges).toEqual([]);
});
