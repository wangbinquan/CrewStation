import type { K8sObject } from '@crewstation/k8s';
import { LABELS, pvcObject, secretObject, taskPodObject, taskPreviewObjects } from '@crewstation/k8s';
import type { VolumeRender, WorkloadPodRender, WorkloadPreviewRender } from '../../domain/workloadRender';

/** 工作区的 Pod（RFC-025 I25）：与 task-runtime 自己建时同一个构造函数；环境只从 Runner Secret 引用，Pod 规格里没有凭据。 */
export function workloadPodObject(pod: WorkloadPodRender): K8sObject {
  const object = taskPodObject({
    name: pod.name, namespace: pod.namespace, taskId: pod.taskId, workload: pod.workload, project: pod.project, service: pod.service, image: pod.image,
    workerUid: pod.workerUid, resources: pod.resources, workVolume: pod.pvc ? { pvc: pod.pvc } : { emptyDir: true }, envFromSecret: pod.secret, ...(pod.checkout ? { checkout: pod.checkout } : {}),
    ...(pod.nodeName ? { nodeName: pod.nodeName } : {}), ...(pod.labels ? { labels: pod.labels } : {}),
  });
  if (pod.annotations) object.metadata.annotations = { ...object.metadata.annotations, ...pod.annotations };
  return object;
}

/** 这一次启动的 Runner Secret：不可变，内容是建的时候向 task-runtime 要来的（值不落库）；执行环境的带上与 Pod 相同的附加标签与注解。 */
export function runnerSecretObject(pod: WorkloadPodRender, values: Readonly<Record<string, string>>): K8sObject {
  const secret = { ...secretObject({ name: pod.secret, namespace: pod.namespace, stringData: { ...values }, labels: { ...pod.labels, [LABELS.task]: pod.taskId } }), immutable: true } as K8sObject;
  if (pod.annotations) secret.metadata.annotations = { ...pod.annotations };
  return secret;
}

/** 这一次启动检出用的 Git 凭据（键 `token`，只挂给 checkout init 容器）：不可变，令牌是建的时候向所属模块要来的。 */
export function checkoutSecretObject(pod: WorkloadPodRender, values: { readonly token: string }): K8sObject {
  return { ...secretObject({ name: pod.checkout!.credentialSecretName, namespace: pod.namespace, stringData: { token: values.token }, labels: { [LABELS.task]: pod.taskId } }), immutable: true } as K8sObject;
}

export function workloadPreviewObjects(preview: WorkloadPreviewRender): K8sObject[] {
  return taskPreviewObjects({ name: preview.name, namespace: preview.namespace, taskId: preview.taskId, kind: preview.kind, targetPort: preview.targetPort, ...(preview.route ? { route: preview.route } : {}) });
}

export function volumeObject(volume: VolumeRender): K8sObject {
  return pvcObject({ name: volume.name, namespace: volume.namespace, size: volume.size, labels: { ...volume.labels } });
}
