import type { ComputeProfileSelector, Actor, ProjectId, TaskId } from '@crewstation/contracts';
import { forbidden, notFound } from '@crewstation/kernel';
import type { DevSessionUseCaseDeps } from './dependencies';

export async function nativeEnvironment(deps: DevSessionUseCaseDeps, actor: Actor, taskId: TaskId, operation: 'view' | 'develop') {
  const env = await deps.environments.getEnvironment(taskId);
  if (!env) throw notFound('开发会话', taskId);
  await deps.authorizer.authorize(actor, env.projectId, operation);
  if (operation === 'develop' && !(await deps.environments.canOpenStream(actor, taskId))) throw forbidden('无权操作该会话');
  return env;
}

/** 「＋ CLI」用的档位（RFC-006）：三种协议都可以；省略或写 default 即默认档位，不存在、不可用由目录抛出可读错误。 */
export async function nativeCompute(deps: DevSessionUseCaseDeps, projectId: ProjectId, name?: ComputeProfileSelector) {
  return deps.compute.resolve(name, 'cli', projectId);
}
