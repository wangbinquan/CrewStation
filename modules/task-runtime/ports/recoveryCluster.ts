import type { TaskEnvironment } from '../domain/taskEnvironment';
import type { EnvironmentRebuild } from '../domain/environmentRebuild';
import type { PodPhase, TaskPodSpec } from './cluster';

export interface RecoveryResources {
  pod: { uid: string; phase: PodPhase; deleting: boolean } | null;
  volume: { uid: string; phase: string; deleting: boolean; belongsToTask: boolean; capacity?: string } | null;
}

/** 保卷重建的实例检查；不提供创建或删除工作卷的方法。 */
export interface TaskRecoveryCluster {
  inspect(env: TaskEnvironment): Promise<RecoveryResources>;
  removeFailedPod(env: TaskEnvironment, expectedUid: string): Promise<void>;
}

/** 控制器幂等准备恢复实例；不提供工作卷删除／初始化能力。 */
export interface RebuildProvisioner {
  prepareSecret(record: EnvironmentRebuild, values: () => Promise<Record<string, string>>): Promise<{ uid: string; token: string }>;
  ensurePod(record: EnvironmentRebuild, spec: TaskPodSpec): Promise<string>;
  ensurePreview(record: EnvironmentRebuild, spec: TaskPodSpec): Promise<void>;
  cleanup(record: EnvironmentRebuild): Promise<void>;
}
