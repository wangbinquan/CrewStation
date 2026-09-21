import { expect, test } from 'bun:test';
import { sameApartFromSnapshot, sameUsageScope } from '../features/cluster/model/clusterReads';

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
