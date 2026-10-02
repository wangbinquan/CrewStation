import { requireCurrentParentRebuild } from './development/parent/binding';
import { wakeRelatedDevelopmentParentEnding, assertDevelopmentWriter } from './development/parent/admission';
import { admitDevelopmentParentEnding, prepareDevelopmentParentEnding, selectedDevelopmentParent } from './development/parent/request';
import type { RuntimeInitializationStatus } from '@crewstation/contracts';
import { RuntimeInitializationStatusSchema } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import type { TaskEnvironment } from '../domain/taskEnvironment';
import { transition } from '../domain/taskEnvironment';
import type { TaskRuntimeUseCaseDeps } from './dependencies';
import { scheduleExecutionCleanup } from './nativeExecution';

const terminalFailure = (state: string) => ['failed', 'cancelled', 'unknown'].includes(state);

/** 连接只表示协议可用。用途初始化通过以后才放行任务、Agent 与重建 ready。 */
export async function reconcileRuntimeInitialization(deps: TaskRuntimeUseCaseDeps, env: TaskEnvironment): Promise<boolean> {
  if (!env.render?.runtimeImage || env.state !== 'creating') return false;
  const admission = await deps.uow.run(async (scope) => {
    await scope.admissions.lock(env.projectId);
    const current = await scope.environments.getById(env.id);
    if (!current) return { sealed: false, witness: undefined };
    if (await wakeRelatedDevelopmentParentEnding(scope, current)) return { sealed: true, witness: undefined };
    return { sealed: false, witness: await assertDevelopmentWriter(scope, current) };
  });
  if (admission.sealed) return true;
  const timeout = initializationTimeout(env, deps.clock.now());
  let status = timeout ? unavailable(timeout) : env.runtimeInitialization;
  if (!status || !terminalFailure(status.state)) {
    if (!env.connected || !deps.initializationRunner) return false;
    status = await readStatus(deps, env);
    if (!status) return false;
  }
  const observation = status;
  const prepared = !env.native && terminalFailure(observation.state) ? await prepareDevelopmentParentEnding(deps, env) : undefined;
  const parentWitness = admission.witness;
  return deps.uow.run(async (scope) => {
    await scope.admissions.lock(env.projectId);
    const current = await scope.environments.getById(env.id);
    if (!current || current.state !== 'creating' || current.podName !== env.podName || current.runnerTokenHash !== env.runnerTokenHash || current.render?.start !== env.render?.start) return false;
    if (await wakeRelatedDevelopmentParentEnding(scope, current)) return true;
    if (terminalFailure(observation.state) && await selectedDevelopmentParent(scope, current)) {
      if (!prepared) return false; // A protected child was admitted during the external read: retry preparation outside this lock.
      await admitDevelopmentParentEnding(scope, prepared, 'compensation', { cause: 'runtime-initialization', observation }, deps.clock.now());
      return true;
    }
    await assertDevelopmentWriter(scope, current, parentWitness);
    // Runner 可能刚在连接期限内受理，已开始独立初始化预算；旧读取不能把它误判超时。
    if (timeout && !initializationTimeout(current, deps.clock.now())) return false;
    if (!terminalFailure(observation.state) && !current.connected) return false;
    const now = deps.clock.now(), observed = { ...current, runtimeInitialization: observation };
    if (observation.state === 'succeeded') {
      const rebuild = current.rebuildId ? await scope.rebuilds.get(current.rebuildId) : undefined;
      if (current.rebuildId && !rebuild || rebuild && !['starting', 'ready'].includes(rebuild.state)) return false;
      if (await requireCurrentParentRebuild(scope, current, rebuild) && (!rebuild?.podUid || !rebuild.secretUid || rebuild.podUid !== current.podUid)) return false;
      await scope.environments.update(transition(observed, 'running', now, { message: '运行环境初始化完成', ...(current.native ? { native: { ...current.native, state: 'running' } } : {}) }));
      if (rebuild?.state === 'starting') await scope.rebuilds.update({ ...rebuild, state: 'ready', updatedAt: now, message: '原工作树已恢复，运行环境初始化完成' });
      return true;
    }
    if (terminalFailure(observation.state)) {
      const message = `运行环境初始化${observation.state === 'unknown' ? '结果不明，请重建容器' : '未完成，请检查初始化步骤和工具要求'}${observation.error ? `：${observation.error}` : ''}`;
      if (current.native) { await scheduleExecutionCleanup(scope, observed, now, message); return true; }
      // 保留工作卷；物理 Pod 确认消失后才允许失败状态释放额度。
      await deps.cluster.deletePod(current);
      if ((await deps.cluster.podPhase(current)).phase !== 'Missing') {
        await scope.environments.update({ ...observed, message: `${message}；等待容器回收` }); return true;
      }
      await scope.environments.update(transition(observed, 'failed', now, { connected: false, message }));
      await scope.quota.release(current);
      const rebuild = current.rebuildId ? await scope.rebuilds.get(current.rebuildId) : undefined;
      if (rebuild?.state === 'starting') await scope.rebuilds.update({ ...rebuild, state: 'failed', updatedAt: now, message });
      return true;
    }
    if (JSON.stringify(current.runtimeInitialization) === JSON.stringify(observation)) return false;
    await scope.environments.update({ ...observed, message: '运行环境初始化中' }); return true;
  });
}

async function readStatus(deps: TaskRuntimeUseCaseDeps, env: TaskEnvironment): Promise<RuntimeInitializationStatus | undefined> {
  const runner = deps.initializationRunner!, image = env.render!.runtimeImage!;
  try {
    const connection = await runner.connectionStatus(env.id);
    if (!connection.connected) return undefined;
    if (connection.capabilities?.runtimeInitialization !== 1) return unavailable('镜像不支持运行环境初始化协议');
    const parsed = RuntimeInitializationStatusSchema.safeParse(await runner.sendCommand(env.id, { id: newResourceId(), type: 'runtimeInitializationStatus' }));
    if (!parsed.success) return unavailable('Runner 初始化状态不符合协议');
    const status = parsed.data, uid = env.native?.podUid ?? env.podUid;
    if (!uid) return undefined; // Pod 尚未完成实例绑定，下轮再核对。
    const expected = new Bun.CryptoHasher('sha256').update(`${env.id}/${env.render!.start}/${status.containerIdentity}/${image.versionId}/${image.initializerDigest}`).digest('hex');
    if (!status.enabled || status.versionId !== image.versionId || !status.containerIdentity?.startsWith(`${uid}/`) || status.executionId !== expected) return unavailable('初始化回执与当前容器或镜像不一致');
    return status;
  } catch { return undefined; } // 连接暂时中断不能误判初始化成功或重执行。
}

function unavailable(error: string): RuntimeInitializationStatus { return { enabled: true, state: 'unknown', steps: [], checks: [], error }; }

function initializationTimeout(env: TaskEnvironment, now: Date): string | undefined {
  const render = env.render, initialization = render?.runtimeInitializationDeadline;
  const deadline = initialization?.generation === render?.start ? initialization : render?.runtimeConnectionDeadline;
  if (!deadline || deadline.generation !== render?.start || Date.parse(deadline.at) > now.getTime()) return undefined;
  return deadline === initialization ? '等待初始化结果超过期限，请重建容器' : '等待 Runner 连接超过期限，请检查镜像启动入口';
}
