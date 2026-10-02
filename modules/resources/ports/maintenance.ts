import type { MaintenanceStep } from '../domain/maintenanceEnding';

/** 每步独立的持久扫描和真实作业代次；本地实例 nonce 不能充当 fencingToken。 */
export interface MaintenanceSweepLease {
  readonly step: MaintenanceStep;
  readonly scanCutoff: Date;
  readonly afterId: string | null;
  readonly epoch: number;
  readonly holder: string;
  readonly fencingToken: number;
}

export interface MaintenanceSweepRepository {
  claim(step: MaintenanceStep, holder: string, ttlMs: number, initialCutoff?: Date): Promise<MaintenanceSweepLease | undefined>;
  /** 行锁之后的独立 clock_timestamp，拒绝尚未接管但已经过期的同 holder。 */
  requireCurrent(lease: MaintenanceSweepLease): Promise<Date>;
  /** 所有资源/路由写完后，排空提交时变更序号锁，再以独立数据库时钟核最终租约。 */
  requireCommitCurrent(lease: MaintenanceSweepLease): Promise<Date>;
  renew(lease: MaintenanceSweepLease, ttlMs: number): Promise<void>;
  finish(lease: MaintenanceSweepLease, afterId: string | null, eof: boolean, nextCutoff?: Date): Promise<void>;
  release(lease: MaintenanceSweepLease): Promise<void>;
}
