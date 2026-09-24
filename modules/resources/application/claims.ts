import type { ClusterLedger } from '@crewstation/contracts';
import type { ExpectedChild, ViewerAccess } from '../api/types';
import type { LedgerRecord } from '../domain/record';
import type { LedgerScope } from '../ports/repositories';
import { toClusterLedger } from './views';

/**
 * 一批集群对象各自的所属记录，给成集群清单一行的叠加（RFC-025 T13，I29 裁定）：没有记录认领的、看的人无权看的都不在结果里。
 */
export async function readClaims(read: LedgerScope, now: Date, access: (record: LedgerRecord) => Promise<ViewerAccess> | undefined, list: readonly ExpectedChild[]): Promise<{ readonly child: ExpectedChild; readonly ledger: ClusterLedger }[]> {
  const pairs = await read.records.claimed(list);
  const records = new Map((await read.records.getMany([...new Set(pairs.map((pair) => pair.resourceId))])).map((record) => [record.id, record]));
  return Promise.all(pairs.flatMap((pair) => {
    const record = records.get(pair.resourceId), viewer = record && access(record);
    return record && viewer ? [viewer.then((granted) => ({ child: pair.child, ledger: toClusterLedger(record, now, granted) }))] : [];
  }));
}
