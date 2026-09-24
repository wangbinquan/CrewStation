import type { Logger } from '@crewstation/kernel';
import type { PeriodicJob } from '@crewstation/resource-runtime';
import { periodicJob } from '@crewstation/resource-runtime';
import type { DataObservationStats } from '../application/observeDataPlane';
import { changedDataRecords, observeDataRecord } from '../application/observeDataPlane';
import type { DataPlaneReader } from '../ports/dataPlane';
import type { DataLedgerObservations } from '../ports/ledger';

export interface DataPlaneObserverOptions {
  /** 尾随台账变更的间隔；缺省 1 秒。 */
  readonly pollMs?: number;
  /** 全量核对的间隔（数据面没有 watch，库或角色被人删了靠它发现）；缺省 30 秒。 */
  readonly resyncMs?: number;
}

/**
 * 数据面观测（RFC-025 设计 §6.6，第四期第一步）：数据面没有 watch，所以两条节奏——尾随台账变更（新声明、改期望、受理释放的记录随即核对一次），
 * 与定期全量（启动时先跑一轮，此后每 30 秒）。每次核对取一份新快照（两条只读查询）。
 */
export function dataPlaneObserver(ledger: DataLedgerObservations, reader: DataPlaneReader, stats: DataObservationStats, logger: Logger, options: DataPlaneObserverOptions = {}): PeriodicJob {
  let cursor: number | undefined;
  const tail = periodicJob(async () => {
    cursor ??= await ledger.latestChange();
    const batch = await ledger.changesSince(cursor, 500);
    if (!batch.length) return;
    cursor = batch.at(-1)!.seq;
    const records = await changedDataRecords(ledger, batch.map((entry) => entry.resourceId));
    if (!records.length) return;
    const snapshot = await reader.snapshot();
    for (const record of records) await observeDataRecord(ledger, snapshot, stats, record);
  }, (error) => logger.warn('data plane tail failed', { error: String(error) }), options.pollMs ?? 1_000);
  const full = periodicJob(async () => {
    const snapshot = await reader.snapshot();
    let recorded = 0;
    const records = await ledger.listLive();
    for (const record of records) recorded += await observeDataRecord(ledger, snapshot, stats, record);
    if (recorded) logger.info('data plane observed', { records: records.length, recorded, databases: snapshot.databases.size, roles: snapshot.roles.size });
  }, (error) => logger.warn('data plane resync failed', { error: String(error) }), options.resyncMs ?? 30_000);
  return {
    start: () => { full.start(); tail.start(); },
    stop: async () => { await tail.stop(); await full.stop(); await reader.close(); },
  };
}
