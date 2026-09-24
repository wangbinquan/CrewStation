import type { Actor, ExitMaintenanceRequest, MaintenanceDto, MaintenanceEventDto, ServiceId, ServiceMaintenanceView, SetMaintenanceRequest, UserId, WorkloadIdentity } from '@crewstation/contracts';
import { DomainTopic } from '@crewstation/contracts';
import { conflict, newId, notFound, validation } from '@crewstation/kernel';
import type { EntryVerdict } from '../api/moduleApi';
import type { Maintenance } from '../domain/maintenance';
import { applyMaintenance, assertExitRevision, blocksServiceCall, fullWindow, holdsEvents, retryAfterSeconds } from '../domain/maintenance';
import type { DirectoryService } from '../ports/directories';
import type { MaintenanceEventRecord } from '../ports/repositories';
import type { GatewayUseCaseDeps } from './dependencies';

/** 放行判定每个请求都用：进程内缓存「当前所有维护中的服务」3 秒，改动后最多 3 秒生效（design §5）。 */
const ACTIVE_CACHE_MS = 3_000;
const DIRECTORY_CACHE_MS = 30_000;

/** 服务域调用被维护拦下：给 503 的说明与 `Retry-After`。 */
export interface ServiceBlock { readonly message: string; readonly retryAfterSeconds?: number }

interface ActiveEntry { readonly maintenance: Maintenance; readonly service: DirectoryService; readonly proxyName?: string }

function eventToDto(e: MaintenanceEventRecord): MaintenanceEventDto {
  return { id: e.id, serviceId: e.serviceId, kind: e.kind, actorUserId: e.actorUserId, at: e.at.toISOString(), switches: e.switches, reason: e.reason, ...(e.expectedEndAt ? { expectedEndAt: e.expectedEndAt.toISOString() } : {}), allowUserIds: [...e.allowUserIds] };
}

function snapshotOf(m: Maintenance): Pick<MaintenanceEventRecord, 'switches' | 'reason' | 'expectedEndAt' | 'allowUserIds'> {
  return { switches: m.switches, reason: m.reason, ...(m.expectedEndAt ? { expectedEndAt: m.expectedEndAt } : {}), allowUserIds: m.allowUserIds };
}

/** 进程内缓存：维护中的服务、slug 到服务的目录。 */
function maintenanceCache(deps: GatewayUseCaseDeps) {
  let active: { at: number; entries: ActiveEntry[] } | undefined;
  let directory: { at: number; bySlug: Map<string, DirectoryService> } | undefined;
  return {
    invalidate: () => { active = undefined; },
    active: async (): Promise<ActiveEntry[]> => {
      if (active && Date.now() - active.at < ACTIVE_CACHE_MS) return active.entries;
      const entries: ActiveEntry[] = [];
      for (const maintenance of await deps.maintenanceUow.read.maintenance.listActive()) {
        const service = await deps.services.getService(maintenance.serviceId);
        if (!service || service.archived) continue;
        const proxyName = await deps.grants.proxyNameOf(maintenance.serviceId);
        entries.push({ maintenance, service, ...(proxyName ? { proxyName } : {}) });
      }
      active = { at: Date.now(), entries };
      return entries;
    },
    serviceBySlug: async (slug: string): Promise<DirectoryService | undefined> => {
      // 新建的项目不在旧目录里：查不到时最多每秒刷新一次，其余时候按 30 秒缓存。
      const stale = !directory || Date.now() - directory.at > DIRECTORY_CACHE_MS || (!directory.bySlug.has(slug) && Date.now() - directory.at > 1_000);
      if (stale) directory = { at: Date.now(), bySlug: new Map((await deps.services.listServices()).map((s) => [s.projectSlug, s])) };
      return directory?.bySlug.get(slug);
    },
  };
}

type Cache = ReturnType<typeof maintenanceCache>;

