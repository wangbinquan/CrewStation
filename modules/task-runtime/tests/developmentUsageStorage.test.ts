// RFC-034: new-Pod numeric emptyDir leaves old workspaces and the business PVC layout intact.
import { expect, test } from 'bun:test';
import { DEVELOPMENT_USAGE_BINDING_DIRECTORY, DEVELOPMENT_USAGE_DIRECTORY, DevelopmentUsageRuntimeConfigSchema, ProjectIdSchema, ServiceIdSchema, TaskIdSchema, TraceIdSchema } from '@crewstation/contracts';
import { createFakeK8sClient, Resources } from '@crewstation/k8s';
import type { TaskEnvironment } from '../domain/taskEnvironment';
import { containerEnv } from '../application/containerEnv';
import { taskPodObject } from '../adapters/k8s/taskObjects';
import { kubernetesNativeExecutions } from '../adapters/k8s/nativeExecutions';

const id = (n: number) => `019f0000-0000-7000-8000-${String(n).padStart(12, '0')}`;
function environment(selected = true): TaskEnvironment {
  const resources = { cpu: '1', memory: '2Gi', storage: '10Gi' };
  return { id: TaskIdSchema.parse(id(3)), projectId: ProjectIdSchema.parse(id(1)), serviceId: ServiceIdSchema.parse(id(6)), kind: 'dev-session', state: 'creating', volumeMode: 'persistent', profile: id(5), namespace: 'cs-unit', podName: 'agent-unit', pvcName: 'original-work', traceId: TraceIdSchema.parse('a'.repeat(32)), labels: { 'crewstation.io/project': 'project-name', 'crewstation.io/service': 'service-name' }, runnerTokenHash: 'hash', connected: false, createdAt: new Date(), updatedAt: new Date(), lastActivityAt: new Date(),
    render: { image: 'task@sha256:test', workerUid: 10001, resources, start: 1, ...(selected ? { developmentUsageStorage: { version: 1 } } : {}) },
    native: { purpose: 'agent', parentTaskId: TaskIdSchema.parse(id(2)), parentPodUid: 'parent-pod', pvcUid: 'original-pvc', nodeName: 'original-node', agentId: id(4), runnerId: '8dc512c9-cc5d-4c20-8591-3e2546456d67', fingerprint: 'a'.repeat(64), requestedProfile: null, profile: { id: id(5), name: 'Named compute', ...resources }, image: 'task@sha256:test', state: 'queued' } };
}
const deps: Parameters<typeof containerEnv>[0] = { sources: { configEnv: async () => ({ CS_RUNNER_DEVELOPMENT_USAGE: 'untrusted-tenant-value' }), dataEnv: async () => ({}), taskDataEnv: async () => ({}) }, settings: { taskImage: 'task:dev', systemNamespace: 'cs-system', sessionUrl: 'ws://session/', userDomain: 'localhost', serviceDomain: 'svc.localhost', workerUid: 10001, defaultProfile: id(5), userAuthMiddleware: 'auth', dropIdentityHeadersMiddleware: 'drop' } };

