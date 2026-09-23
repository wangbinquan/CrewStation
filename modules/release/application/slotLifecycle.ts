import type { Actor, AutoOfflinePolicyDto, OfflineReason, PostponeOfflineRequest, RedeployRequest, ReleaseDto, ReleaseId, ServiceId, SetAutoOfflinePolicyRequest, SlotDto, SlotEventDto, TakeOfflineRequest, UserId } from '@crewstation/contracts';
import { DomainTopic } from '@crewstation/contracts';
import { conflict, forbidden, newId, notFound, precondition } from '@crewstation/kernel';
import { rollbackBlockedBy } from '../domain/migrationPolicy';
import type { Release } from '../domain/release';
import { advance, isRedeployable } from '../domain/release';
import type { OfflinePolicy } from '../domain/slotLifecycle';
import {
  DEFAULT_OFFLINE_POLICY, assertOfflinePolicy, autoOfflineReason, canPostpone, hasWorkload, markReminded, markWorkloadRemoved, noteRetentionAccess,
  offlineDeadline, postponeRetention, retentionForExisting, retentionStep, takeSlotOffline,
} from '../domain/slotLifecycle';
import type { PhysicalSlot, ServiceSlots } from '../domain/slots';
import { standbyOf, withSlot } from '../domain/slots';
import type { OfflinePolicyRecord, SlotEventRecord } from '../ports/repositories';
import type { RepositoryScope } from '../ports/unitOfWork';
import type { ReleaseUseCaseDeps } from './dependencies';
import { createPipelineContext } from './pipelineContext';
import type { ResolvedService } from './pipelineContext';
import { prepareSlotDeploy } from './pipelineDeploy';
import { loadSlotDtos } from './queries';
import { releaseToDto } from './toDto';

type Deps = ReleaseUseCaseDeps & { isAdmin(userId: UserId): Promise<boolean> };

/** preview 访问最多每 5 分钟写一次库：计时以天为单位，ForwardAuth 却每个请求都会来（RFC-021 B2）。 */
const ACCESS_NOTE_INTERVAL_MS = 5 * 60_000;

export interface StandbyEntry { readonly empty: boolean; readonly offline?: { readonly at: string; readonly reason: OfflineReason; readonly tag?: string } }
export interface SweepOutcome { readonly initialized: number; readonly reminded: number; readonly offline: number; readonly repaired: number }

export async function policyOf(scope: Pick<RepositoryScope, 'offlinePolicy'>): Promise<OfflinePolicyRecord> {
  return (await scope.offlinePolicy.get()) ?? { ...DEFAULT_OFFLINE_POLICY, revision: 0 };
}

function policyToDto(policy: OfflinePolicyRecord): AutoOfflinePolicyDto {
  return { rollbackRetentionHours: policy.rollbackRetentionHours, idleOfflineDays: policy.idleOfflineDays, reminderLeadHours: policy.reminderLeadHours, revision: policy.revision, updatedAt: policy.updatedAt?.toISOString() ?? null, ...(policy.updatedBy ? { updatedBy: policy.updatedBy } : {}) };
}

function eventToDto(record: SlotEventRecord): SlotEventDto {
  return {
    id: record.id, serviceId: record.serviceId, kind: record.kind, releaseId: record.releaseId, tag: record.tag,
    ...(record.reason ? { reason: record.reason } : {}), ...(record.actorUserId ? { actorUserId: record.actorUserId } : {}),
    ...(record.deadline ? { deadline: record.deadline.toISOString() } : {}), at: record.at.toISOString(),
  };
}

/** 下线、重新部署都不能与进行中的发布或集群运维操作并行（它们会改同一个待命槽）。 */
async function assertQuiet(scope: RepositoryScope, serviceId: ServiceId): Promise<void> {
  const inProgress = await scope.releases.findInProgress(serviceId);
  if (inProgress) throw precondition(`发布 ${inProgress.tag} 仍在进行中（${inProgress.status}），请等待结束后再操作`, { releaseId: inProgress.id });
  if (await scope.maintenance.active(serviceId)) throw precondition('集群运维操作尚未结束，请等待后再操作');
}

