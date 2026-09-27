import { DomainTopic, RuntimeImageExecutionSnapshotSchema, TaskIdSchema } from '@crewstation/contracts';
import { conflict, jsonHash, validation } from '@crewstation/kernel';
import type { TaskEnvironment } from '../domain/taskEnvironment';
import type { CreateEnvironmentInput, TaskRuntimeUseCaseDeps } from './dependencies';

/** 固定 ID 只用于业务执行的持久意图；直接建 Pod 的旧路径不能提供丢回执后的安全恢复。 */
export function admissionFingerprint(deps: TaskRuntimeUseCaseDeps, input: CreateEnvironmentInput): string | undefined {
  if (input.runtimeImage) {
    RuntimeImageExecutionSnapshotSchema.parse(input.runtimeImage);
    if (deps.creation !== 'ledger') throw validation('运行镜像需要资源台账准入');
  }
  if (input.businessStorage && (input.businessStorage !== 'isolated-v1' || !input.admission || input.kind !== 'business' || input.branch || input.preview || deps.creation !== 'ledger')) throw validation('隔离业务卷需要无源码检出的业务台账准入');
  if (input.runtimeImageTaskId && (input.kind !== 'dev-session' || !input.runtimeImage || input.admission || !TaskIdSchema.safeParse(input.runtimeImageTaskId).success)) throw validation('镜像保留身份仅用于开发会话');
  if (!input.admission) return undefined;
  if (input.kind !== 'business' || deps.creation !== 'ledger') throw validation('固定任务 ID 需要业务任务与资源台账准入');
  if (!TaskIdSchema.safeParse(input.admission.id).success || !/^[a-f0-9]{64}$/.test(input.admission.fingerprint)) throw validation('任务准入 ID 或摘要无效');
  // 同一调用者摘要也不能掩盖请求变化。默认档位由首次准入固定，重试不重新解析。
  return jsonHash({ ...input, admission: input.admission.fingerprint, traceId: undefined, volumeMode: input.volumeMode ?? 'follow-container', labels: input.labels ?? {} });
}

export function matchAdmission(current: TaskEnvironment | undefined, fingerprint: string | undefined): TaskEnvironment | undefined {
  if (!current) return undefined;
  if (!fingerprint || current.admissionFingerprint !== fingerprint) throw conflict('任务 ID 已由不同准入请求使用');
  return current;
}

/** 项目锁内先检查持久回执，再扣额度、登记和发布事件；重试不重复扣额或投影。 */
export async function admitEnvironment(deps: TaskRuntimeUseCaseDeps, env: TaskEnvironment, limit: number, restartSource?: TaskEnvironment): Promise<TaskEnvironment> {
  return deps.uow.run(async (scope) => {
    await scope.admissions.lock(env.projectId);
    const replay = matchAdmission(await scope.environments.getById(env.id), env.admissionFingerprint);
    if (replay) return replay;
    if (restartSource) {
      const current = await scope.environments.getById(restartSource.id);
      if (!current || jsonHash(current) !== jsonHash(restartSource)) throw conflict('检查后原工作区已变化', { code: 'workspace_changed' });
      if ((await scope.environments.listChildren(current.id)).some((child) => child.native?.state !== 'finished')) throw conflict('检查后新增了活动子执行', { code: 'active_subtasks' });
    }
    if (await scope.admissions.blocked(env.id)) throw conflict('业务执行准入已取消', { code: 'admission_cancelled' });
    if (env.kind === 'dev-session' && (await scope.environments.findDevSession(env.projectId))) throw conflict('该项目已有一个开发会话在运行', { projectId: env.projectId });
    await scope.quota.acquire(env, limit, `并发任务已达配额上限 ${limit}`);
    await scope.environments.insert(env);
    await scope.events.publish(DomainTopic.taskCreated, { occurredAt: env.createdAt.toISOString(), traceId: env.traceId, projectId: env.projectId, serviceId: env.serviceId, taskId: env.id, kind: env.kind });
    return env;
  });
}
