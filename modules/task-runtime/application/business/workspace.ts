import { conflict, precondition } from '@crewstation/kernel';
import type { TaskEnvironment, BusinessWorkspaceLifecycle } from '../../domain/taskEnvironment';
import { canPause, transition } from '../../domain/taskEnvironment';
import type { TaskRuntimeUseCaseDeps } from '../dependencies';
import { hashRunnerToken, newRunnerToken } from '../../domain/runnerToken';
import { initialStartup } from '../../domain/podStartup';
import { nextStorageStart, storageStart } from './storageStart';
import { closeStorageAdmission, storageStopProved } from './storageStop';
import { assertBusinessStorageMutable } from './finalizationGuard';

/** A name is not a volume identity. Resume never initializes or recreates a missing workspace. */
export async function inspectBusinessWorkspace(deps: TaskRuntimeUseCaseDeps, env: TaskEnvironment): Promise<BusinessWorkspaceLifecycle> {
  if (!deps.businessStorageInspector) throw precondition('业务卷身份检查不可用', { code: 'unsupported_capability' });
  const { volume } = await deps.businessStorageInspector.inspect(env);
  if (!volume || volume.deleting || !volume.belongsToTask || volume.phase !== 'Bound' || (env.businessWorkspace && env.businessWorkspace.volumeUid !== volume.uid)) throw precondition('原业务工作卷缺失、未就绪或实例已变化', { code: 'workspace_volume_changed' });
  return { volumeUid: volume.uid, phase: env.businessWorkspace?.phase ?? 'ready' };
}

export async function pauseBusinessWorkspace(deps: TaskRuntimeUseCaseDeps, original: TaskEnvironment): Promise<TaskEnvironment> {
  if (!original.render?.businessStorage || original.native || original.volumeMode !== 'persistent') throw precondition('该环境不是持久业务工作区');
  if (original.state === 'paused') return original;
  const identity = await inspectBusinessWorkspace(deps, original);
  const env = await deps.uow.run(async (scope) => {
    await scope.admissions.lock(original.projectId);
    const current = (await scope.environments.getById(original.id))!;
    if (current.state === 'paused' || (current.state === 'running' && current.businessWorkspace?.phase === 'pausing')) return current;
    if (!canPause(current) || !current.podUid || current.podUid !== original.podUid) throw conflict('工作区当前不能暂停', { code: 'workspace_changed' });
    if ((await scope.environments.listChildren(current.id)).some((child) => child.native?.state !== 'finished')) throw conflict('工作区仍有活动 Agent，不能暂停', { code: 'active_subtasks' });
    const next: TaskEnvironment = { ...current, connected: false, businessWorkspace: { ...identity, phase: 'pausing' }, runnerTokenHash: hashRunnerToken(newRunnerToken()), updatedAt: deps.clock.now(), message: '正在回收业务任务容器，工作卷保留' };
    await scope.environments.update(next); return next;
  });
  return env.state === 'paused' ? env : finishBusinessPause(deps, env);
}

/** DELETE is an intention. Quota stays held until the original Pod is observed absent. */
export async function finishBusinessPause(deps: TaskRuntimeUseCaseDeps, env: TaskEnvironment): Promise<TaskEnvironment> {
  if (env.businessWorkspace?.phase !== 'pausing' || !env.podUid) return env;
  await closeStorageAdmission(deps, env);
  await deps.cluster.deletePod(env);
  const observation = await deps.cluster.podPhase(env);
  if (observation.phase !== 'Missing') {
    if (observation.uid && observation.uid !== env.podUid) throw conflict('暂停期间 Pod 实例已变化', { code: 'workspace_changed' });
    return env;
  }
  if (!await storageStopProved(deps, env)) return env;
  return deps.uow.run(async (scope) => {
    await scope.admissions.lock(env.projectId);
    const current = (await scope.environments.getById(env.id))!;
    if (current.state !== 'running' || current.businessWorkspace?.phase !== 'pausing' || current.podUid !== env.podUid) return current;
    const paused = transition(current, 'paused', deps.clock.now(), { connected: false, businessWorkspace: { ...current.businessWorkspace, phase: 'paused' }, message: '任务已暂停，原工作卷保留' });
    await scope.environments.update(paused); await scope.quota.release(paused); return paused;
  });
}

export async function resumeBusinessWorkspace(deps: TaskRuntimeUseCaseDeps, original: TaskEnvironment): Promise<TaskEnvironment> {
  assertBusinessStorageMutable(original);
  if (original.businessWorkspace?.phase === 'resuming' && original.state === 'creating') return original;
  if (!original.render?.businessStorage || original.native || original.state !== 'paused' || !original.businessWorkspace) throw precondition('只有保留原卷身份的暂停业务任务可以恢复');
  await inspectBusinessWorkspace(deps, original);
  if ((await deps.cluster.podPhase(original)).phase !== 'Missing') throw precondition('原 Pod 尚未确认删除', { code: 'workspace_cleanup_pending' });
  if (!await storageStopProved(deps, original)) throw precondition('原消费者尚未取得停止证明', { code: 'workspace_cleanup_pending' });
  const limit = (await deps.quotas.quotaLimit(original.projectId)) ?? 0;
  return deps.uow.run(async (scope) => {
    await scope.admissions.lock(original.projectId);
    const current = (await scope.environments.getById(original.id))!;
    assertBusinessStorageMutable(current);
    if (current.businessWorkspace?.phase === 'resuming' && current.state === 'creating') return current;
    if (current.state !== 'paused' || !current.render || current.businessWorkspace?.volumeUid !== original.businessWorkspace!.volumeUid) throw conflict('恢复期间工作区已变化', { code: 'workspace_changed' });
    const now = deps.clock.now();
    const resumed = transition(current, 'creating', now, { connected: false, podUid: undefined, runtimeInitialization: undefined, startup: initialStartup(now),
      ...nextStorageStart(current), render: { ...current.render, start: current.render.start + 1, ...storageStart(current.render.completionPolicy) }, businessWorkspace: { ...current.businessWorkspace, phase: 'resuming' }, message: '正在恢复原业务工作卷' });
    await scope.quota.acquire(resumed, limit, `并发任务已达配额上限 ${limit}`); await scope.environments.update(resumed); return resumed;
  });
}
