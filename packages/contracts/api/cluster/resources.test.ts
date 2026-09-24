import { expect, test } from 'bun:test';
import type { ClusterLedger } from './resources';
import { ClusterLedgerSchema, ClusterProjectCountsSchema, ClusterResourceSchema, ClusterSummarySchema, ProjectClusterResourcesParamsSchema, ProjectClusterResourcesQuerySchema, ProjectClusterResourcesSchema } from './resources';

// RFC-019：项目层的每项目计数可整组缺席（来源失败），项目成员的只读盘点契约不带管理动作。
test('project counts are optional as a group and the summary still parses for old servers', () => {
  expect(ClusterProjectCountsSchema.parse({ id: 'p1', name: '演示' })).toEqual({ id: 'p1', name: '演示' });
  expect(ClusterProjectCountsSchema.parse({ id: 'p1', name: '演示', workloads: 2, pods: 3, readyPods: 2, abnormal: 1, devSessions: 1 }).abnormal).toBe(1);
  expect(ClusterProjectCountsSchema.safeParse({ id: 'p1', name: '演示', pods: '3' }).success).toBe(false);
  const summary = { snapshotId: 's', startedAt: 't', finishedAt: 't', complete: true, sources: [], total: 0, workloads: 0, pods: 0, runningPods: 0, readyPods: 0, standalonePods: 0, services: 0, pvcs: 0, abnormal: 0, kinds: {}, phases: {}, purposes: {}, projects: [{ id: 'p1', name: '演示' }] };
  expect(ClusterSummarySchema.parse(summary).projects[0]).toEqual({ id: 'p1', name: '演示' });
});

test('project-scoped inventory: UUID project id, bounded snapshot id, items carry the full resource shape', () => {
  const projectId = '01a0bf5d-8f4b-7178-82e1-9a99060b1192';
  expect(String(ProjectClusterResourcesParamsSchema.parse({ projectId }).projectId)).toBe(projectId);
  expect(ProjectClusterResourcesParamsSchema.safeParse({ projectId: 'demo' }).success).toBe(false);
  expect(ProjectClusterResourcesQuerySchema.parse({})).toEqual({});
  expect(ProjectClusterResourcesQuerySchema.safeParse({ snapshotId: 'x'.repeat(201) }).success).toBe(false);
  const resource = { resourceId: 'r', apiVersion: 'v1', kind: 'Pod', namespace: 'cs-demo', name: 'p', uid: 'u', resourceVersion: '1', revision: '1', observedAt: 't', view: 'pods', ownership: { scope: 'project', projectId, projectName: '演示', slug: 'demo', projectKind: 'DigitalWorker', archived: false }, purpose: 'digital-worker-service', phase: 'Running', ready: true, abnormal: false, reason: '', topLevel: false, standalone: false, restarts: 0, labels: {}, owners: [], references: [], containers: [], facts: {}, availableActions: [] };
  const page = ProjectClusterResourcesSchema.parse({ snapshotId: 's', observedAt: 't', complete: true, sources: [], items: [resource], truncated: false });
  expect(page.items[0]?.availableActions).toEqual([]);
  expect(ProjectClusterResourcesSchema.safeParse({ snapshotId: 's', observedAt: 't', complete: true, sources: [], items: [resource] }).success).toBe(false);
});

// RFC-025 T13（I29 裁定）：台账认领的行带所属标准记录的叠加；旧服务端不带也照常解析，叠加本身按标准记录的字段严格校验。
test('ledger overlay is optional on a row and follows the standard record fields', () => {
  const projectId = '01a0bf5d-8f4b-7178-82e1-9a99060b1192';
  const row = { resourceId: 'r', apiVersion: 'v1', kind: 'PersistentVolumeClaim', namespace: 'cs-demo', name: 'task-work', uid: 'u', resourceVersion: '1', revision: '1', observedAt: 't', view: 'storage', ownership: { scope: 'project', projectId, projectName: '演示', slug: 'demo', projectKind: 'DigitalWorker', archived: false }, purpose: 'development-workspace', phase: 'Bound', ready: true, abnormal: false, reason: '', topLevel: true, standalone: false, restarts: 0, labels: {}, owners: [], references: [], containers: [], facts: {}, availableActions: [] };
  expect(ClusterResourceSchema.parse(row).ledger).toBeUndefined();
  const ledger: ClusterLedger = { id: '01a0cf2b-22e3-7000-a175-bb5d1536723d', kind: 'volume', phase: 'stopped', phaseSince: '2026-09-24T01:00:00.000Z', actions: [{ id: 'delete-volume', enabled: true }], version: 3, maintained: false };
  expect(ClusterResourceSchema.parse({ ...row, ledger }).ledger).toEqual(ledger);
  expect(ClusterLedgerSchema.safeParse({ ...ledger, phase: 'Bound' }).success).toBe(false);
  expect(ClusterLedgerSchema.safeParse({ ...ledger, spec: {} }).success).toBe(false);
  expect(ClusterLedgerSchema.safeParse({ ...ledger, maintained: undefined }).success).toBe(false);
});