/** 事务内下线（手动、到期、集群管理共用）：写槽、发布转已下线、写记录、发状态事件。 */
export async function offlineInScope(scope: RepositoryScope, slots: ServiceSlots, physical: PhysicalSlot, now: Date, input: { reason: OfflineReason; actorUserId?: UserId; workloadRemoved?: boolean }): Promise<Release | undefined> {
  const releaseId = slots[physical].releaseId!;
  await scope.slots.save(takeSlotOffline(slots, physical, now, input));
  const release = await scope.releases.getById(releaseId);
  if (release?.status === 'ready') await scope.releases.update(advance(release, 'offline', now));
  await scope.slotEvents.insert({ id: newId('sev'), serviceId: slots.serviceId, kind: 'offline', releaseId, tag: release?.tag ?? '', reason: input.reason, ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}), at: now });
  await scope.events.publish(DomainTopic.releaseStatusChanged, { occurredAt: now.toISOString(), serviceId: slots.serviceId, releaseId, status: 'offline', message: `待验证槽已下线（${input.reason}）` });
  return release;
}

/** 重新部署更早的版本与回退同一条规则：当前正式版本含破坏性迁移或禁止回退时拒绝（RFC-021 B4）。 */
async function assertRedeployCompatible(scope: RepositoryScope, slots: ServiceSlots, release: Release): Promise<void> {
  const currentId = slots[slots.active].releaseId;
  const current = currentId ? await scope.releases.getById(currentId) : undefined;
  if (current?.manifest && release.createdAt < current.createdAt && rollbackBlockedBy(current.manifest.spec.release.migration)) {
    const restriction = current.manifest.spec.release.migration.destructive ? '含破坏性迁移' : '的发布配置明确禁止回退';
    throw precondition(`当前版本 ${current.tag} ${restriction}，不能重新部署更早的版本 ${release.tag}`);
  }
}

function onAnySlot(slots: ServiceSlots | undefined, releaseId: ReleaseId): boolean {
  return !!slots && (slots.blue.releaseId === releaseId || slots.green.releaseId === releaseId);
}

interface LifecycleTools {
  svcOf(serviceId: ServiceId): Promise<ResolvedService>;
  slotDtos(serviceId: ServiceId, svc: ResolvedService): Promise<SlotDto[]>;
  removeWorkload(serviceId: ServiceId, svc: ResolvedService, physical: PhysicalSlot, releaseId: ReleaseId): Promise<boolean>;
}

function lifecycleTools(deps: Deps): LifecycleTools {
  const { uow, services, clock, logger } = deps;
  const svcOf = async (serviceId: ServiceId): Promise<ResolvedService> => {
    const svc = await services.resolveServiceById(serviceId);
    if (!svc) throw notFound('服务', serviceId);
    return svc;
  };
  return {
    svcOf,
    slotDtos: async (serviceId, svc) => {
      const slots = await uow.read.slots.get(serviceId);
      return slots ? loadSlotDtos(uow.read, slots, svc.slug, deps.hosts) : [];
    },
    /**
     * 提交之后删工作负载；失败不回滚，巡检按 `workloadRemoved` 重试（design §2）。
     * RFC-013 之前部署的 Deployment 标签上是旧 `rel_…` ID，只认 UUID 会把它当成别的版本而留着不删（2026-09-23 实机：本机 8 个待命槽全是这样）。
     */
    removeWorkload: async (serviceId, svc, physical, releaseId) => {
      try {
        const legacy = (await uow.read.releases.getById(releaseId))?.legacyResourceId;
        if (!(await deps.deployer.removeWorkload(svc.namespace, svc.name, physical, legacy ? [releaseId, legacy] : [releaseId]))) return false;
        await uow.run(async (scope) => {
          const slots = await scope.slots.get(serviceId);
          if (slots?.[physical].offline?.releaseId === releaseId) await scope.slots.save(withSlot(slots, markWorkloadRemoved(slots[physical]), clock.now()));
        });
        return true;
      } catch (error) {
        logger.warn('slot workload removal failed; the sweep will retry', { serviceId, physical, releaseId, error: error instanceof Error ? error.message : String(error) });
        return false;
      }
    },
  };
}

