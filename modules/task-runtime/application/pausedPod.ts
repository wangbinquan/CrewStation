import { precondition } from '@crewstation/kernel';
import type { TaskEnvironment } from '../domain/taskEnvironment';
import type { TaskCluster } from '../ports/cluster';

/** Kubernetes DELETE 只受理回收；同名重建前先确认原实例消失，等待期间保持暂停且不占配额。 */
export async function waitForPausedPodRemoval(cluster: Pick<TaskCluster, 'podPhase'>, env: TaskEnvironment, timing = { timeoutMs: 60_000, pollMs: 500 }): Promise<void> {
  const deadline = Date.now() + timing.timeoutMs;
  for (;;) {
    const pod = await cluster.podPhase(env);
    if (pod.phase === 'Missing') return;
    if (!env.podUid || pod.uid !== env.podUid) throw precondition('暂停任务的 Pod 实例已变化，请核对后再恢复');
    if (Date.now() >= deadline) throw precondition('原 Pod 仍在删除，请待回收完成后再恢复任务');
    await Bun.sleep(timing.pollMs);
  }
}
