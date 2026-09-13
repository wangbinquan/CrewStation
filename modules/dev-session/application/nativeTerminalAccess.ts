import type { Actor, TaskId } from '@crewstation/contracts';
import { forbidden, notFound, precondition, validation } from '@crewstation/kernel';
import type { DevSessionUseCaseDeps } from './dependencies';

export async function nativeEnvironment(deps: DevSessionUseCaseDeps, actor: Actor, taskId: TaskId, operation: 'view' | 'develop') {
  const env = await deps.environments.getEnvironment(taskId);
  if (!env) throw notFound('开发会话', taskId);
  await deps.authorizer.authorize(actor, env.projectId, operation);
  if (operation === 'develop' && !(await deps.environments.canOpenStream(actor, taskId))) throw forbidden('无权操作该会话');
  return env;
}

export async function nativeCompute(deps: DevSessionUseCaseDeps, name?: string) {
  const wanted = name ?? deps.settings.defaultComputeProfile;
  const profile = await deps.compute.resolve(wanted);
  if (!profile) throw validation(`算力档位 ${wanted} 不存在`, { available: (await deps.compute.list()).map((p) => p.name) });
  if (profile.driver === 'stub') throw precondition(`算力档位 ${wanted} 仅提供演示回显，不支持原生 CLI；请选择管理员提供的原生算力档位`);
  return { ...profile, driver: profile.driver };
}
