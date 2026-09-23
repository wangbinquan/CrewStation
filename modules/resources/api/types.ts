import type {
  Actor, ClusterPurpose, ProjectId, ResourceActionId, ResourceActionRequest, ResourceChild, ResourceCondition, ResourceConditionStatus,
  ResourceKind, ResourceOwner, ResourcePhase, ResourceReason, ResourceStreamEvent, StartupRecord,
} from '@crewstation/contracts';

/*
 * resources 模块的对外类型。模块模板规定 api/ 与 domain/ 互不 import，领域里有一份同形的定义；
 * 两份是否一致由 tests/apiShapes.test.ts 在编译期核对。
 */

/** 期望里的一个子对象：种类＋命名空间＋名字。调和器按它认领集群里的对象（RFC-025 设计 §6.2）。 */
export interface ExpectedChild {
  readonly kind: string;
  readonly namespace?: string;
  readonly name: string;
}

/** 期望：子对象清单是公共部分；按种类的其余字段由所属模块写、界面不解读。 */
export interface ResourceSpec {
  readonly children: readonly ExpectedChild[];
  readonly [field: string]: unknown;
}

/** 旧形状对象的别名（RFC-025 B11）：来源＋旧名字；记录本身只用 UUID。 */
export interface ResourceAlias {
  readonly source: 'rel' | 'tsk' | 'pvc-name' | 'route-name';
  readonly alias: string;
}

/**
 * 台账里的一条记录。期望（desired、spec、generation、releaseReason）只由所属模块写；
 * 实况（观测、子对象、阶段、原因、observedGeneration）只由资源中心写。
 */
export interface LedgerRecord {
  readonly id: string;
  readonly kind: ResourceKind;
  readonly projectId?: ProjectId;
  readonly owner: ResourceOwner;
  readonly parentId?: string;
  readonly purpose?: ClusterPurpose;
  readonly desired: 'present' | 'absent';
  readonly spec: ResourceSpec;
  readonly generation: number;
  readonly observedGeneration: number;
  readonly releaseReason?: ResourceReason;
  readonly conditions: readonly ResourceCondition[];
  readonly children: readonly ResourceChild[];
  readonly startup?: StartupRecord;
  readonly display: Readonly<Record<string, string>>;
  readonly phase: ResourcePhase;
  readonly phaseSince: Date;
  readonly reason?: ResourceReason;
  readonly idleSince?: Date;
  readonly retainUntil?: Date;
  readonly aliases: readonly ResourceAlias[];
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly compactedAt?: Date;
}

/** 所属模块或调和器报来的一条条件；`since` 由台账按「状态变了才换」自己记。 */
export interface ConditionUpdate {
  readonly type: string;
  readonly status: ResourceConditionStatus;
  readonly reason?: string;
  readonly message?: string;
}

/** 所属模块声明一条资源：新建或整体替换期望（设计 §2.1）。 */
export interface ResourceDeclaration {
  /** 所属模块已有稳定 ID 时沿用它（例如任务环境的 ID）；不给就由台账生成 UUIDv7。 */
  readonly id?: string;
  readonly kind: ResourceKind;
  /** 所属模块自己的引用；同一模块、同一种类下唯一。 */
  readonly ref: string;
  readonly projectId?: ProjectId;
  readonly parentId?: string;
  readonly purpose?: ClusterPurpose;
  readonly spec: ResourceSpec;
  readonly display?: Readonly<Record<string, string>>;
  /** 声明时一并给出的领域条件（例如排队中的 `Prepared=false`）。 */
  readonly conditions?: readonly ConditionUpdate[];
  readonly aliases?: readonly ResourceAlias[];
}

/** 所属模块上报的实况里属于它的部分：领域条件、启动进度、展示字段、空闲起点。null 表示清掉。 */
export interface ResourceReport {
  readonly conditions?: readonly ConditionUpdate[];
  readonly startup?: StartupRecord | null;
  readonly display?: Readonly<Record<string, string>>;
  readonly idleSince?: Date | null;
}

