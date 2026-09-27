import type { TaskId, TraceId } from '@crewstation/contracts';
import { newTraceId, precondition } from '@crewstation/kernel';
import { PROFILE_TEST_PROJECT_ID, PROFILE_TEST_SERVICE_ID } from '../../domain/profileTestEnvironment';
import { hashRunnerToken, newRunnerToken } from '../../domain/runnerToken';
import type { TaskEnvironment } from '../../domain/taskEnvironment';
import { podNameFor, pvcNameFor } from '../../domain/taskEnvironment';
import type { TaskRuntimeUseCaseDeps } from '../dependencies';

export interface ImageProbeCleanup {
  exclusive<T>(id: string, run: (signal: AbortSignal) => Promise<T>): Promise<{ acquired: false } | { acquired: true; value: T }>;
  objectsGone(env: TaskEnvironment, signal: AbortSignal): Promise<boolean>;
}

/** 与建 Pod 的调和器共用租约；墓碑先落库，物理对象确实消失后才退验证容量。 */
export function stopImageProbe(deps: TaskRuntimeUseCaseDeps, cleanup?: ImageProbeCleanup) {
  return async (validationId: string): Promise<boolean> => {
    if (!cleanup) throw precondition('验证清理租约尚未配置');
    const result = await cleanup.exclusive(validationId, async (leaseSignal) => {
      const signal = AbortSignal.any([leaseSignal, AbortSignal.timeout(20000)]);
      const env = await deps.uow.run(async (s) => {
        await s.admissions.lock(PROFILE_TEST_PROJECT_ID);
        const current = await s.environments.getById(validationId as TaskId), now = deps.clock.now();
        if (!current) {
          const id = validationId as TaskId;
          await s.environments.insert({ id, projectId: PROFILE_TEST_PROJECT_ID, serviceId: PROFILE_TEST_SERVICE_ID, kind: 'profile-test', state: 'released', volumeMode: 'follow-container', profile: deps.settings.defaultProfile,
            namespace: deps.settings.systemNamespace, podName: podNameFor(id), pvcName: pvcNameFor(id), traceId: newTraceId() as TraceId, runnerTokenHash: hashRunnerToken(newRunnerToken()), connected: false,
            labels: { 'crewstation.io/runtime-validation': validationId }, createdAt: now, updatedAt: now, lastActivityAt: now });
          return undefined;
        }
        if (current.kind !== 'profile-test' || current.labels['crewstation.io/runtime-validation'] !== validationId) throw precondition('验证环境身份冲突');
        if (current.state === 'released') return current;
        const releasing: TaskEnvironment = { ...current, state: 'releasing', connected: false, updatedAt: now };
        await s.environments.update(releasing); return releasing;
      });
      signal.throwIfAborted();
      if (!env) return true;
      if (!await cleanup.objectsGone(env, signal)) return false;
      signal.throwIfAborted();
      await deps.uow.run(async (s) => {
        await s.admissions.lock(PROFILE_TEST_PROJECT_ID);
        const current = (await s.environments.getById(env.id))!;
        if (current.render?.runtimeValidation?.quotaHeld) await s.admissions.release(PROFILE_TEST_PROJECT_ID);
        await s.environments.update({ ...current, state: 'released', connected: false, updatedAt: deps.clock.now(), ...(current.render?.runtimeValidation ? { render: { ...current.render, runtimeValidation: { ...current.render.runtimeValidation, quotaHeld: false } } } : {}) });
      });
      return true;
    });
    return result.acquired && result.value;
  };
}
