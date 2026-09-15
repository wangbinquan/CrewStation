import type { DevSessionRebuildDto, ProjectId, RebuildDevSessionRequest, TaskId } from '@crewstation/contracts';
import { RebuildDevSessionRequestSchema } from '@crewstation/contracts';
import { conflict, precondition, quotaExceeded } from '@crewstation/kernel';
import type { EnvironmentRebuild } from '../domain/environmentRebuild';
import { rebuildToDto } from '../domain/environmentRebuild';
import { hashRunnerToken, newRunnerToken } from '../domain/runnerToken';
import { transition } from '../domain/taskEnvironment';
import type { RebuildDependencies } from './rebuildInspection';
import { failedDevSession, inspectRebuild, validateRebuild } from './rebuildInspection';

export function rebuildUseCases(deps: RebuildDependencies) {
  const requestRebuild = async (projectId: ProjectId, raw: RebuildDevSessionRequest): Promise<DevSessionRebuildDto> => {
    const input = RebuildDevSessionRequestSchema.parse(raw);
    return deps.uow.run(async (scope) => {
      await scope.admissions.lock(projectId);
      const previous = await scope.rebuilds.get(input.requestId);
      if (previous) {
        if (previous.projectId !== projectId || JSON.stringify(previous.input) !== JSON.stringify(input)) throw conflict('该恢复请求编号已用于另一份确认内容');
        return rebuildToDto(previous);
      }
      const env = await failedDevSession(scope, projectId);
      await validateRebuild(deps, env, input);
      const children = (await scope.environments.listChildren(env.id)).filter((child) => child.native?.state !== 'finished');
      const nodes = new Set(children.map((child) => child.native!.nodeName));
      if (nodes.size > 1 || children.some((child) => child.native!.pvcUid !== input.expectedVolumeUid)) throw precondition('现有 CLI 的工作卷或节点不一致，请先由管理员检查');
      const nodeName = [...nodes][0];
      const limit = (await deps.quotas.quotaLimit(projectId)) ?? 0;
      if (!(await scope.admissions.tryAcquire(projectId, limit))) throw quotaExceeded('项目并发任务配额已满，工作卷保持不变');
      const now = deps.clock.now();
      const podName = `task-${env.id.slice(4, 16)}-r-${input.requestId.replaceAll('-', '').slice(0, 12)}`;
      const record: EnvironmentRebuild = { id: input.requestId, taskId: env.id, projectId, input, namespace: env.namespace,
        originalPodName: env.podName, podName, pvcName: env.pvcName, secretName: `${podName}-runner`, image: deps.settings.taskImage,
        state: 'queued', createdAt: now, updatedAt: now, ...(nodeName ? { nodeName } : {}) };
      await scope.rebuilds.insert(record);
      // 即刻失效旧 Runner；替换 Pod 只复用原工作卷，不重新检出仓库。
      await scope.environments.update(transition(env, 'creating', now, { rebuildId: record.id, podName, profile: input.profile.name,
        connected: false, message: '已受理保留工作树重建，等待后台准备', runnerTokenHash: hashRunnerToken(newRunnerToken()) }));
      await scope.rebuildQueue.enqueue(record.id);
      return rebuildToDto(record);
    });
  };
  return {
    inspectRebuild: (projectId: ProjectId) => inspectRebuild(deps, projectId), requestRebuild,
    getRebuild: async (taskId: TaskId): Promise<DevSessionRebuildDto | undefined> => {
      const env = await deps.uow.read.environments.getById(taskId);
      const record = env?.rebuildId ? await deps.uow.read.rebuilds.get(env.rebuildId) : undefined;
      return record ? rebuildToDto(record) : undefined;
    },
  };
}
