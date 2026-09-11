import type { Actor, ReleaseDto, ReleaseId, ServiceId, SlotDto, TrafficSwitchDto } from '@crewstation/contracts';
import { notFound } from '@crewstation/kernel';
import type { Release } from '../domain/release';
import type { PhysicalSlot } from '../domain/slots';
import type { ReleaseUseCaseDeps } from './dependencies';
import { releaseToDto, slotToDto, switchToDto } from './toDto';

export interface ActiveEndpoint { physical: PhysicalSlot; namespace: string; kubernetesService: string; port: number }

export function releaseQueries(deps: ReleaseUseCaseDeps) {
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
      if (!slots) return [];
      const releases = new Map<string, Release>();
      for (const physical of ['blue', 'green'] as PhysicalSlot[]) {
        const id = slots[physical].releaseId;
        const release = id ? await uow.read.releases.getById(id) : undefined;
        if (release) releases.set(release.id, release);
      }
      return [slotToDto(slots, slots.active, releases, svc.slug, hosts), slotToDto(slots, slots.active === 'blue' ? 'green' : 'blue', releases, svc.slug, hosts)];
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
    /** 供 gateway：两个物理槽当前的角色，用于把 Host 路由到对应 Service。 */
    slotRoles: async (serviceId: ServiceId): Promise<{ prod: PhysicalSlot; preview: PhysicalSlot } | undefined> => {
      const slots = await uow.read.slots.get(serviceId);
      return slots ? { prod: slots.active, preview: slots.active === 'blue' ? 'green' : 'blue' } : undefined;
    },
  };
}
