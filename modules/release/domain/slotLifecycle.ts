import type { ReleaseId, UserId } from '@crewstation/contracts';
import { precondition, validation } from '@crewstation/kernel';
import type { OfflineReason, PhysicalSlot, ServiceSlots, SlotRetention, SlotState } from './slots';
import { withSlot } from './slots';

/** 平台统一的自动下线时长（RFC-021 M11、M12、M22）。 */
export interface OfflinePolicy {
  readonly rollbackRetentionHours: number;
  readonly idleOfflineDays: number;
  readonly reminderLeadHours: number;
}

export const DEFAULT_OFFLINE_POLICY: OfflinePolicy = { rollbackRetentionHours: 72, idleOfflineDays: 14, reminderLeadHours: 24 };

const HOUR_MS = 3_600_000;

/** 提醒必须早于两个周期，否则「先提醒、后下线」无从成立。契约的 superRefine 挡在入口，这里是领域自身的底线。 */
export function assertOfflinePolicy(policy: OfflinePolicy): void {
  const whole = (n: number) => Number.isInteger(n) && n >= 1;
  if (![policy.rollbackRetentionHours, policy.idleOfflineDays, policy.reminderLeadHours].every(whole)) throw validation('自动下线的时长必须是正整数');
  if (policy.reminderLeadHours >= policy.rollbackRetentionHours) throw validation('提前提醒的时间必须短于回退目标保留期');
  if (policy.reminderLeadHours >= policy.idleOfflineDays * 24) throw validation('提前提醒的时间必须短于无人访问期限');
}

/** 一个周期：回退目标是保留期，待验证版本是无人访问期限。 */
export function retentionPeriodMs(kind: SlotRetention['kind'], policy: OfflinePolicy): number {
  return kind === 'rollback-target' ? policy.rollbackRetentionHours * HOUR_MS : policy.idleOfflineDays * 24 * HOUR_MS;
}

/**
 * 按当前策略即时算到期时间，因此管理员改了时长立刻作用于所有项目（design §3）：
 * 回退目标从切流起算、访问不延长；待验证版本以就绪与最近一次访问中较晚的为起点；推迟给出绝对下限。
 */
export function offlineDeadline(retention: SlotRetention, policy: OfflinePolicy): Date {
  const period = retentionPeriodMs(retention.kind, policy);
  const candidates = [retention.since.getTime() + period];
  if (retention.kind === 'pending' && retention.lastAccessAt) candidates.push(retention.lastAccessAt.getTime() + period);
  if (retention.postponedUntil) candidates.push(retention.postponedUntil.getTime());
  return new Date(Math.max(...candidates));
}

export type RetentionStep = { readonly action: 'none' | 'remind' | 'offline'; readonly deadline: Date };

/**
 * 巡检的一步（B3）：下线前必须已为**当前**到期时间发过提醒，并且提醒至少提前 `reminderLeadHours`。
 * 于是调短时长、访问推后到期时间，都不会不经提醒就下线；提醒针对的到期时间一变，就重新提醒。
 */
export function retentionStep(retention: SlotRetention, policy: OfflinePolicy, now: Date): RetentionStep {
  const deadline = offlineDeadline(retention, policy), lead = policy.reminderLeadHours * HOUR_MS, at = now.getTime();
  const remindedAt = retention.remindedFor?.getTime() === deadline.getTime() ? retention.remindedAt : undefined;
  if (remindedAt && at >= Math.max(deadline.getTime(), remindedAt.getTime() + lead)) return { action: 'offline', deadline };
  if (!remindedAt && at >= deadline.getTime() - lead) return { action: 'remind', deadline };
  return { action: 'none', deadline };
}

export function markReminded(retention: SlotRetention, deadline: Date, now: Date): SlotRetention {
  return { ...retention, remindedAt: now, remindedFor: deadline };
}

/**
 * 能不能推迟（2026-09-23 裁定）：为**当前**到期时间发过提醒之后才能推迟，即到期前 `reminderLeadHours` 起。
 * 推迟清掉提醒、到期后移，于是要等下一次提醒才能再推迟，不会连点累加；访问或改时长让到期时间变了，旧提醒也不再算数。
 */
