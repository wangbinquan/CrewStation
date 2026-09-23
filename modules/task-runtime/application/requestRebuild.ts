import type { DevSessionRebuildDto, ProjectId, RebuildDevSessionRequest, TaskId } from '@crewstation/contracts';
import { RebuildDevSessionRequestSchema } from '@crewstation/contracts';
import { scheduleExecutionCleanup } from './nativeExecution';
import { conflict, newResourceId, precondition } from '@crewstation/kernel';
import type { EnvironmentRebuild } from '../domain/environmentRebuild';
import { rebuildToDto } from '../domain/environmentRebuild';
import { initialStartup } from '../domain/podStartup';
import { hashRunnerToken, newRunnerToken } from '../domain/runnerToken';
import { transition } from '../domain/taskEnvironment';
import type { RebuildDependencies } from './rebuildInspection';
import { recoverableDevSession, inspectRebuild, validateRebuild } from './rebuildInspection';

export function rebuildUseCases(deps: RebuildDependencies) {
  const requestRebuild = async (projectId: ProjectId, raw: RebuildDevSessionRequest): Promise<DevSessionRebuildDto> => {
    const input = RebuildDevSessionRequestSchema.parse(raw);
    return deps.uow.run(async (scope) => {
      await scope.admissions.lock(projectId);
      const previous = await scope.rebuilds.findRequest(projectId, input.requestId);
      if (previous) {
        if (previous.projectId !== projectId || JSON.stringify(previous.input) !== JSON.stringify(input)) throw conflict('该恢复请求编号已用于另一份确认内容');
        return rebuildToDto(previous);
      }
      const env = await recoverableDevSession(scope, projectId, input.reason === 'administrator-restart');
      await validateRebuild(deps, env, input);
      const children = (await scope.environments.listChildren(env.id)).filter((child) => child.native?.state !== 'finished');
      if (input.reason === 'administrator-restart') for (const child of children) await scheduleExecutionCleanup(scope, child, deps.clock.now(), '管理员重启工作区，结束本次执行');
      const nodes = new Set(children.map((child) => child.native!.nodeName));
      if (nodes.size > 1 || children.some((child) => child.native!.pvcUid !== input.expectedVolumeUid)) throw precondition('现有 CLI 的工作卷或节点不一致，请先由管理员检查');
      const nodeName = [...nodes][0];
      const limit = (await deps.quotas.quotaLimit(projectId)) ?? 0;
      const now = deps.clock.now();
      const id = newResourceId(), podName = `task-r-${id.replaceAll('-', '')}`;
      const record: EnvironmentRebuild = { id, taskId: env.id, projectId, input, namespace: env.namespace,
        originalPodName: env.podName, podName, pvcName: env.pvcName, secretName: `${podName}-runner`, image: deps.settings.taskImage,
        state: 'queued', createdAt: now, updatedAt: now, ...(nodeName ? { nodeName } : {}) };
      // 即刻失效旧 Runner；替换 Pod 只复用原工作卷，不重新检出仓库。
      const patch = { rebuildId: record.id, podName, profile: input.profile.id,
        connected: false, message: '已受理保留工作树重建，等待后台准备', runnerTokenHash: hashRunnerToken(newRunnerToken()),
        // RFC-022：重建的五段（保留工作卷、不重新检出），替换这个会话之前的启动过程。
        startup: initialStartup(now, { rebuild: true }) };
      // 仅前面核验过的协议拒绝环境沿用原占额进入恢复，不开放通用 running → creating 转移。
      const next = env.state === 'failed' ? transition(env, 'creating', now, patch) : { ...env, ...patch, state: 'creating' as const, updatedAt: now };
      // 失败的会话不占额度，重建要重新受理；受理的是重建之后的样子（新 Pod、重建中）。
      if (env.state === 'failed') await scope.quota.acquire(next, limit, '项目并发任务配额已满，工作卷保持不变');
      await scope.rebuilds.insert(record);
      await scope.environments.update(next);
      await scope.rebuildQueue.enqueue(record.id);
      return rebuildToDto(record);
    });
  };
  return {
    inspectRebuild: (projectId: ProjectId, administrator = false) => inspectRebuild(deps, projectId, administrator), requestRebuild,
    getRebuild: async (taskId: TaskId): Promise<DevSessionRebuildDto | undefined> => {
      const env = await deps.uow.read.environments.getById(taskId);
      const record = env?.rebuildId ? await deps.uow.read.rebuilds.get(env.rebuildId) : undefined;
      return record ? rebuildToDto(record) : undefined;
    },
  };
}
