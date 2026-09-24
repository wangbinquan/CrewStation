import type { ProjectId, ResourceChild, ResourceKind, ResourceOwner } from '@crewstation/contracts';
import type { ExpectedChild, LedgerRecord, RecordFilter, ResourceAlias } from '../domain/record';

/** 落库的子对象：观测＋是否在期望里（期望里已没有、集群里还在的旧对象为 false）。 */
export interface StoredChild {
  readonly child: ResourceChild;
  readonly expected: boolean;
}

export interface RecordRepository {
  /** `forUpdate` 在事务里锁住这一行：同一资源的写入串行。 */
  get(id: string, options?: { readonly forUpdate?: boolean }): Promise<LedgerRecord | undefined>;
  getByOwner(owner: ResourceOwner, kind: ResourceKind, options?: { readonly forUpdate?: boolean }): Promise<LedgerRecord | undefined>;
  getMany(ids: readonly string[]): Promise<LedgerRecord[]>;
  list(filter: RecordFilter): Promise<LedgerRecord[]>;
  insert(record: LedgerRecord): Promise<void>;
  update(record: LedgerRecord): Promise<void>;
  /** 子对象整体换成这一份。某个对象已被别的记录认领时抛 conflict（一个集群对象只属于一条记录）。 */
  replaceChildren(resourceId: string, children: readonly StoredChild[]): Promise<void>;
  /** 集群对象归哪条记录：先按 UID，再按种类＋命名空间＋名字。 */
  findByChild(child: ExpectedChild & { readonly uid?: string }): Promise<string | undefined>;
  /** 一批集群对象各自属于哪条记录（按种类＋命名空间＋名字）；没有记录认领的不在结果里。 */
  claimed(list: readonly ExpectedChild[]): Promise<{ readonly child: ExpectedChild; readonly resourceId: string }[]>;
  addAliases(resourceId: string, aliases: readonly ResourceAlias[]): Promise<void>;
  resolveAlias(alias: ResourceAlias): Promise<string | undefined>;
  /** 保留期已到（按数据库时间）、还没被转成「不要了」的失败记录（保留期巡检用）。 */
  retentionDue(limit: number): Promise<LedgerRecord[]>;
  /** 终态（期望已是「不要了」）且已结束早于某时刻、尚未压缩的记录。 */
  compactable(stoppedBefore: Date, limit: number): Promise<string[]>;
  /** 视图的计数：按种类 × 阶段，条件与 list 相同（不受条数上限影响）。 */
  countByKindPhase(filter: RecordFilter): Promise<Record<string, Record<string, number>>>;
  /** 压缩：只留身份、种类、最终阶段与原因、时间；子对象与别名以外的实况清空（设计 §8.3）。 */
  compact(id: string, at: Date): Promise<LedgerRecord | undefined>;
  /** 项目里这些种类、处于这些阶段的记录数，按种类分开（额度推导用）。 */
  countByKind(projectId: ProjectId, kinds: readonly ResourceKind[], phases: readonly string[]): Promise<Partial<Record<ResourceKind, number>>>;
}

export interface ChangeEntry {
  readonly seq: number;
  readonly projectId?: string;
  readonly resourceId: string;
  readonly version: number;
  readonly change: 'upsert' | 'remove';
  readonly at: Date;
}

export interface ChangeLog {
  /** 序号在提交时按提交顺序盖上（迁移里的延迟触发器），调用方拿不到也不需要。 */
  append(entry: Omit<ChangeEntry, 'seq' | 'at'>): Promise<void>;
  /** seq 之后已提交的变更，按 seq 升序；projectId 给了就只要这个项目的。 */
  since(seq: number, limit: number, projectId?: string): Promise<ChangeEntry[]>;
  /** 已提交的最大序号；日志为空时是 0。 */
  latest(): Promise<number>;
  /** 最早还在保留期里的序号；日志为空时是 latest。 */
  earliest(): Promise<number>;
  /** 删掉早于某时刻的变更，最新一条永远留着（快照的游标要有落脚处）。 */
  pruneBefore(at: Date): Promise<number>;
}

export interface LeaseStore {
  /** 抢租约：没人持有或已过期就拿到；时间用数据库的 now()（设计 §12 时钟偏差）。 */
  acquire(resourceId: string, holder: string, ttlMs: number): Promise<boolean>;
  renew(resourceId: string, holder: string, ttlMs: number): Promise<boolean>;
  release(resourceId: string, holder: string): Promise<void>;
  /** 清掉过期已久的租约行。 */
  prune(expiredBefore: Date): Promise<number>;
}

export interface ProjectLocks {
  /** 在当前事务里锁住项目行，把同一项目的额度判定串行化。 */
  lock(projectId: ProjectId): Promise<void>;
}

export interface LedgerScope {
  readonly records: RecordRepository;
  readonly changes: ChangeLog;
  readonly leases: LeaseStore;
  readonly locks: ProjectLocks;
}

export interface LedgerUnitOfWork {
  readonly read: LedgerScope;
  run<T>(fn: (scope: LedgerScope) => Promise<T>): Promise<T>;
}
