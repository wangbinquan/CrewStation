import type { Actor, AdminResourceViewQuery, ProjectId, ResourceActionId, ResourceActionRequest, ResourceActionResult, ResourceView, ResourceViewQuery } from '@crewstation/contracts';
import type {
  ChildObservation, ConditionUpdate, ExpectedChild, LedgerRecord, ObservationOutcome, OwnerTransaction, RecordFilter, ResourceActionHandler, ResourceAlias, ResourceLeases,
  ResourceWriter, StreamSubscription, ViewerAccess,
} from './types';

/** 所属模块的写入口：默认各自一个短事务；within(tx) 加入所属模块自己的事务，与它的状态一同提交。 */
export interface OwnerLedger extends ResourceWriter {
  within(tx: OwnerTransaction): ResourceWriter;
}

/** resources 模块对外能力（RFC-025）：期望由所属模块写，实况由资源中心写，所有页面读同一份标准记录。 */
export interface ResourcesModuleApi {
  readonly name: 'resources';
  owner(module: string): OwnerLedger;
  /** cluster-control 的观测入口；返回 unowned 表示台账里没有记录认领这个对象。 */
  observe(observation: ChildObservation): Promise<ObservationOutcome>;
  /** cluster-control 写只归资源中心的条件（不附带子对象观测），例如工作卷的「待回收」。 */
  observeConditions(resourceId: string, conditions: readonly ConditionUpdate[]): Promise<ObservationOutcome>;
  readonly leases: ResourceLeases;
  get(id: string): Promise<LedgerRecord | undefined>;
  list(filter: RecordFilter): Promise<LedgerRecord[]>;
  resolveAlias(alias: ResourceAlias): Promise<string | undefined>;
  /** 只读：认领这个集群对象的记录（先按 UID，再按种类＋命名空间＋名字）。 */
  claimOf(child: ExpectedChild & { readonly uid?: string }): Promise<string | undefined>;
  /** 只读：项目眼下占用的并发额度单位（占额度的种类里在运行或结束中的记录，D31）。 */
  occupancy(projectId: ProjectId): Promise<number>;
  /** 调和器用：某个游标之后已提交的变更（按提交顺序），只给资源 ID；台账一有变化调和器就把它排进队列。 */
  changesSince(cursor: number, limit: number): Promise<readonly { readonly seq: number; readonly resourceId: string }[]>;
  /** 已提交的最新游标；调和器启动时从这里开始尾随。 */
  latestChange(): Promise<number>;
  view(actor: Actor, projectId: ProjectId, query: ResourceViewQuery): Promise<ResourceView>;
  adminView(actor: Actor, query: AdminResourceViewQuery): Promise<ResourceView>;
  /** 推送流的授权与看的人能做什么；不通过时抛错（在开流之前调用，失败就是普通的 403）。 */
  projectAccess(actor: Actor, projectId: ProjectId): Promise<ViewerAccess>;
  adminAccess(actor: Actor): Promise<ViewerAccess>;
  /** 开流之前的人数检查：同一个人同时打开的流有上限。 */
  checkStreamCapacity(userId: string): void;
  subscribe(subscription: StreamSubscription): Promise<{ close(): void }>;
  performAction(actor: Actor, id: string, action: ResourceActionId, request: ResourceActionRequest): Promise<ResourceActionResult>;
  /** 组合根在所属模块装配后登记它的操作执行者（所属模块在更高层，不能反向依赖）。 */
  registerActionHandler(module: string, handler: ResourceActionHandler): void;
}