test('selected independent headless render has its own disk volume and trusted canonical config; old renders have neither', async () => {
  const env = environment(), values = await containerEnv(deps, env, { slug: 'project-name', name: 'service-name' }, 'runner-token');
  expect(DevelopmentUsageRuntimeConfigSchema.parse(JSON.parse(values.CS_RUNNER_DEVELOPMENT_USAGE!))).toEqual({ version: 1, directory: DEVELOPMENT_USAGE_DIRECTORY, bindingDirectory: DEVELOPMENT_USAGE_BINDING_DIRECTORY, projectId: env.projectId, workspaceTaskId: env.native!.parentTaskId });
  const pod = taskPodObject({ env, image: env.render!.image, resources: env.render!.resources, envVars: values }, 10001);
  const spec = pod.spec as { volumes: unknown[]; containers: Array<{ env: unknown[]; volumeMounts: unknown[] }> };
  expect(spec.volumes).toEqual([{ name: 'work', persistentVolumeClaim: { claimName: 'original-work' } }, { name: 'development-usage', emptyDir: {} }, { name: 'development-usage-binding', emptyDir: {} }]);
  expect(spec.containers[0]?.volumeMounts).toContainEqual({ name: 'development-usage', mountPath: DEVELOPMENT_USAGE_DIRECTORY, readOnly: false });
  expect(spec.containers[0]?.volumeMounts).toContainEqual({ name: 'development-usage-binding', mountPath: DEVELOPMENT_USAGE_BINDING_DIRECTORY, readOnly: false });
  expect(spec.containers[0]?.env).toContainEqual({ name: 'CS_RUNTIME_POD_UID', valueFrom: { fieldRef: { fieldPath: 'metadata.uid' } } });
  const old = environment(false), oldValues = await containerEnv(deps, old, { slug: 'name', name: 'service' }, 'token');
  expect(oldValues.CS_RUNNER_DEVELOPMENT_USAGE).toBeUndefined();
  expect((taskPodObject({ env: old, image: old.render!.image, resources: old.render!.resources, envVars: oldValues }, 10001).spec as typeof spec).volumes).toHaveLength(1);
  const cli = { ...env, native: { ...env.native!, purpose: 'cli' as const } };
  expect(() => taskPodObject({ env: cli, image: env.render!.image, resources: env.render!.resources, envVars: {} }, 10001)).toThrow('独立开发 Agent');
  await expect(containerEnv(deps, cli, { slug: 'name', name: 'service' }, 'token')).rejects.toThrow('独立开发 Agent');
});

test('native recovery verifies only selected private layouts; a changed mount, medium or Pod UID binding is rejected', async () => {
  const k8s = createFakeK8sClient(), env = environment(), cluster = kubernetesNativeExecutions(k8s, 10001);
  const first = await cluster.prepare(env, async () => ({ CS_RUNNER_TOKEN: 'private-token' }));
  expect((await cluster.prepare(env, async () => { throw new Error('must reuse original secret'); })).podUid).toBe(first.podUid);
  const original = (await k8s.get(Resources.Pod!, env.podName, env.namespace))!;
  const originalVolumes = (original.spec as { volumes: Array<{ name: string }> }).volumes;
  const originalMounts = (original.spec as { containers: Array<{ volumeMounts: Array<{ name: string }> }> }).containers[0]!.volumeMounts;
  for (const patch of [
    { volumes: originalVolumes.filter((v) => v.name !== 'development-usage-binding') },
    { volumes: originalVolumes.map((v) => v.name === 'development-usage-binding' ? { name: v.name, emptyDir: { medium: 'Memory' } } : v) },
    { containers: [{ ...(original.spec as { containers: object[] }).containers[0], volumeMounts: originalMounts.map((v) => v.name === 'development-usage-binding' ? { ...v, mountPath: DEVELOPMENT_USAGE_DIRECTORY } : v) }] },
    { volumes: [{ name: 'work', persistentVolumeClaim: { claimName: env.pvcName } }, { name: 'development-usage', emptyDir: { medium: 'Memory' } }] },
    { containers: [{ ...(original.spec as { containers: object[] }).containers[0], volumeMounts: [{ name: 'work', mountPath: '/work' }, { name: 'development-usage', mountPath: '/work/numeric' }] }] },
    { containers: [{ ...(original.spec as { containers: object[] }).containers[0], env: [{ name: 'CS_RUNTIME_POD_UID', value: 'untrusted' }] }] },
  ]) {
    await k8s.mergePatch(Resources.Pod!, env.podName, env.namespace, { spec: patch });
    await expect(cluster.prepare(env, async () => ({ CS_RUNNER_TOKEN: 'token' }))).rejects.toThrow('私有日志布局');
    await k8s.mergePatch(Resources.Pod!, env.podName, env.namespace, { spec: original.spec });
  }
  expect((await cluster.prepare(env, async () => ({}))).podUid).toBe(first.podUid);
});
