import type { MaintenanceSwitches, ProjectId, ServiceId, UserId } from '@crewstation/contracts';
import { conflict } from '@crewstation/kernel';

/**
 * 正式版本维护（RFC-021 design §5）：按服务存，不按物理槽存，所以切流后维护还在（M18）。
 * 行存在就表示在维护中；三个开关互相独立，true 表示拦住。
 */
export interface Maintenance {
  readonly serviceId: ServiceId;
  readonly projectId: ProjectId;
  readonly switches: MaintenanceSwitches;
  /** 维护时临时指定放行的人（M4），退出维护时随之清空。 */
  readonly allowUserIds: readonly UserId[];
  readonly reason: string;
  readonly expectedEndAt?: Date;
  readonly startedBy: UserId;
  readonly startedAt: Date;
  readonly updatedBy: UserId;
  readonly updatedAt: Date;
  readonly revision: number;
}

export interface MaintenanceInput {
  readonly switches: MaintenanceSwitches;
  readonly allowUserIds: readonly UserId[];
  readonly reason: string;
  readonly expectedEndAt?: Date | null;
  readonly expectedRevision: number;
}

/** 进入（current 为空、expectedRevision 为 0）或调整（版本号一致）；版本号对不上时拒绝，页面刷新后再改。 */
export function applyMaintenance(current: Maintenance | undefined, owner: { serviceId: ServiceId; projectId: ProjectId }, input: MaintenanceInput, actor: UserId, now: Date): Maintenance {
  const revision = current?.revision ?? 0;
  if (input.expectedRevision !== revision) throw conflict('维护状态已被他人修改，请刷新后重新确认', { expected: input.expectedRevision, actual: revision });
  return {
    serviceId: owner.serviceId, projectId: owner.projectId, switches: input.switches, allowUserIds: [...input.allowUserIds], reason: input.reason,
    ...(input.expectedEndAt ? { expectedEndAt: input.expectedEndAt } : {}),
    startedBy: current?.startedBy ?? actor, startedAt: current?.startedAt ?? now, updatedBy: actor, updatedAt: now, revision: revision + 1,
  };
}

export function assertExitRevision(current: Maintenance | undefined, expectedRevision: number): Maintenance {
  if (!current) throw conflict('正式版本已不在维护中，请刷新后重新确认');
  if (current.revision !== expectedRevision) throw conflict('维护状态已被他人修改，请刷新后重新确认', { expected: expectedRevision, actual: current.revision });
  return current;
}

/**
 * 用户流量（M4）：开关关着，或者这个人是项目成员（负责人、开发者、测试者）或平台管理员，
 * 或者在临时指定名单里，就放行。
 */
export function admitsUser(maintenance: Maintenance | undefined, userId: UserId, isMemberOrAdmin: boolean): boolean {
  return !maintenance?.switches.users || isMemberOrAdmin || maintenance.allowUserIds.includes(userId);
}

/** 服务域调用（M7、M25）：开关开着，并且调用方的服务身份不是目标服务自己。平台自身的工作负载在放行表判定时就已放行。 */
export function blocksServiceCall(maintenance: Maintenance | undefined, callerIdentity: string, targetIdentity: string): boolean {
  return !!maintenance?.switches.services && callerIdentity !== targetIdentity;
}

/** 事件推送（M6）：开关开着就暂存。 */
export function holdsEvents(maintenance: Maintenance | undefined): boolean {
  return !!maintenance?.switches.events;
}

/** 破坏性迁移的维护窗口（M14、M17）：在维护中并且三个开关都拦。 */
export function fullWindow(maintenance: Maintenance | undefined): boolean {
  return !!maintenance && maintenance.switches.users && maintenance.switches.services && maintenance.switches.events;
}

/** 有预计恢复时间且还在未来时，给 `Retry-After` 的秒数（至少 60 秒）；否则不给。 */
export function retryAfterSeconds(maintenance: Maintenance | undefined, now: Date): number | undefined {
  const end = maintenance?.expectedEndAt?.getTime();
  if (end === undefined || end <= now.getTime()) return undefined;
  return Math.max(60, Math.ceil((end - now.getTime()) / 1000));
}
