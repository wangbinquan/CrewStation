import type { DevSessionRebuildInspection, ProjectId, RebuildDevSessionRequest } from '@crewstation/contracts';
import { conflict, precondition } from '@crewstation/kernel';
import type { TaskEnvironment } from '../domain/taskEnvironment';
import { rebuildIsActive } from '../domain/environmentRebuild';
import type { RecoveryResources, TaskRecoveryCluster } from '../ports/recoveryCluster';
import type { RepositoryScope } from '../ports/unitOfWork';
import type { TaskRuntimeUseCaseDeps } from './dependencies';

export type RebuildDependencies = TaskRuntimeUseCaseDeps & { recoveryCluster: TaskRecoveryCluster };

export function rebuildReason(env: TaskEnvironment, administrator = false): 'failed' | 'protocol_mismatch' | 'administrator-restart' | undefined {
  if (env.kind !== 'dev-session' || env.native) return undefined;
  if (administrator && env.state === 'running') return 'administrator-restart';
  if (env.state === 'failed') return 'failed';
  // 旧版本记录拒绝时可能遗留 connected=true；拒绝记录优先，当前版本的成功握手会原子清除它。
  if (['running', 'creating'].includes(env.state) && env.runnerRejection?.code === 'protocol_mismatch') return 'protocol_mismatch';
  return undefined;
}

export async function recoverableDevSession(scope: RepositoryScope, projectId: ProjectId, administrator = false): Promise<TaskEnvironment> {
  const env = await scope.environments.findDevSession(projectId, { includeLatestFailure: true });
  if (!env || !rebuildReason(env, administrator)) throw precondition('当前没有可恢复的失败或协议不兼容开发会话，请刷新会话状态');
  const previous = env.rebuildId ? await scope.rebuilds.get(env.rebuildId) : undefined;
  if (previous && rebuildIsActive(previous)) throw precondition('当前恢复仍在进行中，请等待结果');
  return env;
}

export function retainedVolume(resources: RecoveryResources): NonNullable<RecoveryResources['volume']> & { capacity: string } {
  const volume = resources.volume;
  if (!volume || volume.deleting || !volume.belongsToTask || volume.phase !== 'Bound' || !volume.capacity) {
    throw precondition('原工作卷不存在、尚未就绪或归属已变化；不能保留工作树重建');
  }
  return { ...volume, capacity: volume.capacity };
}

export function endedPod(resources: RecoveryResources, reason: 'failed' | 'protocol_mismatch' | 'administrator-restart' = 'failed'): void {
  if (resources.pod && (resources.pod.deleting || reason === 'failed' && !['Failed', 'Succeeded'].includes(resources.pod.phase))) {
    throw precondition('原容器尚未结束或正在删除，请稍后重新检查');
  }
}

export async function inspectRebuild(deps: RebuildDependencies, projectId: ProjectId, administrator = false): Promise<DevSessionRebuildInspection> {
  const env = await recoverableDevSession(deps.uow.read, projectId, administrator);
  const reason = rebuildReason(env, administrator)!;
  const resources = await deps.recoveryCluster.inspect(env);
  const volume = retainedVolume(resources); endedPod(resources, reason);
  const assigned = await deps.profiles.devSessionProfile?.(projectId);
  const profiles = (await deps.profiles.listTaskProfiles()).filter((profile) => !assigned || profile.id === assigned);
  return { taskId: env.id, projectId, updatedAt: env.updatedAt.toISOString(), podUid: resources.pod?.uid ?? null,
    volume: { uid: volume.uid, capacity: volume.capacity }, currentProfile: env.profile,
    profiles, checkedAt: deps.clock.now().toISOString(), reason };
}

export async function validateRebuild(deps: RebuildDependencies, env: TaskEnvironment, input: RebuildDevSessionRequest): Promise<void> {
  if (env.id !== input.expectedTaskId || env.updatedAt.toISOString() !== input.expectedUpdatedAt) throw conflict('开发会话已变化，请重新检查后确认恢复');
  if (rebuildReason(env, input.reason === 'administrator-restart') !== (input.reason ?? 'failed')) throw conflict('恢复原因已变化，请重新检查并确认容器影响');
  const resources = await deps.recoveryCluster.inspect(env);
  const volume = retainedVolume(resources); endedPod(resources, input.reason);
  if (volume.uid !== input.expectedVolumeUid || (resources.pod?.uid ?? null) !== input.expectedPodUid) throw conflict('原容器或工作卷实例已变化，请重新检查');
  const assigned = await deps.profiles.devSessionProfile?.(env.projectId);
  if (assigned && input.profile.id !== assigned) throw precondition('项目开发套餐已调整，请重新检查并使用管理员分配的套餐');
  const profile = await deps.profiles.getTaskProfile(input.profile.id);
  if (!profile || (['id', 'name', 'cpu', 'memory', 'storage'] as const).some((key) => profile[key] !== input.profile[key])) throw conflict('管理员的任务套餐已变化，请重新选择');
}
