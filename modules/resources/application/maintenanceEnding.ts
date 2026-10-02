import { precondition } from '@crewstation/kernel';
import type { MaintenanceEndingDecision, MaintenanceEndingHandler, MaintenanceEndingSnapshot, MaintenanceStep } from '../domain/maintenanceEnding';
import { maintenanceSnapshot, sameMaintenanceSnapshot } from '../domain/maintenanceEnding';
import type { LedgerRecord } from '../domain/record';
import type { LedgerScope, LedgerUnitOfWork } from '../ports/repositories';
import type { MaintenanceSweepLease } from '../ports/maintenance';

export type MaintenanceEndingRegistry = ReadonlyMap<string, MaintenanceEndingHandler>;

/** 资源行锁外访问 owner；临时缺少 handler 不能让已选择对象退回旧规则。 */
export async function inspectMaintenanceEnding(uow: LedgerUnitOfWork, step: MaintenanceStep, record: LedgerRecord, handlers: MaintenanceEndingRegistry): Promise<MaintenanceEndingDecision> {
  const handler = handlers.get(record.owner.module);
  if (handler) {
    const decision = await handler(step, maintenanceSnapshot(record));
    if (decision.status === 'unselected' && await uow.read.records.maintenanceOwnerRequired(record.id)) return { status: 'waiting', reason: 'owner-selection-conflict' };
    return decision;
  }
  if (await uow.read.records.maintenanceOwnerRequired(record.id)) return { status: 'waiting', reason: 'owner-handler-unavailable' };
  return { status: 'unselected' };
}

export function permitsMaintenance(record: LedgerRecord, snapshot: MaintenanceEndingSnapshot, decision: MaintenanceEndingDecision): boolean {
  return sameMaintenanceSnapshot(record, snapshot) && (decision.status === 'unselected' || (decision.status === 'permitted' && sameMaintenanceSnapshot(record, decision.snapshot)));
}

/** commitRecord 的路由级联也保留同一个实际 UPDATE fence，整次失租回滚。 */
export function maintenanceCommitScope(scope: LedgerScope, lease: MaintenanceSweepLease): LedgerScope {
  return { ...scope, records: { ...scope.records, update: async (record) => {
    if (!await scope.records.updateForMaintenance(record, lease)) throw precondition('资源维护租约已过期或被接管', { code: 'maintenance-lease-lost' });
  } } };
}