/** 进入、调整、退出与读取（负责人与管理员可写，`view` 可读；M8、M9）。 */
function maintenanceCommands(deps: GatewayUseCaseDeps, cache: Cache) {
  const uow = deps.maintenanceUow;
  const resolve = async (serviceId: ServiceId): Promise<DirectoryService> => {
    const svc = await deps.services.getService(serviceId);
    if (!svc || svc.archived) throw notFound('服务', serviceId);
    return svc;
  };
  const toDto = async (m: Maintenance): Promise<MaintenanceDto> => {
    const allowUsers = (await Promise.all(m.allowUserIds.map(async (userId) => { const user = await deps.users.describe(userId); return user ? { userId, ...user } : undefined; }))).filter((u) => u !== undefined);
    return { serviceId: m.serviceId, projectId: m.projectId, switches: m.switches, allowUsers, reason: m.reason, ...(m.expectedEndAt ? { expectedEndAt: m.expectedEndAt.toISOString() } : {}), startedBy: m.startedBy, startedAt: m.startedAt.toISOString(), updatedBy: m.updatedBy, updatedAt: m.updatedAt.toISOString(), revision: m.revision };
  };
  const view = async (serviceId: ServiceId): Promise<ServiceMaintenanceView> => {
    const [current, events] = await Promise.all([uow.read.maintenance.get(serviceId), uow.read.maintenance.listEvents(serviceId, 50)]);
    return { current: current ? await toDto(current) : null, history: events.map(eventToDto) };
  };
  return {
    getMaintenance: async (actor: Actor, serviceId: ServiceId): Promise<ServiceMaintenanceView> => {
      const svc = await resolve(serviceId);
      await deps.access.authorize(actor, svc.projectId, 'view');
      return view(serviceId);
    },
    setMaintenance: async (actor: Actor, serviceId: ServiceId, input: SetMaintenanceRequest): Promise<MaintenanceDto> => {
      const svc = await resolve(serviceId);
      await deps.access.authorize(actor, svc.projectId, 'manage-maintenance');
      const missing = (await Promise.all(input.allowUserIds.map(async (id) => ((await deps.users.describe(id)) ? undefined : id)))).filter((id) => id !== undefined);
      if (missing.length > 0) throw validation(`临时指定的人不存在：${missing.join('、')}`, { missing });
      const now = deps.clock.now();
      const next = await uow.run(async (scope) => {
        const current = await scope.maintenance.get(serviceId);
        const next = applyMaintenance(current, { serviceId, projectId: svc.projectId }, { ...input, expectedEndAt: input.expectedEndAt ? new Date(input.expectedEndAt) : null }, actor.userId, now);
        if (!(await scope.maintenance.save(next, input.expectedRevision))) throw conflict('维护状态已被他人修改，请刷新后重新确认');
        await scope.maintenance.insertEvent({ id: newId('mev'), serviceId, kind: current ? 'updated' : 'entered', actorUserId: actor.userId, at: now, ...snapshotOf(next) });
        await scope.publish(DomainTopic.maintenanceChanged, { occurredAt: now.toISOString(), projectId: svc.projectId, serviceId, active: true, holdEvents: next.switches.events });
        return next;
      });
      cache.invalidate();
      deps.logger.info('maintenance set', { service: svc.identity, switches: next.switches, revision: next.revision });
      return toDto(next);
    },
    exitMaintenance: async (actor: Actor, serviceId: ServiceId, input: ExitMaintenanceRequest): Promise<ServiceMaintenanceView> => {
      const svc = await resolve(serviceId);
      await deps.access.authorize(actor, svc.projectId, 'manage-maintenance');
      const now = deps.clock.now();
      await uow.run(async (scope) => {
        const current = assertExitRevision(await scope.maintenance.get(serviceId), input.expectedRevision);
        if (!(await scope.maintenance.remove(serviceId, input.expectedRevision))) throw conflict('维护状态已被他人修改，请刷新后重新确认');
        await scope.maintenance.insertEvent({ id: newId('mev'), serviceId, kind: 'exited', actorUserId: actor.userId, at: now, ...snapshotOf(current) });
        await scope.publish(DomainTopic.maintenanceChanged, { occurredAt: now.toISOString(), projectId: svc.projectId, serviceId, active: false, holdEvents: false });
      });
      cache.invalidate();
      deps.logger.info('maintenance exited', { service: svc.identity });
      return view(serviceId);
    },
  };
}

