import type { ResourceKind } from '@crewstation/contracts';

/**
 * 种类注册表（RFC-025 设计 §2.2）：纯数据。各期实施时逐个种类补齐；尚未接入的种类用通用规则，
 * 它们在台账里还没有记录，规则只是让注册表完整。
 */
export interface KindRule {
  /** 占几个并发额度单位（D31、RFC-006：开发会话、业务任务、每个 Agent 执行各一个）。 */
  readonly quotaUnits: number;
  /** 就绪看哪一种子对象；没有就只看条件。 */
  readonly primaryChild?: 'Pod' | 'PersistentVolumeClaim' | 'Deployment';
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

export const KIND_RULES: Readonly<Record<ResourceKind, KindRule>> = {
  'dev-workspace': { ...WORKLOAD, failedRetentionMs: 72 * HOUR },
  'agent-execution': WORKLOAD,
  'business-workspace': WORKLOAD,
  volume: { quotaUnits: 0, primaryChild: 'PersistentVolumeClaim', readyConditions: [], releasable: false },
  namespace: GENERIC,
  'network-policy-set': GENERIC,
  // 服务槽（第三期）：Deployment 就绪即运行中；领域条件 Serving 为假（已下线、尚未部署）时按已结束算。不占任务额度。
  'service-slot': { quotaUnits: 0, primaryChild: 'Deployment', readyConditions: [], releasable: false, stable: true },
  'build-job': GENERIC,
  'migration-job': GENERIC,
  route: GENERIC,
  'rate-limit-policy': GENERIC,
  database: GENERIC,
  'data-binding': GENERIC,
};

export function kindRule(kind: ResourceKind): KindRule {
  return KIND_RULES[kind];
}

/** 视图缺省也列出的稳定种类（见 KindRule.stable）。 */
export const STABLE_KINDS: readonly ResourceKind[] = (Object.keys(KIND_RULES) as ResourceKind[]).filter((kind) => KIND_RULES[kind].stable);
