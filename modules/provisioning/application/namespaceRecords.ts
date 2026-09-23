import type { ProjectFacts } from '../api/steps';
import { namespaceDeclaration, networkPolicyDeclaration } from '../domain/namespaceProjection';
import type { NamespaceLedger, NamespaceRecordView } from '../ports/ledger';

export interface NamespaceSettings {
  /** 默认网络策略放行的系统命名空间。 */
  readonly systemNamespace: string;
  /** 开通链等命名空间运行中的最长时间；缺省 60 秒。 */
  readonly readyTimeoutMs?: number;
  readonly pollMs?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_POLL_MS = 500;

/** 还没运行中的记录缺什么：没观测到的子对象，或者资源中心给的原因。 */
function pending(label: string, record: NamespaceRecordView | undefined): string | undefined {
  if (!record) return `${label}记录不见了`;
  if (record.phase === 'ready') return undefined;
  const missing = record.children.filter((child) => child.phase === 'absent').map((child) => `${child.kind} ${child.name}`);
  if (missing.length) return `${label}还缺 ${missing.join('、')}`;
  return `${label}${record.reason ? `：${record.reason.message}` : `阶段为 ${record.phase}`}`;
}

/**
 * 项目命名空间（RFC-025 第四期）：provisioning 写期望——命名空间（Namespace＋额度）与网络策略各一条记录，调和器建出、被改或被删就补回。
 * 同样的期望台账不写库，所以重跑、启动重下发都是幂等的。
 */
export function namespaceRecords(ledger: NamespaceLedger, settings: NamespaceSettings) {
  const declare = async (facts: ProjectFacts): Promise<readonly [string, string]> => {
    const namespace = await ledger.declare(namespaceDeclaration(facts));
    const policies = await ledger.declare(networkPolicyDeclaration(facts, settings.systemNamespace));
    return [namespace.id, policies.id];
  };
  return {
    /** 启动重下发：只写期望，不等调和器。 */
    declare: async (facts: ProjectFacts): Promise<void> => { await declare(facts); },
    /**
     * 开通链的一步：写期望后按阶段推进——两条记录都运行中（命名空间、额度与每条网络策略都观测到了）才走下一步，
     * 后面的仓库、路由与首个发布都要在这个命名空间里建对象。等不到就抛错，开通记失败并说明还缺什么，作业按队列重试。
     */
    ensure: async (facts: ProjectFacts): Promise<void> => {
      const [namespaceId, policiesId] = await declare(facts);
      const deadline = Date.now() + (settings.readyTimeoutMs ?? DEFAULT_TIMEOUT_MS);
      for (;;) {
        const waiting = [pending('命名空间', await ledger.get(namespaceId)), pending('网络策略', await ledger.get(policiesId))].filter((entry) => entry !== undefined);
        if (!waiting.length) return;
        if (Date.now() >= deadline) throw new Error(`命名空间 ${facts.namespace} 没有就绪：${waiting.join('；')}`);
        await Bun.sleep(settings.pollMs ?? DEFAULT_POLL_MS);
      }
    },
  };
}
