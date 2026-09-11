import type { AllowlistDocument, WorkloadIdentity } from '@crewstation/contracts';
import type { Evaluation, EvaluationTarget } from '../domain/allowlistEvaluation';
import { evaluateServiceCall } from '../domain/allowlistEvaluation';
import type { GatewayUseCaseDeps } from './dependencies';

type ServiceKind = 'DigitalWorker' | 'APIProxy' | 'EventProducer';

/**
 * 已登记服务可达的平台端点：平台 API 与两个 MCP 对所有服务开放（开发容器内的 Agent 要连 MCP）；
 * 事件入口只对 EventProducer 开放——别的服务不该能凭空造事件。未登记的调用方一个都到不了。
 */
function platformHostsFor(kind: ServiceKind | undefined): AllowlistDocument['entries'][number]['platformHosts'] {
  if (kind === undefined) return [];
  const base = ['platformApi', 'mcpCapabilities', 'mcpOperations'] as const;
  return kind === 'EventProducer' ? [...base, 'events'] : [...base];
}

/** 放行表带版本整体重算；评估侧只读最新版并短暂缓存，失联时按最后一版继续放行不超过 maxStaleSeconds。 */
export function allowlistUseCases(deps: GatewayUseCaseDeps) {
  let cached: { doc: AllowlistDocument; at: number } | undefined;
  const rebuild = async (): Promise<AllowlistDocument> => {
    const services = await deps.services.listServices();
    const callers = new Set<string>([...services.map((s) => s.identity), ...(await deps.grants.listCallers())]);
    let defaultOpen: string[] = [];
    const entries: AllowlistDocument['entries'] = [];
    for (const caller of callers) {
      const granted = await deps.grants.grantedOperations(caller);
      defaultOpen = granted.defaultOpen;
      const service = services.find((s) => s.identity === caller);
      entries.push({ caller, operations: granted.operations, platformApi: service !== undefined, platformHosts: platformHostsFor(service?.kind) });
    }
    if (callers.size === 0) defaultOpen = (await deps.grants.grantedOperations('none/none')).defaultOpen;
    const latest = await deps.allowlists.latest();
    const doc: AllowlistDocument = { version: (latest?.version ?? 0) + 1, generatedAt: deps.clock.now().toISOString(), defaultOpen, entries, maxStaleSeconds: deps.settings.allowlistMaxStaleSeconds };
    await deps.allowlists.save(doc);
    cached = { doc, at: Date.now() };
    deps.logger.info('allowlist rebuilt', { version: doc.version, callers: entries.length, defaultOpen: defaultOpen.length });
    return doc;
  };
  const current = async (): Promise<AllowlistDocument | undefined> => {
    if (cached && Date.now() - cached.at < 2000) return cached.doc;
    const doc = await deps.allowlists.latest();
    if (doc) cached = { doc, at: Date.now() };
    return doc;
  };
  return {
    rebuildAllowlist: rebuild,
    currentAllowlist: current,
    evaluate: async (caller: WorkloadIdentity, target: EvaluationTarget): Promise<Evaluation> => {
      const doc = await current();
      if (!doc) return { allowed: false, targetIdentity: target.host, reason: '放行表尚未生成' };
      const ageSeconds = (Date.now() - new Date(doc.generatedAt).getTime()) / 1000;
      if (ageSeconds > doc.maxStaleSeconds * 24) deps.logger.warn('allowlist very stale', { version: doc.version, ageSeconds });
      return evaluateServiceCall(doc, caller, target, { serviceDomain: deps.settings.serviceDomain });
    },
  };
}
