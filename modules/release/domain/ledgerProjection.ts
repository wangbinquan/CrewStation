import type { ProjectId, ReleaseId, ResourceConditionStatus } from '@crewstation/contracts';
import type { OfflinePolicy } from './slotLifecycle';
import { DEFAULT_OFFLINE_POLICY, canPostpone, offlineDeadline, retentionPeriodMs } from './slotLifecycle';
import type { OfflineReason, PhysicalSlot, ServiceSlots, SlotHealth, SlotRetention, SlotState, SlotWorkload } from './slots';
import { roleOf } from './slots';

/**
 * 服务槽投影到资源台账（RFC-025 第三期）：每个服务两条记录（蓝、绿两个物理槽），记录稳定、不随版本新建——
 * 同一个 Deployment 在换版本时原地更新。槽「此刻该不该有工作负载」是领域条件 Serving：下线、尚未部署为假（阶段按已结束算，
 * 原因照写，D13）；部署失败是 Failed。阶段由资源中心按 Deployment 的观测算，这里不写。
 */
export interface SlotCondition {
  readonly type: string;
  readonly status: ResourceConditionStatus;
  readonly reason?: string;
  readonly message?: string;
  readonly since?: Date;
}

export interface SlotChild { readonly kind: 'Deployment' | 'Service' | 'Secret'; readonly namespace: string; readonly name: string }

export interface ProjectedSlot {
  readonly ref: string;
  readonly projectId: ProjectId;
  readonly children: readonly SlotChild[];
  /** 资源中心建的槽（T8）：调和器建出工作负载要用的期望；旧形状（release 自己部署）没有。 */
  readonly slot?: Readonly<Record<string, unknown>>;
  readonly display: Readonly<Record<string, string>>;
  readonly conditions: readonly SlotCondition[];
}

export interface SlotService {
  readonly projectId: ProjectId;
  readonly name: string;
  readonly namespace: string;
  /** 项目标识：Pod 的项目标签（网关的 Pod 身份索引认它）。 */
  readonly slug: string;
}

/**
 * 槽记录的期望（RFC-025 T8）：同名的 Deployment 与 Service，加这一次部署的环境 Secret（`<服务>-<物理槽>-env-<第几次部署>`）；
 * slot 是调和器渲染它们要用的输入，不含配置与密钥。投影与重新部署前的集群预检用同一份。
 */
export function slotSpecOf(serviceId: string, service: Pick<SlotService, 'name' | 'namespace' | 'slug'>, physical: PhysicalSlot, workload: SlotWorkload): { readonly children: readonly SlotChild[]; readonly slot: Readonly<Record<string, unknown>> } {
  const name = `${service.name}-${physical}`, envSecret = `${name}-env-${workload.revision}`;
  return {
    children: [{ kind: 'Deployment', namespace: service.namespace, name }, { kind: 'Service', namespace: service.namespace, name }, { kind: 'Secret', namespace: service.namespace, name: envSecret }],
    slot: {
      serviceId, project: service.slug, service: service.name, physical, releaseId: workload.releaseId, revision: workload.revision, image: workload.image, command: [...workload.command],
      port: workload.port, healthPath: workload.healthPath, replicas: workload.replicas, resources: { ...workload.resources }, envSecret, ...(workload.restartedAt ? { restartedAt: workload.restartedAt } : {}),
    },
  };
}

const OFFLINE_MESSAGE: Record<OfflineReason, string> = {
  manual: '已由成员手动下线', 'rollback-expired': '回退目标保留期已满，已自动下线', idle: '待验证版本长时间无人访问，已自动下线', cluster: '已在集群管理中删除',
};

function servingOf(slot: SlotState): SlotCondition {
  if (slot.offline) return { type: 'Serving', status: 'false', reason: `offline-${slot.offline.reason}`, message: OFFLINE_MESSAGE[slot.offline.reason], since: slot.offline.at };
  if (!slot.releaseId) return { type: 'Serving', status: 'false', reason: 'not-deployed', message: '尚未部署' };
  return { type: 'Serving', status: 'true' };
}

/** 流水线判定部署失败（pollDeploy 超时、Deployment 不在）：失败条件带槽最后一次更新的时刻。 */
function failedOf(slot: SlotState): SlotCondition {
  return slot.state === 'failed' && slot.releaseId && !slot.offline ? { type: 'Failed', status: 'true', reason: 'deploy-failed', message: slot.failure ? `部署未能就绪：${slot.failure}`.slice(0, 2000) : '部署未能就绪', since: slot.updatedAt } : { type: 'Failed', status: 'false' };
}

const RETENTION_MESSAGE: Record<SlotRetention['kind'], string> = {
  'rollback-target': '回退目标：保留期满后自动下线', pending: '待验证版本：长时间无人访问后自动下线',
};

/**
 * 待命槽的保留计时（RFC-021；设计 §4.3 的条件 RetentionDeadline）：在计时的待命槽为真，原因是回退目标或待验证版本。到期时刻（按当前平台策略算）、
 * 周期、推迟次数与可推迟时的提醒时刻放进展示字段——访问推后到期、推迟、提醒、改时长都让记录变化，页面随推送流重读槽的 DTO。
 */
function retentionOf(slots: ServiceSlots, physical: PhysicalSlot, policy: OfflinePolicy): { readonly condition: SlotCondition; readonly display: Record<string, string> } {
  const retention = slots[physical].retention;
  if (!retention || roleOf(slots, physical) !== 'preview') return { condition: { type: 'RetentionDeadline', status: 'false' }, display: {} };
  const reminded = canPostpone(retention, policy) ? retention.remindedAt : undefined;
  return {
    condition: { type: 'RetentionDeadline', status: 'true', reason: retention.kind, message: RETENTION_MESSAGE[retention.kind] },
    display: {
      retentionDeadline: offlineDeadline(retention, policy).toISOString(), retentionPeriodHours: String(retentionPeriodMs(retention.kind, policy) / 3_600_000),
      retentionPostponements: String(retention.postponements), ...(reminded ? { retentionRemindedAt: reminded.toISOString() } : {}),
    },
  };
}

