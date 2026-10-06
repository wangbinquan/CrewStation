import { expect, test } from 'bun:test';
import type { ProjectDeletionTarget } from '@crewstation/contracts';
import { createFakeK8sClient, LABELS } from '@crewstation/k8s';
import type { K8sObject } from '@crewstation/k8s';
import { deletionCurrentAssets } from './deletionCurrentAssets';

const target = { id: Bun.randomUUIDv7(), slug: 'delete-target', namespace: 'cs-target' } as ProjectDeletionTarget;
const pod = (name: string, labels: Record<string, string> = {}, phase = 'Running'): K8sObject => ({ apiVersion: 'v1', kind: 'Pod', metadata: { name, namespace: 'foreign', uid: name + '-uid', labels }, status: { phase } });
test('current witness reads beyond the first Pod page, rejects live/replaced consumers and binds target references without writes', async () => {
  const k8s = createFakeK8sClient();
  for (let i = 0; i < 501; i++) await k8s.apply(pod('unrelated-' + i));
  await k8s.apply(pod('original', { execution: 'old-execution', [LABELS.project]: target.id }));
  const reader = deletionCurrentAssets(k8s), query = { ids: ['old-execution'] }, result = await reader.inspect(target, query);
  expect(result.complete).toBe(true); expect(result.activeConsumers).toEqual(['foreign/original@original-uid']); expect(result.targetReferences).toEqual(result.activeConsumers);
  expect(k8s.deleted).toEqual([]);
  await k8s.apply(pod('unrelated-new')); expect((await reader.inspect(target, query)).digest).toBe(result.digest);
  await k8s.apply(pod('original', { execution: 'old-execution' }, 'Succeeded'));
  expect((await reader.inspect(target, query)).activeConsumers).toEqual([]);
  expect((await reader.inspect(target, { ids: [], pods: [{ namespace: 'foreign', name: 'original', uid: 'replaced-old-uid' }] })).activeConsumers).toHaveLength(1);
});
test('current witness rejects partial/stale/repeated pages, missing physical UID and unavailable sources', async () => {
  for (const failure of ['revision', 'cursor', 'uid', 'missing-revision', 'unavailable']) {
    const k8s = createFakeK8sClient(); let calls = 0;
    k8s.listPage = async () => {
      calls++; if (failure === 'unavailable') throw new Error('offline');
      const selected = pod('selected', { execution: 'old-execution' }); if (failure === 'uid') delete selected.metadata.uid;
      return { items: [selected], resourceVersion: failure === 'missing-revision' ? '' : failure === 'revision' && calls > 1 ? '2' : '1', continue: ['uid', 'missing-revision'].includes(failure) ? '' : 'repeated' } as never;
    };
    await expect(deletionCurrentAssets(k8s).inspect(target, { ids: ['old-execution'] })).rejects.toThrow();
    expect(calls).toBeLessThanOrEqual(2); expect(k8s.deleted).toEqual([]);
  }
});

test('physical current witness binds every regular/init/ephemeral container, labels and UID; incomplete consumer content cannot be used as a foreign current baseline', async () => {
  const k8s = createFakeK8sClient(), raw = pod('foreign-running', { [LABELS.project]: 'other', [LABELS.service]: 'worker' });
  raw['spec'] = { containers: [{ name: 'worker' }], initContainers: [{ name: 'init' }], ephemeralContainers: [{ name: 'debug' }] };
  raw['status'] = { phase: 'Running', containerStatuses: [{ name: 'worker', containerID: 'containerd://worker' }], initContainerStatuses: [{ name: 'init', containerID: 'containerd://init' }], ephemeralContainerStatuses: [{ name: 'debug', containerID: 'containerd://debug' }] };
  await k8s.apply(raw);
  const reader = deletionCurrentAssets(k8s), query = { ids: [], pods: [{ namespace: 'foreign', name: 'foreign-running', uid: raw.metadata.uid! }] };
  const complete = await reader.inspect(target, query);
  expect(complete.pods![0]).toMatchObject({ uid: raw.metadata.uid, containersComplete: true, phase: 'Running', terminating: false });
  expect(complete.pods![0]!.containers.map((c) => c.name)).toEqual(['debug', 'init', 'worker']);
  (raw['status'] as { ephemeralContainerStatuses: unknown[] }).ephemeralContainerStatuses = [];
  await k8s.apply(raw); const incomplete = await reader.inspect(target, query);
  expect(incomplete.pods![0]!.containersComplete).toBe(false); expect(incomplete.digest).not.toBe(complete.digest);
  raw.metadata.deletionTimestamp = '2026-10-06T08:00:00Z'; await k8s.apply(raw);
  expect((await reader.inspect(target, query)).pods![0]!.terminating).toBe(true);
  expect(k8s.deleted).toEqual([]);
});
