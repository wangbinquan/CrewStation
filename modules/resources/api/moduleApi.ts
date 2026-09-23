import type { Actor, AdminResourceViewQuery, ProjectId, ResourceActionId, ResourceActionRequest, ResourceActionResult, ResourceView, ResourceViewQuery } from '@crewstation/contracts';
import type {
  ChildObservation, ExpectedChild, LedgerRecord, ObservationOutcome, OwnerTransaction, RecordFilter, ResourceActionHandler, ResourceAlias, ResourceLeases,
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
  readonly leases: ResourceLeases;
  get(id: string): Promise<LedgerRecord | undefined>;
  list(filter: RecordFilter): Promise<LedgerRecord[]>;
  resolveAlias(alias: ResourceAlias): Promise<string | undefined>;
  /** 只读：认领这个集群对象的记录（先按 UID，再按种类＋命名空间＋名字）。 */
  claimOf(child: ExpectedChild & { readonly uid?: string }): Promise<string | undefined>;
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
