import type { TaskEnvironment } from '../domain/taskEnvironment';
import type { PodPhase } from './cluster';

export interface RecoveryResources {
  pod: { uid: string; phase: PodPhase; deleting: boolean } | null;
  volume: { uid: string; phase: string; deleting: boolean; belongsToTask: boolean; capacity?: string } | null;
}

/** 保卷重建的实例检查；不提供创建或删除工作卷的方法。 */
export interface TaskRecoveryCluster {
  inspect(env: TaskEnvironment): Promise<RecoveryResources>;
  removeFailedPod(env: TaskEnvironment, expectedUid: string): Promise<void>;
}
