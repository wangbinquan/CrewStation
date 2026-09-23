import type { Actor, ResourceActionId, ResourceActionRequest, ResourceActionResult } from '@crewstation/contracts';
import type { Clock } from '@crewstation/kernel';
import { conflict, forbidden, notFound, precondition } from '@crewstation/kernel';
import type { ResourceActionHandler, ViewerAccess } from '../api/types';
import type { LedgerRecord } from '../domain/record';
import type { LedgerScope } from '../ports/repositories';
import { toResourceRecord } from './views';

export interface ActionDeps {
  readonly read: LedgerScope;
  readonly clock: Clock;
  readonly handlers: ReadonlyMap<string, ResourceActionHandler>;
  access(actor: Actor, record: LedgerRecord): Promise<ViewerAccess>;
}

export async function performAction(deps: ActionDeps, actor: Actor, id: string, action: ResourceActionId, request: ResourceActionRequest): Promise<ResourceActionResult> {
  const record = await deps.read.records.get(id);
  if (!record) throw notFound('资源', id);
  const access = await deps.access(actor, record);
  const offered = toResourceRecord(record, deps.clock.now(), access).actions.find((entry) => entry.id === action);
  if (!offered) throw precondition(`这类资源没有「${action}」操作`, { code: 'action-unsupported', kind: record.kind });
  if (!offered.enabled) {
    if (!access.operate && !access.admin) throw forbidden(offered.disabledReason);
    throw precondition(offered.disabledReason ?? '现在不能做这个操作', { code: 'action-disabled', phase: record.phase });
  }
  if (request.expectedVersion !== undefined && request.expectedVersion !== record.version) throw conflict('资源已经变化，请刷新后再试', { expectedVersion: request.expectedVersion, version: record.version });
  const handler = deps.handlers.get(record.owner.module);
  if (!handler) throw precondition('这类资源暂不支持在这里操作', { code: 'action-unsupported', owner: record.owner.module });
  await handler({ actor, record, action, request });
  const after = await deps.read.records.get(id);
  return { accepted: true, ...(after ? { record: toResourceRecord(after, deps.clock.now(), access) } : {}) };
}
