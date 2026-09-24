import type { ReleaseId, ServiceId } from '@crewstation/contracts';
import { notFound, precondition } from '@crewstation/kernel';
import type { SlotDeployRef } from '../api/moduleApi';
import type { SlotState } from '../domain/slots';
import { withSlot } from '../domain/slots';
import type { ReleaseUseCaseDeps } from './dependencies';
import { renderSlotEnv } from './pipelineEnv';

/** 槽此刻还要这一次部署：期望是它、没下线、槽上是这个版本。 */
function wants(slot: SlotState | undefined, ref: SlotDeployRef): slot is SlotState & { readonly workload: NonNullable<SlotState['workload']> } {
  return !!slot?.workload && !slot.offline && slot.releaseId === ref.releaseId && slot.workload.releaseId === ref.releaseId && slot.workload.revision === ref.revision;
}

/**
 * 服务槽的所属模块给调和器的两个回调（RFC-025 T8，与 I25 同一裁定：渲染时回调）。环境在建 Secret 的这一刻渲染——平台约定变量、生产组配置与
 * 数据连接串，值不落台账；实际用上的配置版本记回发布（只改这一列，不与流水线抢写发布记录）。建不成时把槽记为失败并记下原因，
 * 由流水线下一步照它判发布失败（发布记录只由流水线写）。
 */
export function slotOwnerUseCases(deps: ReleaseUseCaseDeps) {
  const { uow, clock } = deps;
  return {
    slotEnvValues: async (ref: SlotDeployRef): Promise<Readonly<Record<string, string>>> => {
      const slot = (await uow.read.slots.get(ref.serviceId as ServiceId))?.[ref.physical];
      if (!wants(slot, ref)) throw precondition('这一次部署已不再需要：槽上换了版本或已下线');
      const [release, svc] = await Promise.all([uow.read.releases.getById(ref.releaseId as ReleaseId), deps.services.resolveServiceById(ref.serviceId as ServiceId)]);
      if (!release?.manifest || !svc) throw notFound('发布', ref.releaseId);
      const env = await renderSlotEnv(deps, { projectId: release.projectId, serviceId: release.serviceId, projectSlug: svc.slug, serviceName: svc.name, physical: ref.physical, manifest: release.manifest });
      if (release.configVersion !== env.configVersion) await uow.read.releases.recordConfigVersion(release.id, env.configVersion);
      return env.values;
    },
    slotFailed: async (ref: SlotDeployRef, message: string): Promise<void> => {
      await uow.run(async (scope) => {
        const slots = await scope.slots.get(ref.serviceId as ServiceId), slot = slots?.[ref.physical];
        if (!slots || !wants(slot, ref) || slot.state !== 'deploying') return;
        await scope.slots.save(withSlot(slots, { ...slot, state: 'failed', failure: message.slice(0, 1000), updatedAt: clock.now() }, clock.now()));
      });
    },
  };
}
