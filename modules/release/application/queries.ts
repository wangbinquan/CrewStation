import type { Actor, ReleaseDto, ReleaseId, ServiceId, SlotDto, TrafficSwitchDto } from '@crewstation/contracts';
import { notFound } from '@crewstation/kernel';
import type { Release } from '../domain/release';
import { DEFAULT_OFFLINE_POLICY } from '../domain/slotLifecycle';
import type { PhysicalSlot, ServiceSlots } from '../domain/slots';
import { standbyOf } from '../domain/slots';
import type { HostNaming } from '../ports/platform';
import type { RepositoryScope } from '../ports/unitOfWork';
import type { ReleaseUseCaseDeps } from './dependencies';
import { releaseToDto, slotToDto, switchToDto } from './toDto';
import { slotStateFromLedger } from '../domain/ledgerProjection';

/**
 * 两个槽的 DTO（正式在前）：读槽上与已下线记录里的版本，按当前平台策略算到期时间；配了资源台账时，
 * 就绪之后的状态照台账的观测（副本后来没全就绪是降级，RFC-025 设计 §11.2）。
 */
export async function loadSlotDtos(read: RepositoryScope, slots: ServiceSlots, projectSlug: string, hosts: HostNaming, only?: PhysicalSlot): Promise<SlotDto[]> {
  const physicals: PhysicalSlot[] = only ? [only] : [slots.active, standbyOf(slots.active)];
  const releases = new Map<string, Release>();
  for (const id of new Set(physicals.flatMap((p) => [slots[p].releaseId, slots[p].offline?.releaseId]).filter((v): v is ReleaseId => v !== undefined))) {
    const release = await read.releases.getById(id);
    if (release) releases.set(release.id, release);
  }
  const policy = (await read.offlinePolicy.get()) ?? DEFAULT_OFFLINE_POLICY;
  const phases = await Promise.all(physicals.map(async (p) => (await read.ledger?.slot(slots.serviceId, p))?.phase));
  return physicals.map((p, index) => {
    const dto = slotToDto(slots, p, releases, projectSlug, hosts, policy);
    return { ...dto, state: slotStateFromLedger(dto.state, phases[index]) };
  });
}

export interface ActiveEndpoint { physical: PhysicalSlot; namespace: string; kubernetesService: string; port: number }

export function releaseQueries(deps: Pick<ReleaseUseCaseDeps, 'uow' | 'authorizer' | 'services' | 'hosts'>) {
  const { uow, authorizer, services, hosts } = deps;
  const svcOf = async (serviceId: ServiceId) => {
    const svc = await services.resolveServiceById(serviceId);
    if (!svc) throw notFound('服务', serviceId);
    return svc;
  };
  return {
    listReleases: async (actor: Actor, serviceId: ServiceId): Promise<ReleaseDto[]> => {
      const svc = await svcOf(serviceId);
      await authorizer.authorize(actor, svc.projectId, 'view');
      const slots = await uow.read.slots.get(serviceId);
      return (await uow.read.releases.listByService(serviceId, 50)).map((r) => releaseToDto(r, slots));
    },
    getRelease: async (actor: Actor, releaseId: ReleaseId): Promise<ReleaseDto> => {
      const release = await uow.read.releases.getById(releaseId);
      if (!release) throw notFound('发布', releaseId);
      await authorizer.authorize(actor, release.projectId, 'view');
      return releaseToDto(release, await uow.read.slots.get(release.serviceId));
    },
    getSlots: async (actor: Actor, serviceId: ServiceId): Promise<SlotDto[]> => {
      const svc = await svcOf(serviceId);
      await authorizer.authorize(actor, svc.projectId, 'view');
      const slots = await uow.read.slots.get(serviceId);
      return slots ? loadSlotDtos(uow.read, slots, svc.slug, hosts) : [];
    },
    getPreviewSlot: async (actor: Actor, serviceId: ServiceId): Promise<SlotDto | null> => {
      const svc = await svcOf(serviceId);
      await authorizer.authorize(actor, svc.projectId, 'view-preview');
      const slots = await uow.read.slots.get(serviceId); if (!slots) return null;
      return (await loadSlotDtos(uow.read, slots, svc.slug, hosts, standbyOf(slots.active)))[0] ?? null;
    },
    listTrafficSwitches: async (actor: Actor, serviceId: ServiceId): Promise<TrafficSwitchDto[]> => {
      const svc = await svcOf(serviceId);
      await authorizer.authorize(actor, svc.projectId, 'view');
      return (await uow.read.switches.listByService(serviceId, 50)).map(switchToDto);
    },
    /** 供 gateway 与 events：当前承接 prod 的物理槽及其 Kubernetes Service；无就绪发布时为 undefined。 */
    activeEndpoint: async (serviceId: ServiceId): Promise<ActiveEndpoint | undefined> => {
      const svc = await services.resolveServiceById(serviceId);
      const slots = await uow.read.slots.get(serviceId);
      if (!svc || !slots) return undefined;
      const active = slots[slots.active];
      if (active.state === 'empty' || !active.releaseId) return undefined;
      const release = await uow.read.releases.getById(active.releaseId);
      return { physical: slots.active, namespace: svc.namespace, kubernetesService: `${svc.name}-${slots.active}`, port: release?.manifest?.spec.service.port ?? 80 };
    },
    /**
     * 供 agent-runtime 删除档位前列出受影响项目（RFC-006 P8）：两个槽当前部署的版本里，Manifest 明确引用的算力档位 UUID。
     * 经 `default` 间接引用或早期 stub 快照中尚不存在的算力档位不在其中。
     */
    deployedComputeReferences: async (serviceId: ServiceId): Promise<string[]> => {
      const slots = await uow.read.slots.get(serviceId);
      if (!slots) return [];
      const profileIds = new Set<string>();
      for (const physical of ['blue', 'green'] as PhysicalSlot[]) {
        const id = slots[physical].releaseId;
        const manifest = id ? (await uow.read.releases.getById(id))?.manifest : undefined;
        if (manifest?.kind !== 'DigitalWorker') continue;
        for (const profile of manifest.spec.tasks?.agentProfiles ?? []) if (profile.compute?.kind === 'profile') profileIds.add(profile.compute.profileId);
      }
      return [...profileIds].sort();
    },
    /** 供 gateway：两个物理槽当前的角色，用于把 Host 路由到对应 Service。 */
    slotRoles: async (serviceId: ServiceId): Promise<{ prod: PhysicalSlot; preview: PhysicalSlot } | undefined> => {
      const slots = await uow.read.slots.get(serviceId);
      return slots ? { prod: slots.active, preview: slots.active === 'blue' ? 'green' : 'blue' } : undefined;
    },
  };
}
