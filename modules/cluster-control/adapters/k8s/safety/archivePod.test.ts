import { expect, test } from 'bun:test';
import { TaskIdSchema, WORKLOAD_STOP_FINALIZER } from '@crewstation/contracts';
import { createFakeK8sClient, LABELS, Resources } from '@crewstation/k8s';
import type { WorkloadPodRender } from '../../../domain/workloadRender';
import { workloadRenderOf } from '../../../domain/workloadRender';
import { workloadPodObject } from '../workloadObjects';
import { assertPinnedVolume } from '../pinnedVolume';

const taskId = TaskIdSchema.parse(Bun.randomUUIDv7()), executionId = TaskIdSchema.parse(Bun.randomUUIDv7());
function pod(patch: Partial<WorkloadPodRender> = {}): WorkloadPodRender {
  return { name: 'archive-one', namespace: 'cs-test', taskId: executionId, image: `cs-archive@sha256:${'a'.repeat(64)}`, workerUid: 10001,
    resources: { cpu: '100m', memory: '256Mi', storage: '32Mi' }, workload: 'archive-helper', project: 'test', service: 'sample', pvc: 'task-work',
    secret: 'archive-one-grant', expectedVolumeUid: 'original-pvc', consumerVolumeUid: 'original-pvc', archive: { ownerTaskId: taskId },
    consumer: { id: Bun.randomUUIDv7(), taskId, revision: 1, purpose: 'archive', finalization: { operationId: Bun.randomUUIDv7(), revision: 1 } }, ...patch };
}
test('archive and binding helpers validate the original task-owned PVC before Pod creation', async () => {
  const k8s = createFakeK8sClient(), input = pod();
  const volume = { apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: { name: input.pvc!, namespace: input.namespace, uid: input.expectedVolumeUid!, labels: { [LABELS.task]: taskId } }, status: { phase: 'Bound' } };
  await k8s.create(volume);
  // Real finalization used the distinct archive execution ID here and rejected its own original task volume.
  for (const bindOnly of [false, true]) await expect(assertPinnedVolume(k8s, pod({ archive: { ownerTaskId: taskId, bindOnly } }))).resolves.toBeUndefined();
  for (const metadata of [{ ...volume.metadata, uid: 'replacement' }, { ...volume.metadata, labels: { [LABELS.task]: executionId } }, { ...volume.metadata, deletionTimestamp: new Date().toISOString() }]) {
    await k8s.apply({ ...volume, metadata });
    await expect(assertPinnedVolume(k8s, input)).rejects.toThrow('工作卷实例已变化');
  }
  await k8s.delete(Resources.PersistentVolumeClaim!, input.pvc!, input.namespace);
  await expect(assertPinnedVolume(k8s, input)).rejects.toThrow('工作卷实例已变化');
});
test('archive has one readonly work subPath, bounded scratch and a first gate without work; no parent, root init or Runner credentials', () => {
  const rendered = workloadPodObject(pod()), serialized = JSON.stringify(rendered);
  const spec = rendered.spec as { containers: Array<Record<string, unknown>>; volumes: unknown[]; initContainers: Array<Record<string, unknown>>; automountServiceAccountToken: boolean; restartPolicy: string };
  expect(rendered.metadata.finalizers).toEqual([WORKLOAD_STOP_FINALIZER]);
  expect(spec.automountServiceAccountToken).toBe(false); expect(spec.restartPolicy).toBe('Never'); expect(spec.containers).toHaveLength(1); expect(spec.initContainers).toHaveLength(1);
  expect(spec.initContainers[0]!.volumeMounts).toEqual([{ name: 'workload-admission', mountPath: '/run/admission', readOnly: true }]);
  expect((spec.initContainers[0]!.command as string[])[2]).toContain('/opt/crewstation/bin/archive-helper storage-contract 1');
  expect(spec.containers[0]).toMatchObject({ command: ['/usr/bin/tini', '--', '/opt/crewstation/bin/archive-helper'], securityContext: { runAsUser: 10001, readOnlyRootFilesystem: true, runAsNonRoot: true },
    volumeMounts: [{ name: 'work', mountPath: '/work', readOnly: true }, { name: 'scratch', mountPath: '/tmp' }] });
  expect(spec.volumes).toContainEqual({ name: 'work', persistentVolumeClaim: { claimName: 'task-work', readOnly: true } });
  expect(spec.volumes).toContainEqual({ name: 'scratch', emptyDir: { sizeLimit: '16Mi' } });
  for (const secret of ['CS_DATABASE_URL', 'CS_GIT_TOKEN', 'CS_RUNNER_TOKEN', 'prepare-business-volume', 'journal', 'native-session']) expect(serialized).not.toContain(secret);
});
test('mutable images, unregistered/different volumes and ordinary task fields cannot render an archive Pod', () => {
  for (const patch of [{ image: 'cs-archive:latest' }, { workerUid: 0 }, { consumerVolumeUid: 'replacement' }, { checkout: { repoUrl: 'https://scm', branch: 'main', credentialSecretName: 'git' } }, { businessStorage: { version: 1 as const, ownerTaskId: taskId, initialize: false } }]) expect(() => workloadPodObject(pod(patch))).toThrow();
});
test('archive render parsing has no live parent requirement and rejects mixing preview or Runner initialization', () => {
  const input = pod(), { name: _name, namespace: _namespace, taskId: _task, consumerVolumeUid: _uid, ...spec } = input;
  const children = [{ kind: 'Pod', name: input.name, namespace: input.namespace }];
  expect(workloadRenderOf(executionId, { children, pod: spec })?.pod.archive).toEqual({ ownerTaskId: taskId });
  for (const patch of [{ nodeName: 'old-node' }, { runtimeInitialization: true }, { archive: { ownerTaskId: Bun.randomUUIDv7() } }]) expect(workloadRenderOf(executionId, { children, pod: { ...spec, ...patch } })).toBeUndefined();
  expect(workloadRenderOf(executionId, { children, pod: spec, preview: { port: 8080 } })).toBeUndefined();
});
test('volume binding helper participates in scheduling and admission without mounting data or receiving credentials', () => {
  const input = pod({ archive: { ownerTaskId: taskId, bindOnly: true } }), object = workloadPodObject(input);
  const spec = object.spec as { containers: Array<{ command: string[]; env: unknown[]; volumeMounts: Array<{ name: string }> }>; volumes: unknown[] };
  expect(spec.containers[0]!.command).toEqual(['/bin/true']);
  expect(spec.containers[0]!.env).toEqual([{ name: 'CS_RUNTIME_POD_UID', valueFrom: { fieldRef: { fieldPath: 'metadata.uid' } } }]);
  expect(spec.containers[0]!.volumeMounts.some((m) => m.name === 'work')).toBe(false);
  expect(spec.volumes).toContainEqual({ name: 'work', persistentVolumeClaim: { claimName: 'task-work', readOnly: true } });
  expect(object.metadata.finalizers).toContain(WORKLOAD_STOP_FINALIZER);
  const { name: _name, namespace: _namespace, taskId: _task, consumerVolumeUid: _uid, ...render } = input;
  const children = [{ kind: 'Pod', name: input.name, namespace: input.namespace }];
  expect(workloadRenderOf(executionId, { children, pod: render })?.pod.archive?.bindOnly).toBe(true);
  expect(workloadRenderOf(executionId, { children, pod: { ...render, archive: { ownerTaskId: taskId, bindOnly: 'yes' } } })).toBeUndefined();
});
