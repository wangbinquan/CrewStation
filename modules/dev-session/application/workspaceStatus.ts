import type { Actor, ProjectId, WorkspaceStatusDto } from '@crewstation/contracts';
import { RunnerWorkspaceStatusSchema } from '@crewstation/contracts';
import { notFound } from '@crewstation/kernel';
import type { EnvironmentView } from '../ports/runtime';
import type { DevSessionUseCaseDeps } from './dependencies';

/** 无会话与不能检查是不同结果。授权在读取会话或 Runner 前完成。 */
export function workspaceStatusUseCase(deps: DevSessionUseCaseDeps) {
  return async (actor: Actor, projectId: ProjectId): Promise<WorkspaceStatusDto> => {
    await deps.authorizer.authorize(actor, projectId, 'view');
    const env = await deps.environments.findDevSession(projectId);
    if (!env) throw notFound('开发会话', projectId);
    return inspectWorkspace(deps, env);
  };
}

/** 发布／释放可在自己的动作授权之后复用；不做 push、fetch、tag 或文件写入。 */
export async function inspectWorkspace(deps: DevSessionUseCaseDeps, env: EnvironmentView): Promise<WorkspaceStatusDto> {
  const unavailable = (reason: string): WorkspaceStatusDto => ({ status: 'unavailable', taskId: env.id, reason, checkedAt: deps.clock.now().toISOString() });
  if (!env.connected) return unavailable('开发容器未连接，无法检查工作树');
  try {
    const raw = await deps.runner.sendCommand(env.id, { id: `workspace-${crypto.randomUUID()}`, type: 'workspaceStatus' });
    const parsed = RunnerWorkspaceStatusSchema.safeParse(raw);
    if (!parsed.success) return unavailable('TaskRunner 没有返回有效的工作树检查结果，请更新任务容器后重试');
    return { ...parsed.data, taskId: env.id };
  } catch (error) {
    deps.logger.warn('workspace inspection unavailable', { taskId: env.id, error: String(error) });
    return unavailable('工作树检查失败，请确认开发容器已连接后重新检查');
  }
}
