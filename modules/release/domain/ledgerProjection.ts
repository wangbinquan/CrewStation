import type { ProjectId, ReleaseId, ResourceConditionStatus } from '@crewstation/contracts';
import type { OfflineReason, PhysicalSlot, ServiceSlots, SlotHealth, SlotState } from './slots';
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

export interface ProjectedSlot {
  readonly ref: string;
  readonly projectId: ProjectId;
  readonly children: readonly { readonly kind: 'Deployment'; readonly namespace: string; readonly name: string }[];
  readonly display: Readonly<Record<string, string>>;
  readonly conditions: readonly SlotCondition[];
}

export interface SlotService {
  readonly projectId: ProjectId;
  readonly name: string;
  readonly namespace: string;
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
  return slot.state === 'failed' && slot.releaseId && !slot.offline ? { type: 'Failed', status: 'true', reason: 'deploy-failed', message: '部署未能就绪', since: slot.updatedAt } : { type: 'Failed', status: 'false' };
}

export function projectSlot(slots: ServiceSlots, physical: PhysicalSlot, service: SlotService, tagOf: (releaseId: ReleaseId) => string | undefined): ProjectedSlot {
  const slot = slots[physical], releaseId = slot.releaseId ?? slot.offline?.releaseId, tag = releaseId ? tagOf(releaseId) : undefined;
  return {
    ref: `${slots.serviceId}/${physical}`, projectId: service.projectId,
    children: [{ kind: 'Deployment', namespace: service.namespace, name: `${service.name}-${physical}` }],
    display: { physical, role: roleOf(slots, physical), ...(releaseId ? { releaseId } : {}), ...(tag ? { tag } : {}) },
    conditions: [servingOf(slot), failedOf(slot)],
  };
}

/** 一个服务的两条槽记录：线上（active）在前。 */
export function projectSlots(slots: ServiceSlots, service: SlotService, tagOf: (releaseId: ReleaseId) => string | undefined): ProjectedSlot[] {
  const order: PhysicalSlot[] = slots.active === 'blue' ? ['blue', 'green'] : ['green', 'blue'];
  return order.map((physical) => projectSlot(slots, physical, service, tagOf));
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
