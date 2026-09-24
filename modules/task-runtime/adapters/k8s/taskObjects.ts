import type { K8sClient, K8sObject } from '@crewstation/k8s';
import { LABELS, taskPodObject as renderTaskPod, taskPreviewObjects } from '@crewstation/k8s';
import type { TaskPodSpec } from '../../ports/cluster';

/**
 * Pod 的工作负载标签用网关的 Pod 身份索引与项目网络策略认的名字：业务任务是 `business-task`（TaskKind 是 `business`）。
 * 此前直接写 TaskKind，业务任务 Pod 既不在身份索引里、也拿不到任务出站策略（RFC-006 起业务 Agent 子任务的 Pod 要访问模型端点）。
 */
export const WORKLOAD_LABEL: Record<TaskPodSpec['env']['kind'], string> = { 'dev-session': 'dev-session', business: 'business-task', 'profile-test': 'profile-test' };

/** 任务容器的 Pod：构造函数在 `@crewstation/k8s`，资源中心的调和器渲染同一种 Pod 时用的也是它（RFC-025 设计 §6.2）。 */
export function taskPodObject({ env, image, envVars, resources, source, envSecretName, nodeName, workVolume }: TaskPodSpec, workerUid: number): K8sObject {
  return renderTaskPod({
    name: env.podName, namespace: env.namespace, taskId: env.id, workload: WORKLOAD_LABEL[env.kind], project: env.labels[LABELS.project] ?? '', service: env.labels[LABELS.service] ?? '',
    image, workerUid, resources, workVolume: workVolume === 'emptyDir' ? { emptyDir: true } : { pvc: env.pvcName }, env: envVars,
    ...(envSecretName ? { envFromSecret: envSecretName } : {}), ...(source ? { checkout: source } : {}), ...(nodeName ? { nodeName } : {}),
    labels: { ...(env.rebuildId ? { 'crewstation.io/rebuild': env.rebuildId } : {}), ...(env.native ? { 'crewstation.io/workspace-task': env.native.parentTaskId } : {}) },
  });
}

/** 开发预览的 Service 与路由随 Pod 生灭：目标 Service 是按任务建的，放进 gateway 的按服务重算里对不上生命周期。 */
export async function ensureTaskPreview(k8s: K8sClient, { env, previewRoute }: TaskPodSpec): Promise<void> {
  if (!env.preview) return;
  const route = previewRoute ? { host: previewRoute.host, middlewares: [{ name: previewRoute.dropIdentityHeadersMiddleware, namespace: previewRoute.systemNamespace }, { name: previewRoute.userAuthMiddleware, namespace: previewRoute.systemNamespace }] } : undefined;
  for (const object of taskPreviewObjects({ name: env.podName, namespace: env.namespace, taskId: env.id, kind: env.kind, targetPort: env.preview.port, ...(route ? { route } : {}) })) await k8s.apply(object);
}
