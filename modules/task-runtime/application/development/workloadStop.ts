import { WorkloadConsumerSchema, WorkloadStartPermitSchema, WorkloadStopProofSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import { developmentWorkloadProtection } from '../../domain/development/protection';
import type { TaskEnvironment } from '../../domain/taskEnvironment';
import type { DevelopmentPhysicalStopEvidence } from '../../ports/developmentCleanup';
import type { WorkloadSafetyPort } from '../../ports/workloadSafety';

function originalConsumer(env: TaskEnvironment) {
  const protection = developmentWorkloadProtection(env);
  if (!protection) throw precondition('原开发工作卷保护缺失');
  return WorkloadConsumerSchema.parse({ ...protection.consumer, resourceId: env.id, namespace: env.namespace, podName: env.podName, volumeUid: protection.expectedVolumeUid });
}
export async function closeDevelopmentAdmission(safety: WorkloadSafetyPort | undefined, env: TaskEnvironment): Promise<void> {
  if (!safety) throw precondition('原开发消费者关闭能力未装配');
  const expected = originalConsumer(env), { resourceId, namespace, podName, volumeUid: _volume, ...consumer } = expected;
  await safety.closeAdmission({ consumer, resourceId, namespace, podName });
  const state = await safety.get(expected.id);
  if (!state?.admissionClosed || !await safety.admissionClosed(expected.id) || jsonHash(WorkloadConsumerSchema.parse(state.consumer)) !== jsonHash(expected)) throw precondition('原开发消费者尚未持久关闭');
}
/** Unlike business storageStop, missing policy/consumer/permit/proof never means stopped. */
export async function developmentPhysicalStop(safety: WorkloadSafetyPort | undefined, env: TaskEnvironment): Promise<DevelopmentPhysicalStopEvidence> {
  if (!safety) throw precondition('原开发工作卷停止能力未装配');
  const expected = originalConsumer(env), state = await safety.get(expected.id);
  if (!state?.admissionClosed || !await safety.admissionClosed(expected.id) || !state.startPermit || !state.stopProof) throw precondition('等待原开发消费者的独立容器停止证明');
  const consumer = WorkloadConsumerSchema.parse(state.consumer), startPermit = WorkloadStartPermitSchema.parse(state.startPermit), stopProof = WorkloadStopProofSchema.parse(state.stopProof);
  if (jsonHash(consumer) !== jsonHash(expected) || jsonHash(stopProof.consumer) !== jsonHash(expected) || startPermit.podUid !== env.native!.podUid
    || startPermit.nodeName !== env.native!.nodeName || stopProof.podUid !== startPermit.podUid || stopProof.nodeUid !== startPermit.nodeUid
    || stopProof.nodeName !== startPermit.nodeName || stopProof.type !== 'kubelet-terminated') throw precondition('开发停止证明不属于原 Pod、工作卷与节点');
  return { consumer, startPermit, stopProof };
}
