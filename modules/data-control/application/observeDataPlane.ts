import type { Logger } from '@crewstation/kernel';
import type { DataPlaneSnapshot } from '../domain/dataPlane';
import { DATA_KINDS, dataObservations } from '../domain/dataPlane';
import { roleRemovals } from '../domain/roleRemoval';
import type { DataPlaneWriter } from '../ports/dataPlane';
import type { DataLedgerObservations, DataRecordView } from '../ports/ledger';

/** 观测的累计结果：写了的、与上次一样没写的、台账里没有这条记录的；调和器删掉的临时角色。 */
export interface DataObservationStats {
  recorded: number;
  unchanged: number;
  unowned: number;
  removed: number;
}

export function newDataObservationStats(): DataObservationStats {
  return { recorded: 0, unchanged: 0, unowned: 0, removed: 0 };
}

/** 按一条记录核对数据面：每个子对象的观测写回台账（同样的观测台账不写库）。返回这一条写了几次。 */
export async function observeDataRecord(ledger: DataLedgerObservations, snapshot: DataPlaneSnapshot, stats: DataObservationStats, record: DataRecordView): Promise<number> {
  let recorded = 0;
  for (const { child, gone } of dataObservations(record, snapshot)) {
    const outcome = await ledger.observe({ resourceId: record.id, child, ...(gone ? { gone } : {}) });
    stats[outcome.status] += 1;
    if (outcome.status === 'recorded') recorded += 1;
  }
  return recorded;
}

/** 台账有变化的记录里挑出数据面的那些（别的种类由 cluster-control 管），读最新的一版。 */
export async function changedDataRecords(ledger: DataLedgerObservations, ids: readonly string[]): Promise<DataRecordView[]> {
  const records: DataRecordView[] = [];
  for (const id of new Set(ids)) {
    const record = await ledger.get(id);
    if (record && DATA_KINDS.has(record.kind)) records.push(record);
  }
  return records;
}

/**
 * 「不要了」的访问绑定：还在的临时角色由调和器删（第四期第三步）。data 收回、到期时自己也删（暂时保留，重复删除无害）——
 * 它删失败时（到期回收吞掉了错误）角色会留在库里，这里补上。删掉就当场写一条消失，记录随即进入「已结束」。
 */
export async function removeReleasedRoles(ledger: DataLedgerObservations, writer: DataPlaneWriter, snapshot: DataPlaneSnapshot, stats: DataObservationStats, logger: Logger, record: DataRecordView): Promise<void> {
  const { plans, skipped } = roleRemovals(record, snapshot);
  if (skipped.length) logger.warn('data role removal skipped', { resourceId: record.id, roles: skipped });
  for (const plan of plans) {
    const outcome = await writer.dropRole(plan);
    if (outcome === 'replaced') continue;
    if (outcome === 'dropped') {
      stats.removed += 1;
      logger.info('data role removed', { resourceId: record.id, role: plan.role, database: plan.database });
    }
    await ledger.observe({ resourceId: record.id, child: { kind: 'PostgresRole', name: plan.role, uid: plan.oid, phase: 'absent', ready: false }, gone: true });
  }
}
