import type { Actor, ProjectId, TaskId } from '@crewstation/contracts';
import { TASKRUNNER_PROTOCOL_VERSION } from '@crewstation/contracts';
import type { DevSessionDto } from '@crewstation/contracts';
import { notFound, precondition } from '@crewstation/kernel';
import { tokenMatches } from '../domain/runnerToken';
import type { EnvironmentState, TaskEnvironment } from '../domain/taskEnvironment';
import type { TaskRuntimeUseCaseDeps } from './dependencies';

export interface EnvironmentDto {
  id: TaskId;
  projectId: ProjectId;
  serviceId: string;
  kind: TaskEnvironment['kind'];
  state: EnvironmentState;
  volumeMode: TaskEnvironment['volumeMode'];
  profile: string;
  podName: string;
  connected: boolean;
  native?: Pick<NonNullable<TaskEnvironment['native']>, 'parentTaskId' | 'agentId' | 'terminalId' | 'runnerId' | 'state' | 'profile'> & { purpose: NonNullable<NonNullable<TaskEnvironment['native']>['purpose']> };
  branch?: string;
  preview?: { command: string[]; port: number; healthPath: string };
  traceId: string;
  createdBy?: string;
  message?: string;
  connectionIssue?: DevSessionDto['connectionIssue'];
  createdAt: string;
  lastActivityAt: string;
}

export function environmentToDto(env: TaskEnvironment): EnvironmentDto {
  return {
    id: env.id, projectId: env.projectId, serviceId: env.serviceId, kind: env.kind, state: env.state, volumeMode: env.volumeMode, profile: env.profile, podName: env.podName,
    connected: env.connected && !env.runnerRejection, ...(env.branch ? { branch: env.branch } : {}), ...(env.preview ? { preview: env.preview } : {}), traceId: env.traceId, ...(env.createdBy ? { createdBy: env.createdBy } : {}), ...(env.message ? { message: env.message } : {}),
    createdAt: env.createdAt.toISOString(), lastActivityAt: env.lastActivityAt.toISOString(),
    ...(env.runnerRejection ? { connectionIssue: { ...env.runnerRejection, requiredProtocol: TASKRUNNER_PROTOCOL_VERSION } } : {}),
    ...(env.native ? { native: { purpose: env.native.purpose ?? 'cli', parentTaskId: env.native.parentTaskId, agentId: env.native.agentId, ...(env.native.terminalId ? { terminalId: env.native.terminalId } : {}), runnerId: env.native.runnerId, state: env.native.state, profile: env.native.profile, ...(env.native.failureReason ? { failureReason: env.native.failureReason } : {}) } } : {}),
  };
}

export function environmentQueries(deps: TaskRuntimeUseCaseDeps) {
  const { uow, authorizer } = deps;
  return {
    listClusterTasks: async () => {
      const result: ReturnType<typeof clusterTask>[] = []; let after: string | undefined;
      for (let page = 0; page < 1000; page++) {
        const environments = await uow.read.environments.listByStates(['creating', 'running', 'paused', 'releasing', 'released', 'failed'], { after, limit: 500 });
        result.push(...environments.map(clusterTask));
        if (environments.length < 500) return result;
        after = environments.at(-1)!.id;
      }
      throw precondition('任务目录超过单轮采集上限，保留上次快照');
    },
    getEnvironment: async (taskId: TaskId): Promise<TaskEnvironment | undefined> => uow.read.environments.getById(taskId),
    listEnvironments: async (actor: Actor, projectId: ProjectId, states?: EnvironmentState[]): Promise<EnvironmentDto[]> => {
      await authorizer.authorize(actor, projectId, 'view');
      return (await uow.read.environments.listByProject(projectId, states)).map(environmentToDto);
    },
    describeEnvironment: async (actor: Actor, taskId: TaskId): Promise<EnvironmentDto> => {
      const env = await uow.read.environments.getById(taskId);
      if (!env) throw notFound('任务', taskId);
      await authorizer.authorize(actor, env.projectId, 'view');
      return environmentToDto(env);
    },
    findDevSession: (projectId: ProjectId, options?: { includeLatestFailure?: boolean }) => uow.read.environments.findDevSession(projectId, options),
    listRunningDevSessions: async () => (await uow.read.environments.listByStates(['creating', 'running'])).filter((e) => e.kind === 'dev-session' && !e.native),
    verifyRunnerToken: async (taskId: TaskId, token: string): Promise<{ ok: true; projectId: string } | { ok: false; reason: string }> => {
      const env = await uow.read.environments.getById(taskId);
      if (!env) return { ok: false, reason: '任务不存在' };
      if (env.state === 'released' || env.state === 'failed') return { ok: false, reason: `任务处于 ${env.state}` };
      return tokenMatches(token, env.runnerTokenHash) ? { ok: true, projectId: env.projectId } : { ok: false, reason: '令牌无效' };
    },
    canOpenStream: async (actor: Actor, taskId: TaskId): Promise<boolean> => {
      const env = await uow.read.environments.getById(taskId);
      if (!env) return false;
      // 检查任务不属于任何项目：只有管理员能看它的流。
      if (env.kind === 'profile-test') return actor.isAdmin;
      try { await authorizer.authorize(actor, env.projectId, env.kind === 'dev-session' ? 'develop' : 'view'); return true; } catch { return false; }
    },
  };
}

function clusterTask(e: TaskEnvironment) { return ({ taskId: e.id, projectId: e.projectId, namespace: e.namespace, podName: e.podName, pvcName: e.pvcName, ...(e.podUid ? { podUid: e.podUid } : {}), kind: e.kind, state: e.state, profile: e.native?.computeProfile?.name ?? e.labels['crewstation.io/compute-profile'] ?? e.profile, ...(e.kind === 'profile-test' && e.labels['crewstation.io/profile-revision'] ? { profileRevision: Number(e.labels['crewstation.io/profile-revision']) } : {}), revision: e.updatedAt.toISOString(), volumeMode: e.volumeMode, ...(e.native ? { purpose: e.native.purpose ?? 'cli', parentTaskId: e.native.parentTaskId, agentId: e.native.agentId, ...(e.native.terminalId ? { terminalId: e.native.terminalId } : {}), ...(e.native.podUid ? { podUid: e.native.podUid } : {}), pvcUid: e.native.pvcUid, ...(e.native.computeProfile ? { profileRevision: e.native.computeProfile.revision } : {}) } : {}) }); }
