import { expect, test } from 'bun:test';
import type { TaskId } from '@crewstation/contracts';
import { createFakeK8sClient, LABELS, Resources } from '@crewstation/k8s';
import { newResourceId } from '@crewstation/kernel';
import { kubernetesNativeExecutions } from '../adapters/k8s/nativeExecutions';
import { kubernetesTaskRecoveryCluster } from '../adapters/k8s/taskRecoveryCluster';
import { assertRebuildObject } from '../adapters/k8s/rebuildObjects';
import { rebuildIntent } from '../domain/physicalIdentity';
import type { EnvironmentRebuild } from '../domain/environmentRebuild';
import type { TaskEnvironment } from '../domain/taskEnvironment';

test('升级后复用原 CLI Pod、Secret 和工作卷，标签与实例校验仍有效', async () => {
  const k8s = createFakeK8sClient(), cluster = kubernetesNativeExecutions(k8s, 10001);
  const old = { id: 'tsk_old-child', projectId: 'prj_old', serviceId: 'svc_old', kind: 'dev-session', namespace: 'cs-legacy', podName: 'cli-original', pvcName: 'original-work', labels: {},
    native: { parentTaskId: 'tsk_old-parent', parentPodUid: 'parent-uid', pvcUid: 'volume-uid', nodeName: 'node-1', agentId: 'agt_original', terminalId: 'pty_original', runnerId: 'original-runner', fingerprint: 'request-fingerprint',
      profile: { name: 'coding-medium', cpu: '1', memory: '2Gi', storage: '10Gi' }, image: 'task:original', state: 'queued' } } as TaskEnvironment;
  const prepared = await cluster.prepare(old, async () => ({ CS_RUNNER_TOKEN: 'original-token' }));
  const env: TaskEnvironment = { ...old, id: newResourceId() as TaskId, legacyCluster: { taskId: old.id, native: old.native },
    native: { ...old.native!, ...prepared, parentTaskId: newResourceId() as TaskId, agentId: newResourceId(), terminalId: newResourceId(), runnerId: newResourceId(), profile: { ...old.native!.profile, id: newResourceId() } } };
  const before = structuredClone([...k8s.objects]);
  expect(await cluster.prepare(env, async () => { throw new Error('must retain original secret'); })).toEqual(prepared);
  expect([...k8s.objects]).toEqual(before);
  await k8s.mergePatch(Resources.Pod!, env.podName, env.namespace, { metadata: { labels: { [LABELS.task]: 'another-task' } } });
  await expect(cluster.prepare(env, async () => ({}))).rejects.toThrow('归属或实例已变化');
  expect(k8s.deleted).toHaveLength(0);
  await k8s.mergePatch(Resources.Pod!, env.podName, env.namespace, { metadata: { labels: { [LABELS.task]: old.id } } });
  await cluster.cleanup(env);
  expect(k8s.deleted).toHaveLength(2);
});

test('原工作卷通过冻结旧标签识别，同名异主工作卷保持拒绝', async () => {
  const k8s = createFakeK8sClient();
  const env = { id: newResourceId(), podName: 'old-pod', pvcName: 'old-work', namespace: 'cs-legacy', legacyCluster: { taskId: 'tsk_legacy' } } as TaskEnvironment;
  await k8s.create({ apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: { name: env.pvcName, namespace: env.namespace, uid: 'original-uid', labels: { [LABELS.task]: 'tsk_legacy' } }, status: { phase: 'Bound' } });
  const cluster = kubernetesTaskRecoveryCluster(k8s);
  expect((await cluster.inspect(env)).volume).toMatchObject({ uid: 'original-uid', belongsToTask: true });
  expect((await cluster.inspect({ ...env, legacyCluster: undefined })).volume?.belongsToTask).toBe(false);
  expect(k8s.deleted).toHaveLength(0);
});

test('已受理的恢复保留原标签和指纹，禁止混用不同恢复请求的资源', () => {
  const old = { id: 'old-request', taskId: 'tsk_old', input: { expectedVolumeUid: 'original-volume', profile: { name: 'coding-medium', cpu: '1' } }, image: 'task:old', secretName: 'original-secret' } as EnvironmentRebuild;
  const current = { ...old, id: newResourceId(), taskId: newResourceId() as TaskId, input: { ...old.input, profile: { ...old.input.profile, id: newResourceId() } },
    legacyCluster: { taskId: old.taskId, rebuildId: old.id, profile: old.input.profile } };
  const pod = { apiVersion: 'v1', kind: 'Pod', metadata: { name: 'old-pod', uid: 'original-uid', labels: { [LABELS.task]: old.taskId, 'crewstation.io/rebuild': old.id } } };
  expect(assertRebuildObject(pod, current, 'original-uid')).toBe('original-uid');
  expect(rebuildIntent(current, true)).toBe(rebuildIntent(old));
  expect(rebuildIntent(current)).not.toBe(rebuildIntent(old));
  expect(() => assertRebuildObject(pod, current, 'replacement')).toThrow('实例或归属已变化');
  expect(() => assertRebuildObject({ ...pod, metadata: { ...pod.metadata, labels: { ...pod.metadata.labels, [LABELS.task]: current.taskId } } }, current)).toThrow('实例或归属已变化');
});
