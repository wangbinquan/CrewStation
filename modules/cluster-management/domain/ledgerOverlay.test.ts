import { expect, test } from 'bun:test';
import type { ClusterLedger, ClusterResource } from '@crewstation/contracts';
import { claimKey, MAINTAINED_REASON, VOLUME_REASON, withLedger } from './ledgerOverlay';

const row = (kind: string, name: string, deleteEnabled = true): ClusterResource => ({
  resourceId: 'r', apiVersion: 'v1', kind, namespace: kind === 'Namespace' ? '' : 'cs-demo', name, uid: `uid-${name}`, resourceVersion: '1', revision: '1', observedAt: 't', view: 'network',
  ownership: { scope: 'project', projectId: 'p', projectName: '演示', slug: 'demo', projectKind: 'DigitalWorker', archived: false }, purpose: 'digital-worker-service', phase: 'Active', ready: true, abnormal: false, reason: '',
  topLevel: true, standalone: false, restarts: 0, labels: {}, owners: [], references: [], containers: [], facts: {},
  availableActions: [{ action: 'restart', enabled: false, reason: '该资源不支持此操作', executionRoute: 'none', impactSummary: [] }, { action: 'delete', enabled: deleteEnabled, reason: deleteEnabled ? '' : '仍被引用', executionRoute: deleteEnabled ? 'kubernetes' : 'none', impactSummary: deleteEnabled ? ['按 UID 删除'] : [] }],
});
const ledger = (patch: Partial<ClusterLedger> = {}): ClusterLedger => ({ id: '01a0cf2b-22e3-7000-a175-bb5d1536723d', kind: 'route', phase: 'ready', phaseSince: '2026-09-24T01:00:00.000Z', actions: [], version: 1, maintained: true, ...patch });

test('maintained objects keep every action but delete, which is disabled with where to go instead', () => {
  const overlaid = withLedger(row('IngressRoute', 'demo-prod'), ledger());
  expect(overlaid.ledger?.maintained).toBe(true);
  expect(overlaid.availableActions[0]).toEqual(row('IngressRoute', 'demo-prod').availableActions[0]!);
  expect(overlaid.availableActions[1]).toEqual({ action: 'delete', enabled: false, reason: MAINTAINED_REASON, executionRoute: 'none', impactSummary: [] });
});

test('volumes point to the pending-reclaim list; other claimed rows keep their actions; unclaimed rows are unchanged', () => {
  expect(withLedger(row('PersistentVolumeClaim', 'task-work', false), ledger({ kind: 'volume', maintained: false })).availableActions[1]).toMatchObject({ enabled: false, reason: VOLUME_REASON });
  const pod = withLedger(row('Pod', 'task-1'), ledger({ kind: 'dev-workspace', maintained: false, actions: [{ id: 'release', enabled: true }] }));
  expect(pod.availableActions).toEqual(row('Pod', 'task-1').availableActions);
  expect(pod.ledger?.actions).toEqual([{ id: 'release', enabled: true }]);
  const plain = row('ConfigMap', 'settings');
  expect(withLedger(plain, undefined)).toBe(plain);
});

test('read-only views drop the record actions too, and claim keys match cluster-scoped and namespaced objects alike', () => {
  expect(withLedger(row('Pod', 'task-1'), ledger({ kind: 'dev-workspace', maintained: false, actions: [{ id: 'release', enabled: true }] }), true).ledger?.actions).toEqual([]);
  expect(claimKey(row('Namespace', 'cs-demo'))).toBe(claimKey({ kind: 'Namespace', name: 'cs-demo' }));
  expect(claimKey(row('NetworkPolicy', 'crewstation-default'))).toBe('NetworkPolicy/cs-demo/crewstation-default');
});
