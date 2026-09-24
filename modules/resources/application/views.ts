import type { ClusterLedger, ResourceAction, ResourceActionId, ResourceRecord, ResourceView } from '@crewstation/contracts';
import { actionsFor } from '../domain/actions';
import { countByKindPhase } from '../domain/conditions';
import { kindRule } from '../domain/kinds';
import type { LedgerRecord } from '../domain/record';
import { aliasText } from '../domain/record';
import type { ViewerAccess } from '../api/types';
import type { RecordFilter } from '../domain/record';
import type { LedgerScope } from '../ports/repositories';

/** 这个人没有权限做这个操作的原因；有权限返回 undefined。展示与受理共用：受理时权限不足一律 403。 */
export function permissionReason(action: ResourceActionId, access: ViewerAccess): string | undefined {
  if (action === 'delete-volume' && !access.admin) return '只有管理员可以删除工作卷';
  if (!access.operate && !access.admin) return '需要这个项目的开发权限';
  return undefined;
}

/** 所属模块没登记执行者、资源中心自己也不做的操作：受理时同样以这句拒绝。 */
export const UNSUPPORTED_ACTION = '这类资源暂不支持在这里操作';

/**
 * 角色限制先于阶段前置条件：没有权限的人看到的原因是权限，而不是一个永远满足不了的阶段条件。
 * 其次是执行者：阶段上可做、却没人执行的，如实写不支持，不让页面给出一个点了必然失败的按钮。
 */
function trimActions(actions: readonly ResourceAction[], access: ViewerAccess, owner: string): ResourceAction[] {
  return actions.map((action) => {
    const denied = permissionReason(action.id, access);
    if (denied) return { id: action.id, enabled: false, disabledReason: denied };
    return action.enabled && access.executable && !access.executable(owner, action.id) ? { id: action.id, enabled: false, disabledReason: UNSUPPORTED_ACTION } : action;
  });
}

const iso = (at: Date | undefined): string | undefined => at?.toISOString();

/** 台账记录 → 标准记录（契约）。期望不出现在这里（界面不解读），展示字段单独给出（设计 §4.1）。 */
export function toResourceRecord(record: LedgerRecord, now: Date, access: ViewerAccess): ResourceRecord {
  const optional = <K extends string, V>(key: K, value: V | undefined) => (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
  return {
    id: record.id, kind: record.kind, ...optional('projectId', record.projectId), owner: record.owner,
    ...optional('parentId', record.parentId), ...optional('purpose', record.purpose),
    phase: record.phase, phaseSince: record.phaseSince.toISOString(), ...optional('reason', record.reason),
    conditions: [...record.conditions], children: [...record.children],
    ...optional('startup', record.startup ? { ...record.startup, observedAt: now.toISOString() } : undefined),
    ...optional('display', Object.keys(record.display).length ? { ...record.display } : undefined),
    generation: record.generation, observedGeneration: record.observedGeneration,
    ...optional('idleSince', iso(record.idleSince)), ...optional('retainUntil', iso(record.retainUntil)),
    actions: trimActions(actionsFor(record), access, record.owner.module),
    ...optional('aliases', record.aliases.length ? record.aliases.map(aliasText) : undefined),
    version: record.version, createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString(),
  };
}

/**
 * 集群清单一行的叠加（RFC-025 T13，I29 裁定）：标准记录的阶段、原因与可做操作，外加对象是否由资源中心按期望维护——
 * 期望在、种类由调和器渲染的，删掉会被补回。
 */
export function toClusterLedger(record: LedgerRecord, now: Date, access: ViewerAccess): ClusterLedger {
  const { id, kind, phase, phaseSince, reason, actions, version } = toResourceRecord(record, now, access);
  return { id, kind, phase, phaseSince, ...(reason ? { reason } : {}), actions, version, maintained: record.desired === 'present' && kindRule(record.kind).rendered === true };
}

/**
 * 快照：先读游标再读记录。游标之前提交的变更都已在记录里；之后提交的都会从推送流到达
 * （可能与快照重复，客户端按版本号去重）。
 */
export async function readView(scope: LedgerScope, filter: RecordFilter, access: ViewerAccess, now: Date): Promise<ResourceView> {
  const cursor = await scope.changes.latest();
  const records = await scope.records.list(filter);
  return { items: records.map((record) => toResourceRecord(record, now, access)), counts: countByKindPhase(records), cursor };
}
