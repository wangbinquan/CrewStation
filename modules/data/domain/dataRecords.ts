import type { DataEnv, ProjectId, TaskDataMode } from '@crewstation/contracts';
import type { DataResource } from './dataResource';
import type { TaskDataBinding } from './taskDataBinding';

/** 数据面上的对象（RFC-025 第四期）：库与角色，由 data-control 观测。 */
type Child = { readonly kind: 'PostgresDatabase' | 'PostgresRole'; readonly name: string };
type Condition = { readonly type: string; readonly status: 'true' | 'false'; readonly reason?: string; readonly message?: string };
export interface ReleaseReason { readonly code: string; readonly message: string }

/** 生产库、开发库各一条：子对象是库与同名的运行角色；记录 ID 沿用数据资源的 ID，稳定记录。 */
export interface DatabaseDeclaration {
  readonly id: string;
  readonly kind: 'database';
  readonly ref: string;
  readonly projectId: ProjectId;
  /** provision：由 data-control 建（RFC-025 I28）；没有的是 data 自己建的旧库。 */
  readonly spec: { readonly children: readonly Child[]; readonly engine: 'postgres'; readonly env: DataEnv; readonly plan: string; readonly provision?: 'data-control' };
  readonly display: Readonly<Record<string, string>>;
  readonly conditions: readonly Condition[];
}

/**
 * 开发会话的一条数据访问绑定：挂在会话的工作区记录下；诊断只读、生产变更有临时角色，开发模式没有数据面对象。
 * 临时角色建在生产库上：期望里写库名与运行角色，data-control 删角色前把它拥有的对象转给运行角色。
 */
export interface BindingDeclaration {
  readonly id: string;
  readonly kind: 'data-binding';
  readonly ref: string;
  readonly projectId: ProjectId;
  readonly parentId: string;
  readonly spec: {
    readonly children: readonly Child[]; readonly mode: TaskDataMode; readonly ttlMinutes: number; readonly expiresAt?: string;
    readonly database?: string; readonly ownerRole?: string; readonly provision?: 'data-control';
  };
  readonly display: Readonly<Record<string, string>>;
  readonly conditions: readonly Condition[];
}

/** 一次投影：期望在就声明；已结束就受理释放（原因照结束的方式）。 */
export interface Projection<D> {
  readonly declaration: D;
  readonly release?: ReleaseReason;
}

const RELEASED: Partial<Record<DataResource['state'], ReleaseReason>> = {
  releasing: { code: 'released', message: '数据资源已释放' },
  released: { code: 'released', message: '数据资源已释放' },
};

/**
 * 只投影 PostgreSQL（s3、pvc 两种今天不供给）。供给失败是 Failed，重试成功后撤掉。由 data-control 建时（I28，没有存连接串的都算——
 * 旧库都存着），期望里标明，调和器照它建库与运行角色。
 */
export function databaseProjection(resource: DataResource, byDataControl = false): Projection<DatabaseDeclaration> | undefined {
  if (resource.kind !== 'postgres') return undefined;
  const failed: Condition = resource.state === 'failed'
    ? { type: 'Failed', status: 'true', reason: 'provisioning-failed', message: resource.message ?? '数据库供给失败' }
    : { type: 'Failed', status: 'false' };
  const release = RELEASED[resource.state];
  return {
    declaration: {
      id: resource.id, kind: 'database', ref: resource.id, projectId: resource.projectId,
      spec: {
        children: [{ kind: 'PostgresDatabase', name: resource.objectName }, { kind: 'PostgresRole', name: resource.objectName }], engine: 'postgres', env: resource.env, plan: resource.plan,
        ...(byDataControl && !resource.secretBox ? { provision: 'data-control' as const } : {}),
      },
      display: { env: resource.env, database: resource.objectName, plan: resource.plan, envVar: resource.envVar },
      conditions: [failed],
    },
    ...(release ? { release } : {}),
  };
}

const ENDED: Partial<Record<TaskDataBinding['state'], ReleaseReason>> = {
  rejected: { code: 'rejected', message: '负责人已拒绝' },
  revoked: { code: 'revoked', message: '已收回' },
  expired: { code: 'expired', message: '已到期' },
};

/** 等批准时 Prepared 为假（排队）；批准后 Prepared 为真，建好临时角色、生效时 Granted 为真。 */
function bindingConditions(binding: TaskDataBinding): Condition[] {
  if (binding.state === 'requested') return [{ type: 'Prepared', status: 'false', reason: 'awaiting-approval', message: '等负责人批准' }];
  return [{ type: 'Prepared', status: 'true' }, binding.state === 'active' ? { type: 'Granted', status: 'true' } : { type: 'Granted', status: 'false' }];
}

/** 临时角色所在的生产库：库名与同名的运行角色（生产库尚未供给时没有）。 */
export interface RoleTarget {
  readonly database: string;
  readonly ownerRole: string;
}

/**
 * 由 data-control 建临时角色时（RFC-025 I28 第二步，生效、有所在的库、data 没存连接串的都算），期望里标明，调和器照它建角色；
 * 旧形状（data 建、存着连接串）不标。
 */
export function bindingProjection(binding: TaskDataBinding, target?: RoleTarget, byDataControl = false): Projection<BindingDeclaration> {
  const role = binding.roleName && binding.roleName !== 'development' ? [{ kind: 'PostgresRole' as const, name: binding.roleName }] : [];
  const expiresAt = binding.expiresAt?.toISOString();
  const release = ENDED[binding.state];
  const provision = byDataControl && binding.state === 'active' && role.length && target && !binding.secretBox ? { provision: 'data-control' as const } : {};
  const where = role.length && target ? { database: target.database, ownerRole: target.ownerRole, ...provision } : {};
  return {
    declaration: {
      id: binding.id, kind: 'data-binding', ref: binding.id, projectId: binding.projectId as ProjectId, parentId: binding.taskId,
      spec: { children: role, mode: binding.mode, ttlMinutes: binding.ttlMinutes, ...(expiresAt ? { expiresAt } : {}), ...where },
      display: { mode: binding.mode, ...(expiresAt ? { expiresAt } : {}) },
      conditions: bindingConditions(binding),
    },
    ...(release ? { release } : {}),
  };
}
