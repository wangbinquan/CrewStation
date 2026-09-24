import type { DataPlaneSnapshot } from '../domain/dataPlane';
import { DATA_KINDS, dataObservations } from '../domain/dataPlane';
import type { DataLedgerObservations, DataRecordView } from '../ports/ledger';

/** 观测的累计结果：写了的、与上次一样没写的、台账里没有这条记录的。 */
export interface DataObservationStats {
  recorded: number;
  unchanged: number;
  unowned: number;
}

export function newDataObservationStats(): DataObservationStats {
  return { recorded: 0, unchanged: 0, unowned: 0 };
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
