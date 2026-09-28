import { expect, test } from 'bun:test';
import { TaskIdSchema } from '@crewstation/contracts';
import { newResourceId, noopLogger } from '@crewstation/kernel';
import type { ClusterWriter, ManagedObjectFeed } from '../ports/cluster';
import type { LedgerObservations, LedgerRecordView } from '../ports/ledger';
import { newObservationStats } from './observeChange';
import { applyArchive } from './archiveApply';

test('replaying an existing archive Pod cannot activate its gate before the credential binding commits', async () => {
  const taskId = TaskIdSchema.parse(newResourceId()), id = newResourceId(), consumerId = newResourceId(), operationId = newResourceId();
  const volumeUid = crypto.randomUUID(), podUid = crypto.randomUUID(), calls: string[] = [];
  let bindingFails = true;
  const record: LedgerRecordView = { id, kind: 'archive-execution', desired: 'present', generation: 1, phase: 'provisioning', children: [], conditions: [{ type: 'Provisioning', status: 'true' }],
    spec: { children: [{ kind: 'Pod', namespace: 'cs-archive', name: 'archive-one' }, { kind: 'Secret', namespace: 'cs-archive', name: 'archive-one-grant' }],
      pod: { image: `task@sha256:${'a'.repeat(64)}`, workerUid: 10001, resources: { cpu: '1', memory: '1Gi', storage: '1Gi' }, workload: 'archive-helper', project: 'demo', service: 'demo', pvc: 'work', secret: 'archive-one-grant',
        expectedVolumeUid: volumeUid, archive: { ownerTaskId: taskId }, consumer: { id: consumerId, taskId, revision: 1, purpose: 'archive', finalization: { operationId, revision: 1 } } } } };
  const consumer = { volumeUid };
  const ledger = { get: async () => record, observeConditions: async () => ({ status: 'recorded' }), workloadSafety: {
    get: async () => ({ consumer, admissionClosed: false }), register: async () => { calls.push('register'); return { consumer, admissionClosed: false }; },
    grantStart: async () => { calls.push('grant'); },
  } } as unknown as LedgerObservations;
  const feed = { cached: () => ({ metadata: { uid: volumeUid } }) } as unknown as ManagedObjectFeed;
  const cluster = { inspectWorkloadStart: async () => { calls.push('inspect'); return { podUid, nodeName: 'node', nodeUid: crypto.randomUUID() }; },
    activateWorkload: async () => { calls.push('activate'); }, ensureRunnerSecret: async () => { calls.push('secret'); return { uid: 'secret', created: false }; },
    ensurePod: async () => { calls.push('pod'); return { uid: podUid, created: false }; },
  } as unknown as ClusterWriter;
  const deps = { ledger, feed, cluster, stats: newObservationStats(), logger: noopLogger, archives: { values: async () => ({}), bind: async () => { calls.push('bind'); if (bindingFails) throw new Error('binding unavailable'); } } };
  await expect(applyArchive(deps, record, () => {})).rejects.toThrow('binding unavailable');
  expect(calls).toEqual(['register', 'secret', 'pod', 'bind']);
  bindingFails = false; calls.length = 0;
  await applyArchive(deps, record, () => {});
  expect(calls).toEqual(['register', 'secret', 'pod', 'bind', 'inspect', 'grant', 'activate']);
  calls.length = 0;
  await applyArchive(deps, { ...record, conditions: [{ type: 'Provisioning', status: 'false' }] }, () => {});
  expect(calls).toEqual(['inspect', 'grant', 'activate']);
});
