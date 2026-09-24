import type { Logger } from '@crewstation/kernel';
import type { LeasePort, PeriodicJob } from '@crewstation/resource-runtime';
import { periodicJob, withLease } from '@crewstation/resource-runtime';
import type { DataObservationStats } from '../application/observeDataPlane';
import { changedDataRecords, observeDataRecord, removeReleasedRoles } from '../application/observeDataPlane';
import type { DataPlaneReader, DataPlaneWriter } from '../ports/dataPlane';
import type { DataLedgerObservations, DataRecordView } from '../ports/ledger';

export interface DataPlaneObserverOptions {
  /** 尾随台账变更的间隔；缺省 1 秒。 */
  readonly pollMs?: number;
  /** 全量核对的间隔（数据面没有 watch，库或角色被人删了靠它发现）；缺省 30 秒。 */
  readonly resyncMs?: number;
  /** 多副本分工（设计 §6.3）：全量一轮持作业租约，尾随逐条持记录的租约；不给就不分工（单副本、用例）。 */
  readonly leases?: { readonly port: LeasePort; readonly holder: string };
}

/** 全量核对整轮持的作业租约：同一时刻只有一个副本在扫数据面，另一个副本这一轮跳过。 */
export const DATA_PLANE_RESYNC_LEASE = 'data-control:resync';
const LEASE_TTL_MS = 30_000;

/**
 * 数据面观测（RFC-025 设计 §6.6，第四期第一步）：数据面没有 watch，所以两条节奏——尾随台账变更（新声明、改期望、受理释放的记录随即核对一次），
 * 与定期全量（启动时先跑一轮，此后每 30 秒）。每次核对取一份新快照（两条只读查询）；「不要了」的访问绑定还在的临时角色随即删掉。
 */
type DataPlaneSnapshot = Awaited<ReturnType<DataPlaneReader['snapshot']>>;

/** 按一条记录在快照上做的事之外的写（I28：建库）；返回之后的快照。 */
export type DataRecordApply = (snapshot: DataPlaneSnapshot, record: DataRecordView) => Promise<DataPlaneSnapshot>;

export function dataPlaneObserver(ledger: DataLedgerObservations, plane: DataPlaneReader & DataPlaneWriter, stats: DataObservationStats, logger: Logger, options: DataPlaneObserverOptions = {}, apply?: DataRecordApply): PeriodicJob {
  let cursor: number | undefined;
  const leases = options.leases;
  const reconcile = async (snapshot: DataPlaneSnapshot, record: DataRecordView): Promise<number> => {
    const recorded = await observeDataRecord(ledger, snapshot, stats, record);
    await removeReleasedRoles(ledger, plane, snapshot, stats, logger, record);
    // 建库（I28）：缺了才建，建完当场补观测；同一轮后面的记录用建完之后的快照。
    if (apply) snapshot = await apply(snapshot, record).catch((error: unknown) => { logger.warn('data record apply failed', { resourceId: record.id, error: String(error) }); return snapshot; });
    return recorded;
  };
  // 多副本：抢到租约的那个副本处理；抢不到就跳过——另一副本正在处理它，漏掉的变化由下一轮全量（至多 30 秒）补上。
  const leased = async <T>(key: string, ttlMs: number, run: () => Promise<T>, fallback: T): Promise<T> => {
    if (!leases) return run();
    const outcome = await withLease(leases.port, key, leases.holder, ttlMs, run);
    return outcome.acquired ? outcome.value : fallback;
  };
  const tail = periodicJob(async () => {
    cursor ??= await ledger.latestChange();
    const batch = await ledger.changesSince(cursor, 500);
    if (!batch.length) return;
    cursor = batch.at(-1)!.seq;
    const records = await changedDataRecords(ledger, batch.map((entry) => entry.resourceId));
    if (!records.length) return;
    const snapshot = await plane.snapshot();
    for (const record of records) await leased(record.id, LEASE_TTL_MS, () => reconcile(snapshot, record), 0);
  }, (error) => logger.warn('data plane tail failed', { error: String(error) }), options.pollMs ?? 1_000);
  const full = periodicJob(() => leased(DATA_PLANE_RESYNC_LEASE, LEASE_TTL_MS, async () => {
    const snapshot = await plane.snapshot();
    let recorded = 0;
    const records = await ledger.listLive();
    for (const record of records) recorded += await reconcile(snapshot, record);
    if (recorded) logger.info('data plane observed', { records: records.length, recorded, databases: snapshot.databases.size, roles: snapshot.roles.size });
  }, undefined), (error) => logger.warn('data plane resync failed', { error: String(error) }), options.resyncMs ?? 30_000);
  return {
    start: () => { full.start(); tail.start(); },
    stop: async () => { await tail.stop(); await full.stop(); await plane.close(); },
  };
}