export interface ResourceWriter {
  declare(input: ResourceDeclaration): Promise<LedgerRecord>;
  /** 受理：占额度的种类先在项目锁下按台账数额度（设计 §3、D31），够才声明。 */
  admit(input: ResourceDeclaration): Promise<LedgerRecord>;
  /**
   * 期望改为「不要了」；已是就原样返回——只有原来的原因码是泛泛的 `released`（受理时还说不出原因）时，
   * 才换成这次给的具体原因。
   */
  requestRelease(id: string, reason: ResourceReason): Promise<LedgerRecord>;
  report(id: string, report: ResourceReport): Promise<LedgerRecord>;
  find(ref: string, kind: ResourceKind): Promise<LedgerRecord | undefined>;
}

/** 所属模块自己的数据库事务（drizzle 的 Transaction）：台账在它里面写，与所属模块的状态一同提交或回滚。 */
export type OwnerTransaction = object;

/** 调和器报来的一个子对象的观测（设计 §6.2 第 3 步）。 */
export interface ChildObservation {
  /** 对象标签 `crewstation.io/resource-id` 上的记录 ID；没有就按子对象身份找。 */
  readonly resourceId?: string;
  readonly child: ResourceChild;
  /** 对象已从集群里消失。 */
  readonly gone?: boolean;
  /** 资源中心据观测得出的条件（例如 CrashLooping）。 */
  readonly conditions?: readonly ConditionUpdate[];
}

export type ObservationOutcome =
  | { readonly status: 'recorded'; readonly record: LedgerRecord }
  | { readonly status: 'unchanged'; readonly record: LedgerRecord }
  /** 台账里没有记录认领这个对象：收编作业据此列出孤儿（设计 §6.4、§6.5）。 */
  | { readonly status: 'unowned' };

export interface RecordFilter {
  readonly projectId?: ProjectId;
  readonly kind?: ResourceKind;
  readonly parentId?: string;
  /** 带上已结束的；缺省只要在运行、结束中与失败保留中的。 */
  readonly includeStopped?: boolean;
  readonly limit?: number;
}

/** 看的人能做什么：项目上有开发权限才能做生命周期操作；删除工作卷只给管理员（设计 §2.2）。 */
export interface ViewerAccess {
  readonly operate: boolean;
  readonly admin: boolean;
}

/** 推送流的一个订阅（设计 §8）：一个 SSE 连接。 */
export interface StreamSubscription {
  readonly userId: string;
  readonly filter: RecordFilter;
  readonly access: ViewerAccess;
  /** 客户端带来的游标（Last-Event-ID）；没有或过旧就先发快照。 */
  readonly cursor?: number;
  /** 发一个事件；背压由调用方的写出承担，这里按订阅排队。 */
  send(event: ResourceStreamEvent): Promise<void>;
  /** 复核授权（成员变化后失权的连接要断开）；抛错即断开。 */
  reauthorize(): Promise<void>;
  /** 服务端要求断开（缓冲溢出、失权、停机）。 */
  close(): void;
}

/**
 * 可做操作的执行者：所属模块的用例（例如释放会话仍由 dev-session 核对未推送提交、负责人强制）。
 * 资源中心只做统一的受理——前置条件、版本、授权——结果回到同一条记录（设计 §4.2）。
 */
export type ResourceActionHandler = (input: {
  readonly actor: Actor;
  readonly record: LedgerRecord;
  readonly action: ResourceActionId;
  readonly request: ResourceActionRequest;
}) => Promise<void>;

/** 调和器用的租约（设计 §6.3）：时间按数据库 now()。 */
export interface ResourceLeases {
  acquire(resourceId: string, holder: string, ttlMs: number): Promise<boolean>;
  renew(resourceId: string, holder: string, ttlMs: number): Promise<boolean>;
  release(resourceId: string, holder: string): Promise<void>;
}
