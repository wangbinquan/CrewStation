import type { ReleaseId, ServiceId, SlotName, UserId } from '@crewstation/contracts';
import { precheckFailed, precheckReason } from './precheck';

/** 蓝绿两个物理槽；prod／preview 只是角色（G15）：active 指向的物理槽承接 prod 域，另一个是待命槽承接 preview 域。 */
export type PhysicalSlot = 'blue' | 'green';
export type SlotHealth = 'empty' | 'deploying' | 'ready' | 'degraded' | 'failed';
/** 待命槽下线的原因（RFC-021）：手动、回退目标保留期满、待验证版本无人访问、集群管理删除。 */
export type OfflineReason = 'manual' | 'rollback-expired' | 'idle' | 'cluster';

/**
 * 待命槽的自动下线计时（RFC-021 design §3），只在有工作负载的待命槽上：
 * 回退目标从切流时起算、访问不延长；待验证版本每次访问 preview 重新计时；推迟给出绝对下限；
 * `remindedFor` 记提醒针对的到期时间，到期时间一变提醒就失效。
 */
export interface SlotRetention {
  readonly kind: 'rollback-target' | 'pending';
  readonly since: Date;
  readonly lastAccessAt?: Date;
  readonly postponedUntil?: Date;
  readonly postponements: number;
  readonly remindedAt?: Date;
  readonly remindedFor?: Date;
}

/** 待命槽已下线（RFC-021 design §2）；`workloadRemoved` 为 false 时由巡检重试删除工作负载。 */
export interface SlotOffline {
  readonly releaseId: ReleaseId;
  readonly at: Date;
  readonly reason: OfflineReason;
  readonly actorUserId?: UserId;
  readonly workloadRemoved: boolean;
}

/**
 * 由资源中心建出的槽（RFC-025 T8）：建出工作负载要用的期望，随槽状态保存、投影进槽记录，不含配置与密钥——环境在调和器建 Secret 时向
 * release 要。revision 是这个物理槽的第几次部署（环境 Secret 名的后缀，每次部署、重新部署加一）；replicas 已含运维覆盖；
 * restartedAt 是运维重启的标记（C6，一变就重新铺开）。下线后留着：调和器据此删工作负载与环境，下次部署接着数 revision。
 */
export interface SlotWorkload {
  readonly releaseId: ReleaseId;
  readonly revision: number;
  readonly image: string;
  readonly command: readonly string[];
  readonly port: number;
  readonly healthPath: string;
  readonly replicas: number;
  readonly resources: { readonly cpu: string; readonly memory: string };
  readonly restartedAt?: string;
}

export interface SlotState {
  readonly physical: PhysicalSlot;
  readonly releaseId?: ReleaseId;
  readonly state: SlotHealth;
  readonly replicas: number;
  readonly readyReplicas: number;
  readonly updatedAt: Date;
  readonly retention?: SlotRetention;
  readonly offline?: SlotOffline;
  readonly workload?: SlotWorkload;
  /** 资源中心报来的这一次部署建不成的原因（T8）；流水线据此判发布失败，文案进发布记录与槽记录。 */
  readonly failure?: string;
}

/** 这一次部署的期望：接着这个物理槽上一次的 revision 数。 */
export function nextWorkload(previous: SlotState, input: Omit<SlotWorkload, 'revision'>): SlotWorkload {
  return { ...input, command: [...input.command], revision: (previous.workload?.revision ?? 0) + 1 };
}

export interface ServiceSlots {
  readonly serviceId: ServiceId;
  readonly active: PhysicalSlot;
  readonly blue: SlotState;
  readonly green: SlotState;
  readonly updatedAt: Date;
}

export function standbyOf(active: PhysicalSlot): PhysicalSlot {
  return active === 'blue' ? 'green' : 'blue';
}

export function initialSlots(serviceId: ServiceId, now: Date): ServiceSlots {
  const empty = (physical: PhysicalSlot): SlotState => ({ physical, state: 'empty', replicas: 0, readyReplicas: 0, updatedAt: now });
  return { serviceId, active: 'blue', blue: empty('blue'), green: empty('green'), updatedAt: now };
}

export function roleOf(slots: ServiceSlots, physical: PhysicalSlot): SlotName {
  return slots.active === physical ? 'prod' : 'preview';
}

export function physicalOf(slots: ServiceSlots, role: SlotName): PhysicalSlot {
  return role === 'prod' ? slots.active : standbyOf(slots.active);
}

export function withSlot(slots: ServiceSlots, state: SlotState, now: Date): ServiceSlots {
  return { ...slots, [state.physical]: state, updatedAt: now };
}

function withoutRetention(slot: SlotState): SlotState {
  const { retention: _retention, ...rest } = slot;
  return rest;
}

/** 确认当前与目标身份后检查就绪；null 是明确的空正式版本，不等于省略检查。 */
export function switchTraffic(slots: ServiceSlots, toRole: SlotName, expectedActiveRelease: ReleaseId | null | undefined, now: Date, expectedTargetRelease?: ReleaseId): ServiceSlots {
  const target = physicalOf(slots, toRole);
  if (target === slots.active) throw precheckFailed(precheckReason('already-active', `${toRole} 已经是当前线上槽`));
  const standby = slots[target];
  const current = slots[slots.active];
  if (expectedActiveRelease !== undefined && (current.releaseId ?? null) !== expectedActiveRelease) {
    throw precheckFailed(precheckReason('active-changed', '当前线上发布已变化', '请刷新后再切流'), { expected: expectedActiveRelease, actual: current.releaseId ?? null });
  }
  if (expectedTargetRelease !== undefined && standby.releaseId !== expectedTargetRelease) {
    throw precheckFailed(precheckReason('standby-changed', '待命发布已变化', '请重新确认上线目标'), { expected: expectedTargetRelease, actual: standby.releaseId ?? null });
  }
  if (standby.state !== 'ready' || !standby.releaseId) throw precheckFailed(precheckReason('standby-not-ready', '待命槽尚未就绪，不能切流', '等待验证版本部署就绪后再上线'), { state: standby.state });
  // 原正式槽成为回退目标，从切流时起计保留期（RFC-021 M2）；新正式槽不计时。
  const previous: SlotState = current.releaseId && current.state !== 'empty'
    ? { ...current, retention: { kind: 'rollback-target', since: now, postponements: 0 } }
    : withoutRetention(current);
  return { ...slots, active: target, [target]: withoutRetention(standby), [slots.active]: previous, updatedAt: now };
}
