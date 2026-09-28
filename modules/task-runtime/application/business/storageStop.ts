import { precondition } from '@crewstation/kernel';
import type { TaskEnvironment } from '../../domain/taskEnvironment';
import type { TaskRuntimeUseCaseDeps } from '../dependencies';

export async function closeStorageAdmission(deps: TaskRuntimeUseCaseDeps, env: TaskEnvironment): Promise<void> {
  if (!env.render?.completionPolicy) return;
  if (!deps.workloadSafety || !env.render.workloadConsumerId) throw precondition('工作卷停止保护不可用');
  await deps.workloadSafety.closeAdmission({ consumer: { id: env.render.workloadConsumerId, taskId: env.native?.parentTaskId ?? env.id,
    revision: env.render.start, purpose: env.native ? 'agent' : 'business', finalization: null }, resourceId: env.id, namespace: env.namespace, podName: env.podName });
}
/** In addition to live Pod absence: closure bars late creates; every admitted writer still needs its proof. */
export async function storageStopProved(deps: TaskRuntimeUseCaseDeps, env: TaskEnvironment): Promise<boolean> {
  if (!env.render?.completionPolicy) return true;
  const safety = deps.workloadSafety, id = env.render.workloadConsumerId;
  if (!safety || !id) return false;
  const closed = await safety.admissionClosed(id), state = await safety.get(id);
  if (!state) return closed;
  if (!state.admissionClosed || state.consumer.resourceId !== env.id || state.consumer.podName !== env.podName) return false;
  if (!state.startPermit) return true;
  return !!state.stopProof && state.stopProof.podUid === state.startPermit.podUid && state.stopProof.nodeUid === state.startPermit.nodeUid
    && (!env.podUid || env.podUid === state.stopProof.podUid) && (!env.native?.podUid || env.native.podUid === state.stopProof.podUid);
}
