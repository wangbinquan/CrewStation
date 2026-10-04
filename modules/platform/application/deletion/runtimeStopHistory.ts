import { WorkloadConsumerSchema, WorkloadStartPermitSchema, WorkloadStopProofSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { RuntimeStopHistory, RuntimeStoppedEnvironment } from '../../ports/runtimeStops';

/** Only when the complete Root scope has no live Pod: original durable evidence survives Pod deletion. */
export async function runtimeHistoricalStop(history: RuntimeStopHistory, env: RuntimeStoppedEnvironment) {
  const id = env.render?.workloadConsumerId;
  if (!id) return undefined;
  const state = await history.get(id);
  if (!state) return undefined;
  const selected = WorkloadConsumerSchema.safeParse(state.consumer);
  if (!selected.success) throw precondition('原历史工作卷消费者格式无效');
  const consumer = selected.data, taskId = env.native ? env.native.parentTaskId : env.id;
  const volumeUid = env.native?.pvcUid ?? env.businessWorkspace?.volumeUid;
  const purpose = env.native ? 'agent' : env.kind === 'dev-session' ? 'development' : 'business';
  if (!taskId || consumer.id !== id || consumer.resourceId !== env.id || consumer.taskId !== taskId
    || consumer.namespace !== env.namespace || consumer.podName !== env.podName || consumer.revision !== env.render?.start
    || consumer.purpose !== purpose || consumer.finalization !== null || volumeUid !== undefined && consumer.volumeUid !== volumeUid)
    throw precondition('原历史工作卷消费者与原执行、修订或工作卷冲突');
  // The actual closed writer row bars register/grantStart. A separate pre-registration tombstone may be absent.
  if (!state.admissionClosed) return undefined;
  if (!state.startPermit && !state.stopProof) {
    if (env.podUid || env.native?.podUid) throw precondition('已有原 Pod 身份的执行缺少历史启动或停止证明');
    return { digest: jsonHash({ consumer, admissionClosed: true, neverAdmitted: true }) };
  }
  const parsed = WorkloadStopProofSchema.safeParse(state.stopProof);
  if (!parsed.success) return undefined;
  const proof = parsed.data;
  if (jsonHash(proof.consumer) !== jsonHash(consumer)) throw precondition('原历史停止证明属于其他工作卷消费者');
  if (state.startPermit) {
    const permit = WorkloadStartPermitSchema.safeParse(state.startPermit);
    if (!permit.success || proof.type !== 'kubelet-terminated' || proof.podUid !== permit.data.podUid
      || proof.nodeName !== permit.data.nodeName || proof.nodeUid !== permit.data.nodeUid)
      throw precondition('原历史停止证明与实际启动 Pod 或节点冲突');
  } else if (proof.type !== 'never-scheduled') throw precondition('已运行的历史 Pod 缺少实际启动许可');
  for (const uid of [env.podUid, env.native?.podUid]) if (uid !== undefined && uid !== proof.podUid)
    throw precondition('原历史停止证明与执行 Pod UID 冲突');
  return { digest: jsonHash({ consumer, admissionClosed: true, permit: state.startPermit, proof }) };
}
