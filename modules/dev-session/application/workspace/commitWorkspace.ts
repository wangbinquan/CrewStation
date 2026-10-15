import type { Actor, CommitWorkspaceDto, CommitWorkspaceRequest, ProjectId } from '@crewstation/contracts';
import { CommitWorkspaceResultSchema } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { DevSessionUseCaseDeps } from '../dependencies';

export function commitWorkspaceUseCase(deps: DevSessionUseCaseDeps) {
  return async (actor: Actor, projectId: ProjectId, input: CommitWorkspaceRequest): Promise<CommitWorkspaceDto> => {
    await deps.authorizer.authorize(actor, projectId, 'publish');
    const env = await deps.environments.findDevSession(projectId);
    if (!env || !env.connected || env.state !== 'running' || env.id !== input.expectedTaskId) throw precondition('开发会话已变化或未连接，请重新检查改动');
    const { expectedTaskId: _taskId, ...commit } = input;
    const result = CommitWorkspaceResultSchema.parse(await deps.runner.sendCommand(env.id, { id: `commit-${crypto.randomUUID()}`, type: 'commitWorkspace', ...commit, actorUserId: actor.userId }));
    await deps.environments.touch(env.id);
    return { ...result, taskId: env.id };
  };
}