export function canPostpone(retention: SlotRetention, policy: OfflinePolicy): boolean {
  return retention.remindedAt !== undefined && retention.remindedFor?.getTime() === offlineDeadline(retention, policy).getTime();
}

/** 推迟一个周期（M19、M23）：当前到期时间再加一个周期，次数不限；清掉提醒，新到期前重新提醒。 */
export function postponeRetention(retention: SlotRetention, policy: OfflinePolicy): SlotRetention {
  const postponedUntil = new Date(offlineDeadline(retention, policy).getTime() + retentionPeriodMs(retention.kind, policy));
  const { remindedAt: _remindedAt, remindedFor: _remindedFor, ...rest } = retention;
  return { ...rest, postponedUntil, postponements: retention.postponements + 1 };
}

/** 记一次 preview 访问：只往后记；回退目标也记，但不参与计时。 */
export function noteRetentionAccess(retention: SlotRetention, at: Date): SlotRetention {
  return retention.lastAccessAt && retention.lastAccessAt.getTime() >= at.getTime() ? retention : { ...retention, lastAccessAt: at };
}

export function startRetention(kind: SlotRetention['kind'], now: Date): SlotRetention {
  return { kind, since: now, postponements: 0 };
}

export function autoOfflineReason(kind: SlotRetention['kind']): OfflineReason {
  return kind === 'rollback-target' ? 'rollback-expired' : 'idle';
}

/**
 * 升级前就在跑、还没有计时的待命槽（M26）：从本次巡检时刻起算。
 * 最近一次切流从这个版本切走的，是回退目标；否则是待验证版本。
 */
export function retentionForExisting(slot: SlotState, lastSwitchedFrom: ReleaseId | undefined, now: Date): SlotRetention {
  return startRetention(slot.releaseId !== undefined && slot.releaseId === lastSwitchedFrom ? 'rollback-target' : 'pending', now);
}

/** 待命槽上有没有要计时、能下线的工作负载。 */
export function hasWorkload(slot: SlotState): boolean {
  return slot.releaseId !== undefined && slot.state !== 'empty';
}

/**
 * 下线待命槽（design §2）：槽变空，去掉版本与计时，写下线记录；工作负载的删除在提交之后，
 * `workloadRemoved` 标记它是否已经删掉（集群管理那条路径是先删后记，所以直接为 true）。
 */
export function takeSlotOffline(slots: ServiceSlots, physical: PhysicalSlot, now: Date, input: { reason: OfflineReason; actorUserId?: UserId; workloadRemoved?: boolean }): ServiceSlots {
  if (physical === slots.active) throw precondition('正式槽正在承接流量，不能下线');
  const slot = slots[physical];
  if (!hasWorkload(slot)) throw precondition('待验证槽上没有运行中的版本');
  // 资源中心建的槽（T8）：工作负载由调和器照「不该有工作负载」删，这里不留待重试；期望留着，调和器据此知道删哪些。
  const offline = { releaseId: slot.releaseId!, at: now, reason: input.reason, ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}), workloadRemoved: input.workloadRemoved ?? slot.workload !== undefined };
  return withSlot(slots, { physical, state: 'empty', replicas: 0, readyReplicas: 0, updatedAt: now, offline, ...(slot.workload ? { workload: slot.workload } : {}) }, now);
}

export function markWorkloadRemoved(slot: SlotState): SlotState {
  return slot.offline ? { ...slot, offline: { ...slot.offline, workloadRemoved: true } } : slot;
}

/**
 * RFC-010 删除过的旧待命槽：`state: empty` 却还带着版本号。读取时归一成「已下线（集群管理）」，不需要数据迁移；
 * 正式槽不会被删除，所以只处理非正式槽。
 */
export function normalizeLegacySlot(slot: SlotState, active: boolean): SlotState {
  if (active || slot.state !== 'empty' || !slot.releaseId || slot.offline) return slot;
  const { releaseId, ...rest } = slot;
  return { ...rest, offline: { releaseId, at: slot.updatedAt, reason: 'cluster', workloadRemoved: true } };
}