/** 三类流量的判定点（design §6）与给其他模块的只读查询。 */
function maintenanceQueries(deps: GatewayUseCaseDeps, cache: Cache) {
  const byService = async (serviceId: ServiceId) => (await cache.active()).find((e) => e.maintenance.serviceId === serviceId)?.maintenance;
  return {
    userEntry: async (userId: UserId, projectSlug: string, slot: 'prod' | 'preview'): Promise<EntryVerdict> => {
      if (slot === 'prod') {
        const hit = (await cache.active()).find((e) => e.service.projectSlug === projectSlug);
        const m = hit?.maintenance;
        if (!hit || !m?.switches.users || m.allowUserIds.includes(userId) || await deps.access.isMemberOrAdmin(userId, hit.service.projectId)) return { kind: 'open' };
        const retry = retryAfterSeconds(m, deps.clock.now());
        return { kind: 'maintenance', projectSlug, reason: m.reason, ...(m.expectedEndAt ? { expectedEndAt: m.expectedEndAt.toISOString() } : {}), ...(retry ? { retryAfterSeconds: retry } : {}) };
      }
      // 待命槽上没有版本不在这里判：槽「已结束」时路由改指说明页（RFC-025 D13、I26 裁定）。访问照记，自动下线的空闲计时靠它（没有工作负载时 release 不记）。
      const svc = await cache.serviceBySlug(projectSlug);
      if (svc) void deps.slots.notePreviewAccess(svc.serviceId).catch((error: unknown) => deps.logger.warn('preview access note failed', { service: svc.identity, error: String(error) }));
      return { kind: 'open' };
    },
    /** 服务域：目标（`service:<名>` 或 `proxy:<名>`）维护中且开关打开、调用方不是它自己（M25）时拦下。 */
    serviceCallBlock: async (caller: WorkloadIdentity, targetIdentity: string): Promise<ServiceBlock | undefined> => {
      const hit = (await cache.active()).find((e) => targetIdentity === `service:${e.service.serviceName}` || (e.proxyName !== undefined && targetIdentity === `proxy:${e.proxyName}`));
      if (!hit || !blocksServiceCall(hit.maintenance, caller.identity, hit.service.identity)) return undefined;
      const retry = retryAfterSeconds(hit.maintenance, deps.clock.now());
      return { message: `${hit.service.projectSlug} 的正式版本维护中：${hit.maintenance.reason}`, ...(retry ? { retryAfterSeconds: retry } : {}) };
    },
    /** 事件开关直接读库：退出维护的事件一到，补发就不会被 3 秒缓存挡回去。 */
    holdsEvents: async (serviceId: ServiceId): Promise<boolean> => holdsEvents(await deps.maintenanceUow.read.maintenance.get(serviceId)),
    /** 破坏性迁移的维护窗口：直接读库，不走缓存（design §7）。 */
    maintenanceWindowOpen: async (serviceId: ServiceId): Promise<boolean> => fullWindow(await deps.maintenanceUow.read.maintenance.get(serviceId)),
    /** 供市场卡片：维护中的原因、预计恢复时间与临时指定的人（缓存）。 */
    maintenanceOf: async (serviceId: ServiceId): Promise<Maintenance | undefined> => byService(serviceId),
  };
}

export function maintenanceUseCases(deps: GatewayUseCaseDeps) {
  const cache = maintenanceCache(deps);
  return { ...maintenanceCommands(deps, cache), ...maintenanceQueries(deps, cache) };
}
