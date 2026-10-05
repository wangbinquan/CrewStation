import { expect, test } from 'bun:test';
import { createFakeK8sClient, Resources } from '@crewstation/k8s';
import { newResourceId, noopLogger } from '@crewstation/kernel';
import { kubernetesClusterWriter } from '../adapters/k8s/managedObjects';
import { reconcileRecord } from '../application/reconcileObservations';
import { newObservationStats } from '../application/observeChange';
import type { LedgerObservations, LedgerRecordView } from '../ports/ledger';

function fixture(projectId?: string) {
  const k8s = createFakeK8sClient(), record: LedgerRecordView = { id: newResourceId(), kind: 'namespace', ...(projectId ? { projectId } : {}), desired: 'present', generation: 1, phase: 'declared', children: [], conditions: [],
    spec: { children: [{ kind: 'Namespace', name: 'cs-admission' }, { kind: 'ResourceQuota', namespace: 'cs-admission', name: 'quota' }], labels: {}, quota: { hard: { pods: '10' } } } };
  const ledger: LedgerObservations = { get: async () => record, listLive: async () => [record], children: async () => [], changesSince: async () => [], latestChange: async () => 0, claimOf: async () => undefined,
    observe: async () => ({ status: 'unchanged' }), observeConditions: async () => ({ status: 'unchanged' }), adoptOrphanVolume: async () => {} };
  const deps = { ledger, cluster: kubernetesClusterWriter(k8s), feed: { start: () => {}, stop: async () => {}, synced: async () => {}, cached: () => undefined, list: () => [] },
    clock: { now: () => new Date() }, systemNamespace: 'system', stats: newObservationStats(), logger: noopLogger };
  return { k8s, record, ledger, deps, run: () => reconcileRecord(deps, record.id, () => {}) };
}
test('an existing project admission never receives undefined for a platform resource; actual project creation still uses its original guard', async () => {
  for (const projectId of [undefined, newResourceId()]) {
    const f = fixture(projectId), admitted: string[] = [];
    f.ledger.withProjectAdmission = async (id, work) => { if (!id) throw Error('A platform resource is not a project'); admitted.push(id); await work(); return true; };
    // Actual full-gate failure: sending undefined to the old project-only
    // callback prevented the platform profile-test Pod from being created.
    await f.run(); expect(admitted).toEqual(projectId ? [projectId] : []);
    expect(await f.k8s.get(Resources.Namespace!, 'cs-admission')).toBeDefined();
  }
});
test('the root creation admission receives the original platform record and protects both actual writes; denial applies none', async () => {
  for (const permitted of [true, false]) {
    const f = fixture(); let inside = false, calls = 0;
    const apply = f.k8s.apply;
    f.k8s.apply = async (object, options) => { expect(inside).toBe(true); calls++; return apply(object, options); };
    f.ledger.withProjectAdmission = async () => { throw Error('The complete creation owner supersedes the old callback'); };
    f.ledger.withCreationAdmission = async (projectId, work, record) => {
      expect(projectId).toBeUndefined(); expect(record).toBe(f.record);
      if (!permitted) return false; inside = true; try { await work(); } finally { inside = false; } return true;
    };
    await f.run(); expect(calls).toBe(permitted ? 2 : 0);
    expect(Boolean(await f.k8s.get(Resources.Namespace!, 'cs-admission'))).toBe(permitted);
  }
});
