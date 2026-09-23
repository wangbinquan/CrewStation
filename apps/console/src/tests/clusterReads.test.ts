import { expect, test } from 'bun:test';
import { sameApartFromSnapshot, sameApartFromWindow, sameUsageScope } from '../features/cluster/model/clusterReads';

const key = (request: unknown) => ['cluster', 'resources', request];

test('只有快照不同才保留上一份资源页，筛选或分页变了按新查询载入', () => {
  expect(sameApartFromSnapshot(key({ scope: 'all', view: 'workloads', snapshotId: 'snapshot-1' }), { scope: 'all', view: 'workloads', snapshotId: 'snapshot-2' })).toBe(true);
  expect(sameApartFromSnapshot(key({ scope: 'all', view: 'workloads' }), { scope: 'all', view: 'pods' })).toBe(false);
  expect(sameApartFromSnapshot(key({ scope: 'all', cursor: 'page-2', snapshotId: 'snapshot-1' }), { scope: 'all', snapshotId: 'snapshot-1' })).toBe(false);
  expect(sameApartFromSnapshot(key({ scope: 'all', kind: undefined }), { scope: 'all' })).toBe(true);
  // 目标不同的详情键不能互相顶替；键末位不是请求对象时一律重新载入。
  expect(sameApartFromSnapshot(['cluster', 'detail', { resourceId: 'a', snapshotId: 'snapshot-1' }], { resourceId: 'b', snapshotId: 'snapshot-1' })).toBe(false);
  expect(sameApartFromSnapshot(['cluster', 'detail'], { resourceId: 'a' })).toBe(false);
});

test('用量按范围保留：资源清单随快照变化不算换了范围', () => {
  expect(sameUsageScope(key({ scope: 'project', projectId: 'p', resourceIds: ['r1'] }), { scope: 'project', projectId: 'p', resourceIds: ['r1', 'r2'] } as never)).toBe(true);
  expect(sameUsageScope(key({ scope: 'project', projectId: 'p' }), { scope: 'project', projectId: 'q' })).toBe(false);
  expect(sameUsageScope(key({ scope: 'project', projectId: 'p' }), { scope: 'all' })).toBe(false);
});

test('趋势时间窗前移只换起止时间：保留上一份曲线；换资源、指标或容器按新查询载入', () => {
  const history = (request: unknown) => ['cluster', 'history', request];
  const base = { scope: 'node', resourceId: 'node-a', metrics: ['cpu', 'memory'], from: '2026-09-23T00:00:00.000Z', to: '2026-09-23T01:00:00.000Z' };
  expect(sameApartFromWindow(history(base), { ...base, from: '2026-09-23T00:01:00.000Z', to: '2026-09-23T01:01:00.000Z' })).toBe(true);
  expect(sameApartFromWindow(history(base), { ...base, resourceId: 'node-b' })).toBe(false);
  expect(sameApartFromWindow(history(base), { ...base, metrics: ['cpuRequested'] })).toBe(false);
  expect(sameApartFromWindow(history(base), { ...base, scope: 'container', container: 'app' })).toBe(false);
  // 快照不同不算同一趋势查询：只忽略起止时间。
  expect(sameApartFromWindow(history({ ...base, snapshotId: 'a' }), { ...base, snapshotId: 'b' })).toBe(false);
});