/** 负责人与管理员的两个待命槽动作：下线、推迟（M8、M9、M19）。 */
function offlineUseCases(deps: Deps, tools: LifecycleTools) {
  const { uow, authorizer, clock } = deps;
  return {
    takeOffline: async (actor: Actor, serviceId: ServiceId, input: TakeOfflineRequest): Promise<SlotDto[]> => {
      const svc = await tools.svcOf(serviceId);
      await authorizer.authorize(actor, svc.projectId, 'manage-slots');
      const now = clock.now();
      const { physical, releaseId } = await uow.run(async (scope) => {
        const slots = await scope.slots.get(serviceId);
        if (!slots) throw precondition('服务尚无任何部署');
        const physical = standbyOf(slots.active), slot = slots[physical];
        if (!hasWorkload(slot)) throw precondition('待验证槽上没有运行中的版本');
        if (slot.releaseId !== input.expectedReleaseId) throw precondition('待验证版本已变化，请刷新后重新确认', { expected: input.expectedReleaseId, actual: slot.releaseId });
        await assertQuiet(scope, serviceId);
        await offlineInScope(scope, slots, physical, now, { reason: 'manual', actorUserId: actor.userId });
        return { physical, releaseId: slot.releaseId };
      });
      await tools.removeWorkload(serviceId, svc, physical, releaseId);
      return tools.slotDtos(serviceId, svc);
    },
    postponeOffline: async (actor: Actor, serviceId: ServiceId, input: PostponeOfflineRequest): Promise<SlotDto[]> => {
      const svc = await tools.svcOf(serviceId);
      await authorizer.authorize(actor, svc.projectId, 'manage-slots');
      const now = clock.now();
      await uow.run(async (scope) => {
        const slots = await scope.slots.get(serviceId);
        const slot = slots ? slots[standbyOf(slots.active)] : undefined;
        if (!slots || !slot || !hasWorkload(slot) || !slot.retention) throw precondition('待验证槽上没有正在计时的版本');
        const policy = await policyOf(scope);
        const current = offlineDeadline(slot.retention, policy);
        if (current.getTime() !== new Date(input.expectedDeadline).getTime()) throw precondition('到期时间已变化，请刷新后重新确认', { expected: input.expectedDeadline, actual: current.toISOString() });
        // 提醒之后才能推迟（2026-09-23 裁定）：推迟一次要等下一次提醒，连点不会一次次往后加。
        if (!canPostpone(slot.retention, policy)) throw precondition(`还没到可以推迟的时候：到期前 ${policy.reminderLeadHours} 小时提醒负责人之后才能推迟`, { deadline: current.toISOString() });
        const retention = postponeRetention(slot.retention, policy);
        await scope.slots.save(withSlot(slots, { ...slot, retention }, now));
        const release = await scope.releases.getById(slot.releaseId!);
        await scope.slotEvents.insert({ id: newId('sev'), serviceId, kind: 'postpone', releaseId: slot.releaseId!, tag: release?.tag ?? '', actorUserId: actor.userId, deadline: offlineDeadline(retention, policy), at: now });
      });
      return tools.slotDtos(serviceId, svc);
    },
  };
}

