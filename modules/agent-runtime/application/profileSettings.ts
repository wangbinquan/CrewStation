import type { Actor, ComputeProfileDetailDto } from '@crewstation/contracts';
import { conflict, notFound } from '@crewstation/kernel';
import type { AgentRuntimeUseCaseDeps } from './dependencies';
import { profileQueries } from './profileQueries';
import { adminOnly } from './toDto';

const DEFAULT_LOCKED = 'default_profile_locked';

/**
 * 启用／停用、设为默认与删除（C19，照 agent-workflow）：默认档位不能停用也不能删除；
 * 删除被已上线版本引用的档位要先看到项目清单并确认。这些开关不进修订，不让测试作废（P3）。
 */
export function profileSettingUseCases(deps: AgentRuntimeUseCaseDeps) {
  const { uow, clock } = deps;
  const { getProfile, referencingProjects } = profileQueries(deps);
  return {
    setDefaultVisible: async (actor: Actor, name: string, defaultVisible: boolean): Promise<ComputeProfileDetailDto> => {
      adminOnly(actor);
      await uow.run(async (scope) => {
        const profile = await scope.profiles.lock(name);
        if (!profile) throw notFound('算力档位', name);
        if (profile.isDefault && !defaultVisible) throw conflict('平台默认档位必须默认可见，请先更换默认档位', { code: 'default_profile_visible' });
        await scope.profiles.update({ ...profile, defaultVisible, updatedBy: actor.userId, updatedAt: clock.now() });
      });
      return getProfile(actor, name);
    },
    setEnabled: async (actor: Actor, name: string, enabled: boolean): Promise<ComputeProfileDetailDto> => {
      adminOnly(actor);
      await uow.run(async (scope) => {
        const profile = await scope.profiles.lock(name);
        if (!profile) throw notFound('算力档位', name);
        if (!enabled && profile.isDefault) throw conflict('默认档位不能停用，请先把默认改到其他档位', { code: DEFAULT_LOCKED });
        if (profile.enabled !== enabled) await scope.profiles.update({ ...profile, enabled, updatedBy: actor.userId, updatedAt: clock.now() });
      });
      return getProfile(actor, name);
    },
    setDefault: async (actor: Actor, name: string): Promise<ComputeProfileDetailDto> => {
      adminOnly(actor);
      await uow.run(async (scope) => {
        const profile = await scope.profiles.lock(name);
        if (!profile) throw notFound('算力档位', name);
        if (profile.isDefault) return;
        if (!profile.enabled) throw conflict('停用的档位不能设为默认，请先启用', { code: 'profile_disabled' });
        // default 会被 Manifest 的业务子任务引用，而通用终端档位不能用于业务子任务（C6、C13）。
        if (profile.protocol === 'terminal') throw conflict('通用终端协议的档位不能设为默认：default 会被业务子任务引用', { code: 'terminal_profile_not_allowed' });
        await scope.profiles.clearDefault();
        await scope.profiles.update({ ...profile, isDefault: true, defaultVisible: true, updatedBy: actor.userId, updatedAt: clock.now() });
      });
      return getProfile(actor, name);
    },
    removeProfile: async (actor: Actor, name: string, confirmReferences: boolean): Promise<void> => {
      adminOnly(actor);
      const profile = await uow.read.profiles.get(name);
      if (!profile) throw notFound('算力档位', name);
      if (profile.isDefault) throw conflict('默认档位不能删除，请先把默认改到其他档位', { code: DEFAULT_LOCKED });
      const projects = await referencingProjects(name);
      if (projects.length > 0 && !confirmReferences) {
        throw conflict(`档位 ${name} 被以下项目的算力授权或已上线版本引用：${projects.join('、')}；删除后这些项目下一次起 Agent 会报「档位不存在」，确认后再删除`, { code: 'profile_referenced', projects });
      }
      await uow.run(async (scope) => {
        const locked = await scope.profiles.lock(name);
        if (!locked) return;
        if (locked.isDefault) throw conflict('默认档位不能删除，请先把默认改到其他档位', { code: DEFAULT_LOCKED });
        await scope.tests.removeAll(name);
        await scope.credentials.removeAll(name);
        await scope.revisions.removeAll(name);
        await scope.profiles.remove(name);
      });
    },
  };
}
