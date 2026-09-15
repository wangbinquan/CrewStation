import type { EnvironmentRebuild } from '../domain/environmentRebuild';
import type { TaskPodSpec } from './cluster';

/** 控制器逐步幂等准备新实例；没有任何工作卷删除／初始化能力。 */
export interface RebuildProvisioner {
  prepareSecret(record: EnvironmentRebuild, values: () => Promise<Record<string, string>>): Promise<{ uid: string; token: string }>;
  ensurePod(record: EnvironmentRebuild, spec: TaskPodSpec): Promise<string>;
  ensurePreview(record: EnvironmentRebuild, spec: TaskPodSpec): Promise<void>;
  cleanup(record: EnvironmentRebuild): Promise<void>;
}
