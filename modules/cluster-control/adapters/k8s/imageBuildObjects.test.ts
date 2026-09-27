import { expect, test } from 'bun:test';
import type { RuntimeImageBuildRender } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { imageBuildRenderOf } from '../../domain/imageBuildRender';
import { imageBuildJobObject, imageBuildSecretObject } from './imageBuildObjects';
import { createFakeK8sClient } from '@crewstation/k8s';
import { kubernetesClusterWriter } from './managedObjects';

function imageBuildPlan(): RuntimeImageBuildRender {
  return { buildId: newResourceId(), resourceId: newResourceId(), executionEpoch: 1, projectId: newResourceId(), projectSlug: 'image-demo', namespace: 'cs-image-demo', name: 'image-build-1', secret: 'image-build-1-secret', architecture: 'linux/amd64', clientImage: 'builder-client:fixed', builderImage: 'buildkit:fixed-rootless', repository: 'registry.internal:5000/runtime/projects/p1/build/image', destination: 'registry.test/runtime/projects/p1/build/image:artifact', checkoutCommand: ['sh', '-c', 'checkout'], clientCommand: ['sh', '-c', 'build'], daemonCommand: ['sh', '-c', 'daemon'], secretIds: ['npm'], builderResources: { cpu: '2', memory: '4Gi', ephemeralStorage: '8Gi' }, clientResources: { cpu: '500m', memory: '512Mi', ephemeralStorage: '2Gi' }, workspaceSize: '2Gi', cacheSize: '8Gi', activeDeadlineSeconds: 1800, ttlSecondsAfterFinished: 3600 };
}

test('实际 daemon/client 均受限，Git 凭据仅 checkout 可见，缓存与 socket 不跨 build', () => {
  const plan = imageBuildPlan(), object = imageBuildJobObject(plan);
  const spec = object.spec as { backoffLimit: number; template: { spec: { automountServiceAccountToken: boolean; hostNetwork?: boolean; volumes: Array<Record<string, unknown>>; containers: Array<{ name: string; securityContext: Record<string, unknown>; resources: unknown; volumeMounts: Array<{ name: string }> }>; initContainers: Array<{ name: string; volumeMounts: Array<{ name: string }> }> } } };
  const pod = spec.template.spec;
  expect(object.metadata.labels?.['crewstation.io/image-build']).toBe(plan.buildId);
  expect(object.metadata.labels).not.toHaveProperty('crewstation.io/release');
  expect(spec.backoffLimit).toBe(0);
  expect(pod.automountServiceAccountToken).toBe(false); expect(pod.hostNetwork).not.toBe(true);
  expect(pod.volumes.some((v) => 'hostPath' in v || 'persistentVolumeClaim' in v)).toBe(false);
  expect(pod.containers.find((c) => c.name === 'buildkitd')).toMatchObject({ resources: { limits: { cpu: '2', memory: '4Gi', 'ephemeral-storage': '8Gi' } }, securityContext: { runAsUser: 1000, privileged: false } });
  expect(pod.containers.find((c) => c.name === 'buildctl')).toMatchObject({ resources: { limits: { cpu: '500m', memory: '512Mi', 'ephemeral-storage': '2Gi' } } });
  expect(pod.containers.every((c) => !c.volumeMounts.some((m) => m.name === 'git'))).toBe(true);
  expect(pod.initContainers[0]?.volumeMounts.map((m) => m.name)).toEqual(['workspace', 'git']);
  expect(pod.containers.find((c) => c.name === 'buildkitd')?.volumeMounts.map((m) => m.name)).toEqual(['cache', 'socket']);
  expect(imageBuildSecretObject(plan, { 'git-token': 'token' })).toMatchObject({ immutable: true });
});
test('镜像构建 render 必须匹配完整子对象，Secret 创建幂等不重复取凭据', async () => {
  const plan = imageBuildPlan(), children = [{ kind: 'Job', namespace: plan.namespace, name: plan.name }, { kind: 'Secret', namespace: plan.namespace, name: plan.secret }];
  expect(imageBuildRenderOf({ runtimeImageBuild: plan, children })).toEqual(plan);
  expect(imageBuildRenderOf({ runtimeImageBuild: plan, children: children.slice(0, 1) })).toBeUndefined();
  expect(imageBuildRenderOf({ runtimeImageBuild: { ...plan, releaseId: 'fake' }, children })).toBeUndefined();
  const writer = kubernetesClusterWriter(createFakeK8sClient());
  let reads = 0;
  const values = async () => { reads++; return { 'git-token': 'token', 'docker-config': '{}' }; };
  expect((await writer.ensureImageBuildSecret!(plan, values)).created).toBe(true);
  expect((await writer.ensureImageBuildSecret!(plan, values)).created).toBe(false);
  expect(reads).toBe(1);
  expect((await writer.ensureImageBuildJob!(plan)).created).toBe(true);
  expect((await writer.ensureImageBuildJob!(plan)).created).toBe(false);
});

test('直接编写构建只向准备容器挂输入，不挂 Git token，也不把推送凭据放入上下文', () => {
  const plan = { ...imageBuildPlan(), inlineFileCount: 2, secretIds: [] }, job = imageBuildJobObject(plan);
  type Spec = { template: { spec: { volumes: Array<{ name: string; secret?: { items: Array<{ key: string; path: string }> } }>; initContainers: Array<{ volumeMounts: Array<{ name: string }> }>; containers: Array<{ volumeMounts: Array<{ name: string }> }> } } };
  const spec = (job.spec as Spec).template.spec;
  expect(spec.volumes.find((v) => v.name === 'git')).toBeUndefined();
  expect(spec.volumes.find((v) => v.name === 'context-input')!.secret!.items).toEqual([{ key: 'context-dockerfile', path: 'dockerfile' }, { key: 'context-file-0', path: 'file-0' }, { key: 'context-file-1', path: 'file-1' }]);
  expect(spec.initContainers[0]!.volumeMounts.map((m) => m.name)).toEqual(['workspace', 'context-input']);
  expect(spec.containers.flatMap((c) => c.volumeMounts).some((m) => m.name === 'context-input')).toBe(false);
  const empty = imageBuildJobObject({ ...plan, inlineFileCount: 0 });
  expect((empty.spec as Spec).template.spec.volumes.find((v) => v.name === 'context-input')!.secret!.items).toHaveLength(1);
});
