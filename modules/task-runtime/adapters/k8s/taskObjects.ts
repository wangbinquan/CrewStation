import type { K8sClient, K8sObject } from '@crewstation/k8s';
import { LABELS, protectWorkloadPod, taskPodObject as renderTaskPod, taskPreviewObjects } from '@crewstation/k8s';
import { precondition } from '@crewstation/kernel';
import { developmentWorkloadProtection } from '../../domain/development/protection';
import { runnerSecretOf } from '../../domain/taskEnvironment';
import { canonicalNativeIntent, EXECUTION_INTENT_ANNOTATION, WORKSPACE_TASK_LABEL } from '../../domain/physicalIdentity';
import { WORKLOAD_LABELS } from '../../domain/taskEnvironment';
import type { TaskEnvironment, WorkloadRender } from '../../domain/taskEnvironment';
type TaskEnvironmentWithRender = TaskEnvironment & { readonly render: WorkloadRender };
import type { TaskPodSpec } from '../../ports/cluster';

/** 任务容器的 Pod：构造函数在 `@crewstation/k8s`，资源中心的调和器渲染同一种 Pod 时用的也是它（RFC-025 设计 §6.2）。 */
export function taskPodObject({ env, image, envVars, resources, source, envSecretName, nodeName, workVolume }: TaskPodSpec, workerUid: number): K8sObject {
  const protection = developmentWorkloadProtection(env);
  if (protection && (source !== undefined || workVolume === 'emptyDir' || envSecretName !== runnerSecretOf(env as TaskEnvironmentWithRender)
    || image !== env.render!.image || workerUid !== env.render!.workerUid || nodeName !== undefined && nodeName !== env.native!.nodeName
    || !['cpu', 'memory', 'storage'].every((key) => resources[key as keyof typeof resources] === env.render!.resources[key as keyof typeof resources]))) throw precondition('独立开发 Agent 的创建参数与原保护快照冲突');
  if (env.render?.developmentUsageStorage && (env.kind !== 'dev-session' || env.native?.purpose !== 'agent')) throw new Error('只有独立开发 Agent 可选择数值日志布局');
  const object = renderTaskPod({
    ...(env.render?.developmentUsageStorage ? { developmentUsageStorage: env.render.developmentUsageStorage } : {}),
    ...(env.render?.runtimeImage ? { runtimeInitialization: true } : {}),
    name: env.podName, namespace: env.namespace, taskId: env.id, workload: WORKLOAD_LABELS[env.kind], project: env.labels[LABELS.project] ?? '', service: env.labels[LABELS.service] ?? '',
    image, workerUid, resources, workVolume: workVolume === 'emptyDir' ? { emptyDir: true } : { pvc: env.pvcName }, env: envVars,
    ...(env.render?.businessStorage ? { businessStorage: { ...env.render.businessStorage, initialize: !env.native && !env.rebuildId && env.render.start === 1 } } : {}),
    ...(envSecretName ? { envFromSecret: envSecretName } : {}), ...(source ? { checkout: source } : {}), ...(protection ? { nodeName: env.native!.nodeName } : nodeName ? { nodeName } : {}),
    labels: { ...(env.rebuildId ? { 'crewstation.io/rebuild': env.rebuildId } : {}), ...(env.native ? { [WORKSPACE_TASK_LABEL]: env.native.parentTaskId } : {}) },
  });
  if (!protection) return object;
  const annotations = { [EXECUTION_INTENT_ANNOTATION]: canonicalNativeIntent(env.id, env.native!) };
  object.metadata.annotations = { ...object.metadata.annotations, ...annotations };
  return protectWorkloadPod(object, { ...protection, consumerVolumeUid: protection.expectedVolumeUid,
    name: env.podName, namespace: env.namespace, taskId: env.id, image, workerUid, workload: 'dev-session',
    developmentUsageStorage: env.render!.developmentUsageStorage, pvc: env.pvcName, nodeName: env.native!.nodeName, parentPodUid: env.native!.parentPodUid,
    secret: envSecretName, resources, labels: { [WORKSPACE_TASK_LABEL]: env.native!.parentTaskId }, annotations });
}

/** 开发预览的 Service 与路由随 Pod 生灭：目标 Service 是按任务建的，放进 gateway 的按服务重算里对不上生命周期。 */
export async function ensureTaskPreview(k8s: K8sClient, { env, previewRoute }: TaskPodSpec): Promise<void> {
  if (!env.preview) return;
  const route = previewRoute ? { host: previewRoute.host, middlewares: [{ name: previewRoute.dropIdentityHeadersMiddleware, namespace: previewRoute.systemNamespace }, { name: previewRoute.userAuthMiddleware, namespace: previewRoute.systemNamespace }] } : undefined;
  for (const object of taskPreviewObjects({ name: env.podName, namespace: env.namespace, taskId: env.id, kind: env.kind, targetPort: env.preview.port, ...(route ? { route } : {}) })) await k8s.apply(object);
}
