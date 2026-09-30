import type { Actor, ProjectId, ResourceTarget, ResourceValues } from '@crewstation/contracts';
import { conflict, forbidden, notFound, precondition, validation } from '@crewstation/kernel';
import type { ResourceChange } from '../domain/change';
import type { ResourceTargetView } from '../ports/resources';
import type { ResourceAccessDeps } from './dependencies';

export async function requireAdmin(deps: ResourceAccessDeps, actor: Actor): Promise<void> {
  if (!await deps.projects.isAdmin(actor.userId)) throw forbidden('仅平台管理员可以分配、调整和审批项目资源');
}
export async function activeProject(deps: ResourceAccessDeps, actor: Actor, id: ProjectId) {
  const role = await deps.projects.authorize(actor, id, 'view');
  if (!await deps.projects.active(id)) throw precondition('项目已归档或不存在，不能调整资源');
  return role;
}
export const adapterOf = (deps: ResourceAccessDeps, target: ResourceTarget) => {
  const adapter = deps.adapters.find((a) => a.resourceType === target.resourceType);
  if (!adapter) throw notFound('资源类型');
  return adapter;
};
export async function loadChange(deps: ResourceAccessDeps, actor: Actor, projectId: ProjectId, id: string): Promise<ResourceChange> {
  await deps.projects.authorize(actor, projectId, 'view');
  const change = await deps.repository.get(id);
  if (!change || change.projectId !== projectId) throw notFound('资源申请');
  return change;
}
export function sameRevision(view: ResourceTargetView, expected: string): void {
  if (view.revision !== expected) throw conflict('资源配置已经变化，请重新读取并核对当前值；未提交变更', { code: 'resource_revision_conflict', currentRevision: view.revision, currentValues: view.current });
}
export function validateValues(view: ResourceTargetView, values: ResourceValues): void {
  if (!view.available) throw precondition(view.reason ?? '资源当前不可调整');
  const keys = new Set(view.fields.map((f) => f.key));
  if (Object.keys(values).some((k) => !keys.has(k))) throw validation('包含不适用的资源参数');
  for (const f of view.fields) {
    const value = values[f.key];
    if (value === undefined || value === null || value === '') { if (f.required) throw validation(`${f.label}为必填项`, { field: f.key }); continue; }
    if (f.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value) || f.integer && !Number.isInteger(value) || f.min !== undefined && value < f.min || f.max !== undefined && value > f.max)) throw validation(`${f.label}超出允许范围`, { field: f.key });
    if ((f.type === 'text' || f.type === 'select') && typeof value !== 'string' || f.type === 'boolean' && typeof value !== 'boolean') throw validation(`${f.label}类型不正确`, { field: f.key });
    if (f.options && !f.options.some((o) => o.value === value)) throw validation(`${f.label}不在可用目录中`, { field: f.key });
  }
}
export async function requestable(deps: ResourceAccessDeps, view: ResourceTargetView): Promise<boolean> {
  if (view.target.action !== 'grant') return view.owned || view.explicitlyRequestable === true;
  return view.explicitlyRequestable === true || (await deps.repository.policy(view.target.resourceType, view.target.resourceId)).requestable;
}