export function projectSlot(slots: ServiceSlots, physical: PhysicalSlot, service: SlotService, tagOf: (releaseId: ReleaseId) => string | undefined, policy: OfflinePolicy = DEFAULT_OFFLINE_POLICY): ProjectedSlot {
  const slot = slots[physical], releaseId = slot.releaseId ?? slot.offline?.releaseId, tag = releaseId ? tagOf(releaseId) : undefined;
  const retention = retentionOf(slots, physical, policy);
  // 槽的工作负载与它的 Service 同名（slotDeployer）；Service 是槽对外的稳定入口，下线时保留（RFC-021）。资源中心建的槽另有环境 Secret 与渲染输入。
  const shape = slot.workload ? slotSpecOf(slots.serviceId, service, physical, slot.workload)
    : { children: [{ kind: 'Deployment' as const, namespace: service.namespace, name: `${service.name}-${physical}` }, { kind: 'Service' as const, namespace: service.namespace, name: `${service.name}-${physical}` }] };
  return {
    ref: `${slots.serviceId}/${physical}`, projectId: service.projectId, ...shape,
    display: { physical, role: roleOf(slots, physical), ...(releaseId ? { releaseId } : {}), ...(tag ? { tag } : {}), ...retention.display },
    conditions: [servingOf(slot), failedOf(slot), retention.condition],
  };
}

/** 一个服务的两条槽记录：线上（active）在前。 */
export function projectSlots(slots: ServiceSlots, service: SlotService, tagOf: (releaseId: ReleaseId) => string | undefined, policy: OfflinePolicy = DEFAULT_OFFLINE_POLICY): ProjectedSlot[] {
  const order: PhysicalSlot[] = slots.active === 'blue' ? ['blue', 'green'] : ['green', 'blue'];
  return order.map((physical) => projectSlot(slots, physical, service, tagOf, policy));
}

/**
 * 槽的旧接口状态由台账推导（设计 §11.2）：部署流水线在推进时（deploying）、槽为空或流水线已判失败时，以流水线为准——
 * 期望刚变、观测还没跟上的那一瞬台账会沿用旧版本的观测；流水线判定就绪之后，以观测为准：副本后来没全就绪是降级，
 * 被重新铺开（运维重启）是部署中，失败是失败。
 */
export function slotStateFromLedger(state: SlotHealth, phase: string | undefined): SlotHealth {
  if (state !== 'ready' || !phase) return state;
  if (phase === 'degraded' || phase === 'failed') return phase;
  return phase === 'pending' || phase === 'provisioning' || phase === 'starting' ? 'deploying' : state;
}

/** 台账记录里副本数所在的部分：Deployment 子对象的观测。 */
export interface ObservedSlotChildren {
  readonly children?: readonly { readonly kind: string; readonly phase: string; readonly replicas?: number; readonly readyReplicas?: number; readonly appliedGeneration?: number }[];
}

/** 台账里一条槽记录，按记录判断铺开用得到的部分。 */
export interface ObservedSlotRecord extends ObservedSlotChildren {
  readonly generation: number;
  readonly phase: string;
  readonly reason?: { readonly code: string; readonly message: string };
}

export interface SlotRollout {
  readonly state: 'deploying' | 'ready' | 'failed';
  readonly replicas: number;
  readonly readyReplicas: number;
  readonly message?: string;
}

/**
 * 资源中心建的槽铺到了哪一步（RFC-025 T8，替代直接读 Deployment）：观测到的 Deployment 是渲染最新期望（记录的 generation）的那一个，
 * 才看阶段——期望刚改、还没应用时旧版本的「都就绪」不算数。运行中是就绪；推进超时是失败；其余（启动中、崩溃重启、副本没全就绪）还在部署，
 * 由流水线的部署时限兜底。没有记录（台账还没跟上）也算还在部署。
 */
export function slotRolloutOf(record: ObservedSlotRecord | undefined): SlotRollout {
  const deployment = record?.children?.find((child) => child.kind === 'Deployment' && child.phase !== 'absent');
  const counts = { replicas: deployment?.replicas ?? 0, readyReplicas: deployment?.readyReplicas ?? 0 };
  if (!record || !deployment || deployment.appliedGeneration !== record.generation) return { state: 'deploying', ...counts };
  if (record.phase === 'ready') return { state: 'ready', ...counts };
  if (record.phase === 'degraded' && record.reason?.code === 'rollout-stalled') return { state: 'failed', ...counts, message: record.reason.message };
  return { state: 'deploying', ...counts, ...(record.reason ? { message: record.reason.message } : {}) };
}

/** 同一规则下的副本数：流水线判定就绪之后照 Deployment 的观测（副本后来崩溃、被缩容，槽卡照实写）；此前以流水线为准。 */
export function slotCountsFromLedger(state: SlotHealth, record: ObservedSlotChildren | undefined): { readonly replicas: number; readonly readyReplicas: number } | undefined {
  if (state !== 'ready') return undefined;
  const deployment = record?.children?.find((child) => child.kind === 'Deployment' && child.phase !== 'absent');
  return deployment?.replicas !== undefined && deployment.readyReplicas !== undefined ? { replicas: deployment.replicas, readyReplicas: deployment.readyReplicas } : undefined;
}