/** 只读与记录：时间线里的槽记录、preview 访问记录、preview 入口判定用的待命槽状态。 */
function entryUseCases(deps: Deps, tools: LifecycleTools) {
  const { uow, authorizer, clock } = deps;
  const lastNoted = new Map<string, number>();
  return {
    listSlotEvents: async (actor: Actor, serviceId: ServiceId): Promise<SlotEventDto[]> => {
      const svc = await tools.svcOf(serviceId);
      await authorizer.authorize(actor, svc.projectId, 'view');
      return (await uow.read.slotEvents.listByService(serviceId, 50)).map(eventToDto);
    },
    /** 由 gateway 在放行 preview 请求后调用：记录待验证版本最近一次被访问（M2）。 */
    notePreviewAccess: async (serviceId: ServiceId): Promise<void> => {
      const now = clock.now(), last = lastNoted.get(serviceId);
      if (last !== undefined && now.getTime() - last < ACCESS_NOTE_INTERVAL_MS) return;
      lastNoted.set(serviceId, now.getTime());
      await uow.run(async (scope) => {
        const slots = await scope.slots.get(serviceId);
        const slot = slots ? slots[standbyOf(slots.active)] : undefined;
        if (!slots || !slot?.retention || !hasWorkload(slot)) return;
        const retention = noteRetentionAccess(slot.retention, now);
        if (retention !== slot.retention) await scope.slots.save(withSlot(slots, { ...slot, retention }, now));
      });
    },
    /** 由 gateway 给 preview 入口判定：待命槽上有没有工作负载；没有时带上何时因何下线（B6）。 */
    standbyEntry: async (serviceId: ServiceId): Promise<StandbyEntry> => {
      const slots = await uow.read.slots.get(serviceId);
      const slot = slots ? slots[standbyOf(slots.active)] : undefined;
      if (slot && hasWorkload(slot)) return { empty: false };
      const offline = slot?.offline;
      if (!offline) return { empty: true };
      const tag = (await uow.read.releases.getById(offline.releaseId))?.tag;
      return { empty: true, offline: { at: offline.at.toISOString(), reason: offline.reason, ...(tag ? { tag } : {}) } };
    },
  };
}

/** 平台设置：自动下线的三个时长，只有平台管理员能读写（M11、M28）。 */
function policyUseCases(deps: Deps) {
  const { uow, clock } = deps;
  const requireAdmin = async (actor: Actor): Promise<void> => {
    if (!actor.isAdmin || !(await deps.isAdmin(actor.userId))) throw forbidden('只有平台管理员可以修改平台设置');
  };
  return {
    getAutoOfflinePolicy: async (actor: Actor): Promise<AutoOfflinePolicyDto> => {
      await requireAdmin(actor);
      return policyToDto(await policyOf(uow.read));
    },
    setAutoOfflinePolicy: async (actor: Actor, input: SetAutoOfflinePolicyRequest): Promise<AutoOfflinePolicyDto> => {
      await requireAdmin(actor);
      const next: OfflinePolicy = { rollbackRetentionHours: input.rollbackRetentionHours, idleOfflineDays: input.idleOfflineDays, reminderLeadHours: input.reminderLeadHours };
      assertOfflinePolicy(next);
      const current = await policyOf(uow.read);
      if (current.revision !== input.expectedRevision) throw conflict('自动下线设置已被他人修改，请刷新后重试', { expected: input.expectedRevision, actual: current.revision });
      const record = { ...next, revision: current.revision + 1, updatedBy: actor.userId, updatedAt: clock.now() };
      if (!(await uow.read.offlinePolicy.save(record, input.expectedRevision))) throw conflict('自动下线设置已被他人修改，请刷新后重试');
      return policyToDto(record);
    },
  };
}

export function slotLifecycleUseCases(deps: Deps) {
  const tools = lifecycleTools(deps);
  return {
    ...offlineUseCases(deps, tools),
    redeploy: redeployUseCase(deps, createPipelineContext(deps), tools.svcOf),
    ...entryUseCases(deps, tools),
    ...policyUseCases(deps),
    sweepSlotLifecycle: sweepUseCase(deps, tools.removeWorkload),
  };
}

