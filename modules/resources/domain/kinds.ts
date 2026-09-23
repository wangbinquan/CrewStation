import type { ResourceKind } from '@crewstation/contracts';

/**
 * 种类注册表（RFC-025 设计 §2.2）：纯数据。各期实施时逐个种类补齐；尚未接入的种类用通用规则，
 * 它们在台账里还没有记录，规则只是让注册表完整。
 */
export interface KindRule {
  /** 占几个并发额度单位（D31、RFC-006：开发会话、业务任务、每个 Agent 执行各一个）。 */
  readonly quotaUnits: number;
  /** 就绪看哪一种子对象；没有就只看条件。 */
  readonly primaryChild?: 'Pod' | 'PersistentVolumeClaim' | 'Deployment' | 'Job' | 'IngressRoute';
  /** 期望里的子对象都在即运行中（限流策略的中间件、命名空间与额度、网络策略），缺哪个就还在分配中。 */
  readonly allChildren?: true;
  /** 就绪还要这些领域条件为真（所属模块上报）。 */
  readonly readyConditions: readonly string[];
  /** 失败后保留多久供诊断（D9：开发会话 72 小时）；没有就不保留。 */
  readonly failedRetentionMs?: number;
  /** 界面能不能对它发起「释放」。 */
  readonly releasable: boolean;
  /**
   * 稳定记录：随上级长期存在、此刻已结束也还是它（服务槽每个服务两条，下线、尚未部署时按已结束算）。视图缺省也列出它们，
   * 页面才能画出已下线的槽；已结束的一次性记录（会话、执行）缺省不列。
   */
  readonly stable?: boolean;
}

const HOUR = 3_600_000;
const WORKLOAD: KindRule = { quotaUnits: 1, primaryChild: 'Pod', readyConditions: ['RunnerConnected'], releasable: true };
const GENERIC: KindRule = { quotaUnits: 0, readyConditions: ['Applied'], releasable: false };
const JOB: KindRule = { quotaUnits: 0, primaryChild: 'Job', readyConditions: [], releasable: false };

export const KIND_RULES: Readonly<Record<ResourceKind, KindRule>> = {
  'dev-workspace': { ...WORKLOAD, failedRetentionMs: 72 * HOUR },
  'agent-execution': WORKLOAD,
  'business-workspace': WORKLOAD,
  volume: { quotaUnits: 0, primaryChild: 'PersistentVolumeClaim', readyConditions: [], releasable: false },
  // 命名空间（第四期，T11）：provisioning 写的每个项目一条，子对象是 Namespace 与 ResourceQuota；网络策略一组一条。都是稳定记录，归档不释放。
  namespace: { quotaUnits: 0, allChildren: true, readyConditions: [], releasable: false, stable: true },
  'network-policy-set': { quotaUnits: 0, allChildren: true, readyConditions: [], releasable: false, stable: true },
  // 服务槽（第三期）：Deployment 就绪即运行中；领域条件 Serving 为假（已下线、尚未部署）时按已结束算。不占任务额度。
  'service-slot': { quotaUnits: 0, primaryChild: 'Deployment', readyConditions: [], releasable: false, stable: true },
  // 构建与迁移 Job（第三期）：Job 在跑是运行中，结束后照资源中心记下的 Finished 是已结束或失败——Kubernetes 的 TTL 删掉 Job 之后结果仍在（提案 §5.1）。
  'build-job': JOB,
  'migration-job': JOB,
  // 路由（第三期后半）：gateway 按服务写的正式、待验证、服务域与内部 API 路由；IngressRoute 在即运行中。每个服务几条、长期存在，是稳定记录。
  route: { quotaUnits: 0, primaryChild: 'IngressRoute', readyConditions: [], releasable: false, stable: true },
  // 限流策略（第三期后半，T10）：gateway 写的平台一条、每个项目一条，子对象是它们的 Traefik Middleware；中间件都在即运行中。稳定记录。
  'rate-limit-policy': { quotaUnits: 0, allChildren: true, readyConditions: [], releasable: false, stable: true },
  database: GENERIC,
  'data-binding': GENERIC,
};

export function kindRule(kind: ResourceKind): KindRule {
  return KIND_RULES[kind];
}

/** 视图缺省也列出的稳定种类（见 KindRule.stable）。 */
export const STABLE_KINDS: readonly ResourceKind[] = (Object.keys(KIND_RULES) as ResourceKind[]).filter((kind) => KIND_RULES[kind].stable);
