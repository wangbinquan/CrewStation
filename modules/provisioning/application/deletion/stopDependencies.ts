import { PROJECT_DELETION_PARTICIPANTS } from '@crewstation/contracts';
import type { ProjectDeletionParticipant, ProjectDeletionReceipt } from '@crewstation/contracts';

const sessionConsumers: readonly ProjectDeletionParticipant[] = ['dev-session', 'business-task', 'task-runtime'];
const resourceConsumers = PROJECT_DELETION_PARTICIPANTS.filter((participant) => participant !== 'resources' && participant !== 'cluster-control');
const dependencies: Partial<Record<ProjectDeletionParticipant, readonly ProjectDeletionParticipant[]>> = {
  observability: sessionConsumers, session: [...sessionConsumers, 'observability'], resources: resourceConsumers, 'cluster-control': ['resources'],
};

/** 依赖当前原操作的持久停止证明，排序或已经发起停止都不能代替完成。 */
export function missingStopDependencies(participant: ProjectDeletionParticipant, receipts: readonly ProjectDeletionReceipt[]): ProjectDeletionParticipant[] {
  const stopped = new Set(receipts.filter((receipt) => receipt.phase === 'stop').map((receipt) => receipt.participant));
  return (dependencies[participant] ?? []).filter((source) => !stopped.has(source));
}
