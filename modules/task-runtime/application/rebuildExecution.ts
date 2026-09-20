import { isPlatformError, precondition } from '@crewstation/kernel';
import type { EnvironmentRebuild } from '../domain/environmentRebuild';
import { hashRunnerToken, newRunnerToken } from '../domain/runnerToken';
import type { TaskEnvironment } from '../domain/taskEnvironment';
import { transition } from '../domain/taskEnvironment';
import type { RebuildProvisioner } from '../ports/recoveryCluster';
import type { RepositoryScope } from '../ports/unitOfWork';
import { containerEnv } from './containerEnv';
import { previewRouteOf } from './createEnvironment';
import type { RebuildDependencies } from './rebuildInspection';
import { retainedVolume } from './rebuildInspection';

export type RebuildExecutionDeps = RebuildDependencies & { provisioner: RebuildProvisioner };
export type RebuildHeartbeat = () => Promise<boolean>;
export async function requireRebuildLease(heartbeat: RebuildHeartbeat): Promise<void> {
  if (!await heartbeat()) throw new Error('恢复作业租约已被接管');
}

/** 每次执行持有项目行锁；崩溃后通过不可变请求标签和 UID 接续已创建资源。 */
export async function executeRebuild(deps: RebuildExecutionDeps, scope: RepositoryScope, record: EnvironmentRebuild, env: TaskEnvironment, heartbeat: RebuildHeartbeat): Promise<void> {
  await requireRebuildLease(heartbeat);
  const original = { ...env, podName: record.originalPodName };
  const resources = await deps.recoveryCluster.inspect(original);
  if (retainedVolume(resources).uid !== record.input.expectedVolumeUid) throw precondition('原工作卷实例已变化，恢复停止');
  if (resources.pod) {
    if (resources.pod.uid !== record.input.expectedPodUid) throw precondition('原容器实例已变化，恢复停止');
    await deps.recoveryCluster.removeFailedPod(original, resources.pod.uid, record.input.reason);
    if ((await deps.recoveryCluster.inspect(original)).pod) throw new Error('等待原容器退出');
  }
  await requireRebuildLease(heartbeat);
  const svc = await deps.services.resolveServiceById(env.serviceId);
  if (!svc) throw precondition('服务已不存在，恢复停止');
  const secret = await deps.provisioner.prepareSecret(record, () => containerEnv(deps, env, svc, newRunnerToken()));
  const prepared = { ...env, runnerTokenHash: hashRunnerToken(secret.token) };
  const spec = { env: prepared, image: record.image, envVars: {}, envSecretName: record.secretName, resources: record.input.profile,
    ...(record.nodeName ? { nodeName: record.nodeName } : {}),
    ...previewRouteOf(deps.settings, env, svc.slug) };
  await requireRebuildLease(heartbeat);
  if (retainedVolume(await deps.recoveryCluster.inspect(original)).uid !== record.input.expectedVolumeUid) throw precondition('原工作卷在准备期间已变化，恢复停止');
  const podUid = await deps.provisioner.ensurePod(record, spec);
  if (retainedVolume(await deps.recoveryCluster.inspect(original)).uid !== record.input.expectedVolumeUid) throw precondition('原工作卷在创建期间已变化，恢复停止');
  await deps.provisioner.ensurePreview(record, spec);
  await requireRebuildLease(heartbeat);
  const now = deps.clock.now();
  await scope.environments.update({ ...prepared, updatedAt: now, message: '恢复容器已创建，等待调度和新环境连接' });
  await scope.rebuilds.update({ ...record, state: 'starting', secretUid: secret.uid, podUid, message: '等待新环境连接，原 CLI 不会自动启动', updatedAt: now });
}

export async function compensateRebuild(deps: RebuildExecutionDeps, scope: RepositoryScope, record: EnvironmentRebuild, env: TaskEnvironment, heartbeat: RebuildHeartbeat): Promise<void> {
  await requireRebuildLease(heartbeat);
  await deps.provisioner.cleanup(record);
  await requireRebuildLease(heartbeat);
  const now = deps.clock.now();
  const message = record.failureReason ?? '重建未完成，原工作卷已保留，请重新检查后重试';
  await scope.rebuilds.update({ ...record, state: 'failed', updatedAt: now, message });
  await scope.environments.update(transition(env, 'failed', now, { connected: false, message, runnerTokenHash: hashRunnerToken(newRunnerToken()) }));
  await scope.admissions.release(env.projectId);
}

export function rebuildFailureMessage(error: unknown): string {
  return isPlatformError(error) && error.kind === 'precondition' ? error.message : '重建暂时失败，平台正在重试；原工作卷保持不变';
}
