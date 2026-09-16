import type { Actor, ComputeProfileAdminDto, ComputeProfileDto, ComputeProfileSummaryDto, ComputeProfileWriteRequest } from '@crewstation/contracts';
import { conflict, forbidden, notFound, precondition, validation } from '@crewstation/kernel';
import type { ComputeProfile, RuntimeConfigSummary } from '../domain/plans';
import { computeAvailability } from '../domain/plans';
import type { ProjectUseCaseDeps } from './dependencies';

const toDto = (p: ComputeProfile): ComputeProfileDto => ({
  name: p.name, driver: p.driver, model: p.model, description: p.description, revision: p.revision,
  ...(p.taskProfile ? { taskProfile: p.taskProfile } : {}), ...(p.runtimeConfigId ? { runtimeConfigId: p.runtimeConfigId } : {}),
});

/**
 * 算力档位（RFC-001）＋运行环境绑定（RFC-004）。
 * 档位写入按 revision 比较：已托管的档位不带 expectedRevision 就拒绝，旧客户端不能无意清掉绑定。
 */
export function computeProfileUseCases(deps: ProjectUseCaseDeps) {
  const { uow, runtimeConfigs } = deps;
  const adminOnly = (actor: Actor): void => {
    if (!actor.isAdmin) throw forbidden('只有管理员可以维护算力档位');
  };
  const runtimeOf = async (profile: ComputeProfile): Promise<RuntimeConfigSummary | undefined> =>
    profile.runtimeConfigId ? runtimeConfigs.describe(profile.runtimeConfigId) : undefined;
  const summary = async (profile: ComputeProfile): Promise<ComputeProfileSummaryDto> => {
    const { available, reason } = computeAvailability(profile, await runtimeOf(profile));
    return { name: profile.name, description: profile.description, mode: profile.runtimeConfigId ? 'managed' : 'legacy', available, ...(reason ? { reason } : {}) };
  };
  const adminView = async (profile: ComputeProfile): Promise<ComputeProfileAdminDto> => {
    if (!profile.runtimeConfigId) return toDto(profile);
    const runtime = await runtimeOf(profile);
    const { available, reason } = computeAvailability(profile, runtime);
    return { ...toDto(profile), ...(runtime ? { runtime: { configName: runtime.name, driver: runtime.driver, enabled: runtime.enabled, activeRevision: runtime.activeRevision, ready: available, ...(reason ? { reason } : {}) } } : {}) };
  };
  return {
    /** 租户面投影：名字、说明与能否起 Agent；不泄露厂商、模型与运行配置内容（RFC-001）。 */
    listComputeProfiles: async (): Promise<ComputeProfileSummaryDto[]> => Promise.all((await uow.read.catalog.listComputeProfiles()).map(summary)),
    listComputeProfilesFull: async (actor: Actor): Promise<ComputeProfileAdminDto[]> => {
      adminOnly(actor);
      return Promise.all((await uow.read.catalog.listComputeProfiles()).map(adminView));
    },
    upsertComputeProfile: async (actor: Actor, input: ComputeProfileWriteRequest): Promise<ComputeProfileDto> => {
      adminOnly(actor);
      if (input.runtimeConfigId) {
        const runtime = await runtimeConfigs.describe(input.runtimeConfigId);
        if (!runtime) throw notFound('运行环境', input.runtimeConfigId);
        if (runtime.driver !== input.driver) throw validation(`运行环境 ${runtime.name} 的 CLI 是 ${runtime.driver}，不能绑定到 ${input.driver} 档位`, { runtimeDriver: runtime.driver });
      }
      const stored = await uow.run(async (scope) => {
        if (input.taskProfile && !await scope.catalog.getTaskProfile(input.taskProfile)) throw notFound('CLI 任务套餐', input.taskProfile);
        const current = await scope.catalog.getComputeProfile(input.name);
        // 托管档位的写入必须带版本：没有它的旧客户端会把 runtimeConfigId 当成未知字段丢掉。
        if (current?.runtimeConfigId && input.expectedRevision === undefined) throw precondition(`档位 ${input.name} 已绑定运行环境，写入必须携带 expectedRevision（当前 ${current.revision}）；请刷新管理页后重试`, { code: 'compute_profile_managed', revision: current.revision });
        if (input.expectedRevision !== undefined && (current?.revision ?? 0) !== input.expectedRevision) throw conflict(`档位 ${input.name} 已被修改（当前版本 ${current?.revision ?? 0}），请重新读取后保存`, { revision: current?.revision ?? 0 });
        const { expectedRevision, ...profile } = input;
        const written = await scope.catalog.upsertComputeProfile({ ...profile, description: profile.description }, expectedRevision);
        if (!written) throw conflict(`档位 ${input.name} 已被同时修改，请重新读取后保存`);
        return written;
      });
      return toDto(stored);
    },
    deleteComputeProfile: async (actor: Actor, name: string): Promise<void> => {
      adminOnly(actor);
      await uow.run((scope) => scope.catalog.deleteComputeProfile(name));
    },
    /** 供 dev-session、business-task、release 解析档位名 → 具体驱动、模型与运行环境绑定。 */
    resolveComputeProfile: async (name: string): Promise<ComputeProfileDto | undefined> => {
      const profile = await uow.read.catalog.getComputeProfile(name);
      return profile ? toDto(profile) : undefined;
    },
    /** 供 agent-runtime 展示引用数并拒绝删除被引用的运行环境。 */
    listComputeProfilesReferencing: async (runtimeConfigId: string): Promise<string[]> => (await uow.read.catalog.listComputeProfilesByRuntimeConfig(runtimeConfigId)).map((p) => p.name),
  };
}
