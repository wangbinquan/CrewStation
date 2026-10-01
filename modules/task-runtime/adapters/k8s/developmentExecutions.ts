import type { WorkloadConsumer } from '@crewstation/contracts';
import { WORKLOAD_STOP_FINALIZER, WorkloadConsumerSchema, WorkloadStartPermitSchema } from '@crewstation/contracts';
import { assertWorkloadGate } from '@crewstation/k8s';
import type { K8sObject, WorkloadAdmissionPod } from '@crewstation/k8s';
import { jsonHash, precondition } from '@crewstation/kernel';
import { developmentWorkloadProtection } from '../../domain/development/protection';
import { projectEnvironment } from '../../domain/ledgerProjection';
import type { TaskEnvironment } from '../../domain/taskEnvironment';
import type { WorkloadSafetyPort } from '../../ports/workloadSafety';

export function developmentPod(env: TaskEnvironment): WorkloadAdmissionPod {
  const protection = developmentWorkloadProtection(env), render = projectEnvironment(env).workload.render;
  if (!protection || !env.render?.execution || !render?.['pod']) throw precondition('开发 Agent 的完整原工作卷台账期望缺失');
  return { ...(render['pod'] as WorkloadAdmissionPod), name: env.podName, namespace: env.namespace, taskId: env.id, consumerVolumeUid: protection.expectedVolumeUid };
}
/** Registration is the first external side effect; a closed receipt never authorizes Kubernetes material. */
export async function registerDevelopmentExecution(env: TaskEnvironment, safety: Pick<WorkloadSafetyPort, 'register'> | undefined): Promise<WorkloadAdmissionPod | undefined> {
  if (env.render?.developmentUsageProtection === undefined) return undefined;
  if (!safety?.register) throw precondition('开发数字工作负载保护的持久启动许可尚未装配');
  const pod = developmentPod(env);
  const consumer: WorkloadConsumer = WorkloadConsumerSchema.parse({ ...pod.consumer, resourceId: env.id, namespace: env.namespace, podName: env.podName, volumeUid: pod.consumerVolumeUid });
  const state = await safety.register(consumer);
  if (jsonHash(state.consumer) !== jsonHash(consumer)) throw precondition('开发消费者注册回执不属于原执行');
  if (state.admissionClosed) throw precondition('开发工作卷消费者启动许可已关闭', { code: 'workload_admission_closed' });
  return pod;
}
export function verifyDevelopmentExecution(object: K8sObject, pod: WorkloadAdmissionPod): void {
  assertWorkloadGate(object, pod);
  if (object.metadata.deletionTimestamp || !WorkloadStartPermitSchema.shape.podUid.safeParse(object.metadata.uid).success) throw precondition('原开发 Agent Pod 已结束或身份缺失');
}

/** A deletion retry validates the admitted spec and UID, without requiring the initial finalizer to still exist. */
export function verifyDevelopmentCleanupExecution(object: K8sObject, pod: WorkloadAdmissionPod): void {
  assertWorkloadGate({ ...object, metadata: { ...object.metadata, finalizers: [...new Set([...object.metadata.finalizers ?? [], WORKLOAD_STOP_FINALIZER])] } }, pod);
  if (!WorkloadStartPermitSchema.shape.podUid.safeParse(object.metadata.uid).success) throw precondition('原开发 Pod 身份缺失');
}
