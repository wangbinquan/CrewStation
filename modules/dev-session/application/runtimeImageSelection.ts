import type { Actor, TaskId, ProjectId, RuntimeImageExecutionSnapshot } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { DevSessionUseCaseDeps } from './dependencies';

export async function reserveDevelopmentImage(deps: DevSessionUseCaseDeps, actor: Actor, projectId: ProjectId, owner: { type: 'session' | 'agent'; id: string }, requested?: string, profile?: { profileId: string; revision: number }): Promise<RuntimeImageExecutionSnapshot | undefined> {
  if (!deps.runtimeImages) {
    if (requested) throw precondition('运行镜像选择端口尚未配置');
    return undefined;
  }
  return deps.runtimeImages.reserve(actor, projectId, owner, requested, profile);
}

export async function restoreDevelopmentImage(deps: DevSessionUseCaseDeps, snapshot: RuntimeImageExecutionSnapshot | undefined, parentTaskId: TaskId, from: string | undefined, to: string): Promise<void> {
  if (!snapshot || !from) return;
  if (!deps.runtimeImages) throw precondition('镜像恢复端口尚未配置');
  const parent = await deps.environments.getEnvironment(parentTaskId);
  if (!parent) throw precondition('恢复所需的父工作区不存在');
  await deps.runtimeImages.restore(parent.projectId, snapshot, from, to);
}
