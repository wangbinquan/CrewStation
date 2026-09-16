import type { ActivateRuntimeConfigRequest, Actor, DisableRuntimeConfigRequest, RuntimeCheckId, RuntimeConfigDetailDto, RuntimeConfigId } from '@crewstation/contracts';
import { conflict, notFound, precondition } from '@crewstation/kernel';
import { checkUsableFor } from '../domain/runtimeCheck';
import type { AgentRuntimeUseCaseDeps } from './dependencies';
import { manageConfigUseCases } from './manageConfigs';
import { adminOnly } from './toDto';

/**
 * 启用：expectedActiveRevision 与目标版本、检查三者对得上才切换 activeRevision。
 * 停用：只阻止后续新受理，已受理的执行按固定快照继续；回退 = 重新启用之前通过检查的版本。
 */
export function activationUseCases(deps: AgentRuntimeUseCaseDeps) {
  const { uow, clock } = deps;
  const { getConfig } = manageConfigUseCases(deps);
  return {
    activate: async (actor: Actor, id: RuntimeConfigId, input: ActivateRuntimeConfigRequest): Promise<RuntimeConfigDetailDto> => {
      adminOnly(actor);
      await uow.run(async (scope) => {
        const config = await scope.configs.lockById(id);
        if (!config) throw notFound('运行环境', id);
        if (config.activeRevision !== input.expectedActiveRevision) throw conflict(`当前已启用版本是 ${config.activeRevision ?? '无'}，与确认时不同，请重新确认`, { code: 'active_revision_conflict', activeRevision: config.activeRevision });
        const revision = await scope.revisions.get(id, input.revision);
        if (!revision) throw notFound('运行环境版本', `${id}@${input.revision}`);
        const usable = checkUsableFor(await scope.checks.get(input.checkId as RuntimeCheckId), revision);
        if (!usable.ok) throw precondition(`不能启用版本 ${input.revision}：${usable.reason}`, { code: 'check_not_usable' });
        await scope.configs.update({ ...config, activeRevision: revision.revision, enabled: true, updatedBy: actor.userId, updatedAt: clock.now() });
      });
      return getConfig(actor, id);
    },
    disable: async (actor: Actor, id: RuntimeConfigId, input: DisableRuntimeConfigRequest): Promise<RuntimeConfigDetailDto> => {
      adminOnly(actor);
      await uow.run(async (scope) => {
        const config = await scope.configs.lockById(id);
        if (!config) throw notFound('运行环境', id);
        if (config.activeRevision !== input.expectedActiveRevision) throw conflict(`当前已启用版本是 ${config.activeRevision ?? '无'}，与确认时不同`, { code: 'active_revision_conflict', activeRevision: config.activeRevision });
        if (!config.enabled) return;
        await scope.configs.update({ ...config, enabled: false, updatedBy: actor.userId, updatedAt: clock.now() });
      });
      return getConfig(actor, id);
    },
  };
}