/** 从发布记录重新部署到待命槽（design §4）：不构建、不迁移；预检在写库之前，失败不改任何东西。 */
function redeployUseCase(deps: Deps, ctx: ReturnType<typeof createPipelineContext>, svcOf: (serviceId: ServiceId) => Promise<ResolvedService>) {
  const { uow, authorizer, clock } = deps;
  return async (actor: Actor, releaseId: ReleaseId, input: RedeployRequest): Promise<ReleaseDto> => {
    const release = await uow.read.releases.getById(releaseId);
    if (!release) throw notFound('发布', releaseId);
    const svc = await svcOf(release.serviceId);
    await authorizer.authorize(actor, release.projectId, 'manage-slots');
    const seen = await uow.read.slots.get(release.serviceId);
    if (!seen) throw precondition('服务尚无任何部署');
    if (seen[seen.active].releaseId === release.id) throw precondition(`${release.tag} 就是当前正式版本`);
    if (!isRedeployable(release, onAnySlot(seen, release.id))) throw precondition(`${release.tag} 不能重新部署：只有就绪过、现在不在任何槽上的版本可以从发布记录重新部署`, { status: release.status });
    const physical = standbyOf(seen.active);
    await assertRedeployCompatible(uow.read, seen, release);
    const prepared = await prepareSlotDeploy(deps, release, svc, release.manifest!, physical);
    if ('problem' in prepared) throw precondition(prepared.problem);
    const now = clock.now();
    const { started, slots } = await uow.run(async (scope) => {
      const slots = await scope.slots.get(release.serviceId);
      if (!slots || slots.active !== seen.active) throw precondition('正式版本刚刚切换过，请刷新后重新确认');
      if ((slots[physical].releaseId ?? null) !== input.expectedStandbyReleaseId) throw precondition('待验证槽已变化，请刷新后重新确认', { expected: input.expectedStandbyReleaseId, actual: slots[physical].releaseId ?? null });
      await assertQuiet(scope, release.serviceId);
      const fresh = await scope.releases.getById(release.id);
      if (!fresh || !isRedeployable(fresh, onAnySlot(slots, fresh.id))) throw precondition('发布记录已变化，请刷新后重试');
      const previous = slots[physical].releaseId;
      const old = previous ? await scope.releases.getById(previous) : undefined;
      if (old?.status === 'ready') await scope.releases.update(advance(old, 'superseded', now));
      const started = advance(fresh, 'deploying', now, { targetSlot: physical, configVersion: prepared.env.configVersion, pipeline: { ...fresh.pipeline, step: fresh.pipeline.step + 1, deployStartedAt: now.toISOString() } });
      await scope.releases.update(started);
      const next = withSlot(slots, { physical, releaseId: fresh.id, state: 'deploying', replicas: prepared.replicas, readyReplicas: 0, updatedAt: now }, now);
      await scope.slots.save(next);
      await scope.slotEvents.insert({ id: newId('sev'), serviceId: release.serviceId, kind: 'redeploy', releaseId: fresh.id, tag: fresh.tag, actorUserId: actor.userId, at: now });
      await scope.events.publish(DomainTopic.releaseStatusChanged, { occurredAt: now.toISOString(), serviceId: release.serviceId, releaseId: fresh.id, status: 'deploying', message: '从发布记录重新部署到待验证槽' });
      return { started, slots: next };
    });
    try {
      await deps.deployer.deploy({ namespace: svc.namespace, projectSlug: svc.slug, serviceName: svc.name, physical, releaseId: started.id, image: started.image ?? '', manifest: started.manifest!, replicas: prepared.replicas, env: prepared.env.values, plan: prepared.plan });
    } catch (error) {
      await ctx.fail(started, `重新部署失败：${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
    await deps.jobs.enqueuePipelineStep(started.id, started.pipeline.step, 5);
    return releaseToDto(started, slots);
  };
}

/**
 * 自动下线巡检（design §3），cs-controller 每 60 秒一次：补删工作负载、给升级前的槽补计时、提醒、到期下线。
 * 每一步都在自己的事务里重新锁行并核对版本没变，多个副本同时跑也只生效一次。
 */
function sweepUseCase(deps: Deps, removeWorkload: (serviceId: ServiceId, svc: ResolvedService, physical: PhysicalSlot, releaseId: ReleaseId) => Promise<boolean>) {
  const { uow, clock, logger } = deps;
  type Step = { kind: 'none' | 'initialized' } | { kind: 'reminded'; tag: string; deadline: Date; retentionKind: 'rollback-target' | 'pending' } | { kind: 'offline'; releaseId: ReleaseId };
  const stepService = async (serviceId: ServiceId, physical: PhysicalSlot, releaseId: ReleaseId, policy: OfflinePolicy, now: Date): Promise<Step> => uow.run(async (scope) => {
    const slots = await scope.slots.get(serviceId);
    const slot = slots?.[physical];
    if (!slots || !slot || slots.active === physical || slot.releaseId !== releaseId || !hasWorkload(slot)) return { kind: 'none' };
    if (await scope.releases.findInProgress(serviceId) || await scope.maintenance.active(serviceId)) return { kind: 'none' };
    if (!slot.retention) {
      // 升级前就在跑的待命槽从这一刻起算（M26）；这一轮只补计时，不提醒也不下线。
      const lastSwitch = (await scope.switches.listByService(serviceId, 1))[0];
      await scope.slots.save(withSlot(slots, { ...slot, retention: retentionForExisting(slot, lastSwitch?.previousReleaseId, now) }, now));
      return { kind: 'initialized' };
    }
    const step = retentionStep(slot.retention, policy, now);
    if (step.action === 'offline') {
      await offlineInScope(scope, slots, physical, now, { reason: autoOfflineReason(slot.retention.kind) });
      return { kind: 'offline', releaseId };
    }
    if (step.action !== 'remind') return { kind: 'none' };
    await scope.slots.save(withSlot(slots, { ...slot, retention: markReminded(slot.retention, step.deadline, now) }, now));
    const tag = (await scope.releases.getById(releaseId))?.tag ?? '';
    await scope.slotEvents.insert({ id: newId('sev'), serviceId, kind: 'reminder', releaseId, tag, deadline: step.deadline, at: now });
    return { kind: 'reminded', tag, deadline: step.deadline, retentionKind: slot.retention.kind };
  });
  const notify = async (projectId: ResolvedService['projectId'], step: Extract<Step, { kind: 'reminded' }>): Promise<void> => {
    const owner = await deps.owners.ownerOf(projectId);
    const why = step.retentionKind === 'rollback-target' ? '切流后的回退保留期' : '无人访问的期限';
    const message = `待验证版本 ${step.tag} 将于 ${step.deadline.toISOString()} 因${why}到期自动下线；需要保留请在发布页推迟。`;
    await deps.notifier.notify(projectId, owner ? [owner] : [], message).catch((error: unknown) => logger.warn('slot offline reminder failed', { projectId, error: String(error) }));
  };
  return async (): Promise<SweepOutcome> => {
    const now = clock.now(), policy = await policyOf(uow.read);
    const outcome = { initialized: 0, reminded: 0, offline: 0, repaired: 0 };
    for (const slots of await uow.read.slots.list()) {
      const physical = standbyOf(slots.active), slot = slots[physical];
      try {
        const svc = await deps.services.resolveServiceById(slots.serviceId);
        if (!svc) continue;
        if (slot.offline && !slot.offline.workloadRemoved) {
          if (await removeWorkload(slots.serviceId, svc, physical, slot.offline.releaseId)) outcome.repaired += 1;
          continue;
        }
        if (!hasWorkload(slot)) continue;
        const step = await stepService(slots.serviceId, physical, slot.releaseId!, policy, now);
        if (step.kind === 'initialized') outcome.initialized += 1;
        if (step.kind === 'reminded') { outcome.reminded += 1; await notify(svc.projectId, step); }
        if (step.kind === 'offline') { outcome.offline += 1; await removeWorkload(slots.serviceId, svc, physical, step.releaseId); }
      } catch (error) {
        logger.warn('slot lifecycle sweep failed for service', { serviceId: slots.serviceId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (outcome.initialized + outcome.reminded + outcome.offline + outcome.repaired > 0) logger.info('slot lifecycle sweep', outcome);
    return outcome;
  };
}
