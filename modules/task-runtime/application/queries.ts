import type { Actor, ProjectId, TaskId } from '@crewstation/contracts';
import { notFound } from '@crewstation/kernel';
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
  branch?: string;
  preview?: { command: string[]; port: number; healthPath: string };
  traceId: string;
  createdBy?: string;
  message?: string;
  createdAt: string;
  lastActivityAt: string;
}

export function environmentToDto(env: TaskEnvironment): EnvironmentDto {
  return {
    id: env.id, projectId: env.projectId, serviceId: env.serviceId, kind: env.kind, state: env.state, volumeMode: env.volumeMode, profile: env.profile, podName: env.podName,
    connected: env.connected, ...(env.branch ? { branch: env.branch } : {}), ...(env.preview ? { preview: env.preview } : {}), traceId: env.traceId, ...(env.createdBy ? { createdBy: env.createdBy } : {}), ...(env.message ? { message: env.message } : {}),
    createdAt: env.createdAt.toISOString(), lastActivityAt: env.lastActivityAt.toISOString(),
  };
}

export function environmentQueries(deps: TaskRuntimeUseCaseDeps) {
  const { uow, authorizer } = deps;
  return {
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
    findDevSession: (projectId: ProjectId) => uow.read.environments.findDevSession(projectId),
    listRunningDevSessions: async () => (await uow.read.environments.listByStates(['creating', 'running'])).filter((e) => e.kind === 'dev-session'),
    verifyRunnerToken: async (taskId: TaskId, token: string): Promise<{ ok: true; projectId: string } | { ok: false; reason: string }> => {
      const env = await uow.read.environments.getById(taskId);
      if (!env) return { ok: false, reason: '任务不存在' };
      if (env.state === 'released' || env.state === 'failed') return { ok: false, reason: `任务处于 ${env.state}` };
      return tokenMatches(token, env.runnerTokenHash) ? { ok: true, projectId: env.projectId } : { ok: false, reason: '令牌无效' };
    },
    canOpenStream: async (actor: Actor, taskId: TaskId): Promise<boolean> => {
      const env = await uow.read.environments.getById(taskId);
      if (!env) return false;
      try { await authorizer.authorize(actor, env.projectId, env.kind === 'dev-session' ? 'develop' : 'view'); return true; } catch { return false; }
    },
  };
}
