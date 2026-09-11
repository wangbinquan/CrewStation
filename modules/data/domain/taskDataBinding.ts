import type { TaskDataBindingState, TaskDataMode, TaskId, UserId } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';

/** 开发会话内的数据访问模式（R34、Design §9.8）：development 直接生效，另两种需负责人批准且有期限。 */
export interface TaskDataBinding {
  readonly id: string;
  readonly taskId: TaskId;
  readonly serviceId: string;
  readonly projectId: string;
  readonly mode: TaskDataMode;
  readonly state: TaskDataBindingState;
  readonly reason?: string;
  readonly decision?: string;
  readonly requestedBy: UserId;
  readonly decidedBy?: UserId;
  readonly ttlMinutes: number;
  readonly expiresAt?: Date;
  /** 批准后为该绑定创建的临时数据库角色；到期由数据库拒绝登录，撤权时删除。 */
  readonly roleName?: string;
  readonly secretBox?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function requiresApproval(mode: TaskDataMode): boolean {
  return mode !== 'development';
}

export function approve(binding: TaskDataBinding, decidedBy: UserId, now: Date, decision?: string): TaskDataBinding {
  if (binding.state !== 'requested') throw precondition(`绑定处于 ${binding.state}，不能批准`);
  return { ...binding, state: 'approved', decidedBy, ...(decision ? { decision } : {}), expiresAt: new Date(now.getTime() + binding.ttlMinutes * 60_000), updatedAt: now };
}

export function reject(binding: TaskDataBinding, decidedBy: UserId, now: Date, decision?: string): TaskDataBinding {
  if (binding.state !== 'requested') throw precondition(`绑定处于 ${binding.state}，不能拒绝`);
  return { ...binding, state: 'rejected', decidedBy, ...(decision ? { decision } : {}), updatedAt: now };
}

export function activate(binding: TaskDataBinding, roleName: string, secretBox: string, now: Date): TaskDataBinding {
  if (binding.state !== 'approved') throw precondition(`绑定处于 ${binding.state}，不能生效`);
  return { ...binding, state: 'active', roleName, secretBox, updatedAt: now };
}

export function isUsable(binding: TaskDataBinding, now: Date): boolean {
  return binding.state === 'active' && (!binding.expiresAt || binding.expiresAt > now);
}
