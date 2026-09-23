import type { AllowlistDocument, WorkloadIdentity } from '@crewstation/contracts';
import type { AllowlistDrift } from '../domain/allowlistDrift';
import { allowlistDrift } from '../domain/allowlistDrift';
import type { Evaluation, EvaluationTarget } from '../domain/allowlistEvaluation';
import { evaluateServiceCall } from '../domain/allowlistEvaluation';
import type { GatewayUseCaseDeps } from './dependencies';
import type { ServiceBlock } from './maintenance';

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

/** 从已登记服务与授权推导放行表的内容；版本号与生成时间由调用方决定。 */
async function composeAllowlist(deps: GatewayUseCaseDeps): Promise<Pick<AllowlistDocument, 'operationRoutes' | 'defaultOpen' | 'entries'>> {
  const services = await deps.services.listServices();
  const callers = new Set<string>([...services.map((s) => s.identity), ...(await deps.grants.listCallers())]);
  let defaultOpen: string[] = [];
  let operationRoutes: AllowlistDocument['operationRoutes'] = [];
  const entries: AllowlistDocument['entries'] = [];
  for (const caller of callers) {
    const granted = await deps.grants.grantedOperations(caller);
    defaultOpen = granted.defaultOpen; operationRoutes = granted.operationRoutes;
    const service = services.find((s) => s.identity === caller);
    entries.push({ caller, operations: granted.operations, platformApi: service !== undefined, platformHosts: platformHostsFor(service?.kind) });
  }
  if (callers.size === 0) { const granted = await deps.grants.grantedOperations('none/none'); defaultOpen = granted.defaultOpen; operationRoutes = granted.operationRoutes; }
  return { operationRoutes, defaultOpen, entries };
}

/** 放行表带版本整体重算；评估侧只读最新版并短暂缓存，失联时按最后一版继续放行不超过 maxStaleSeconds。 */
export function allowlistUseCases(deps: GatewayUseCaseDeps, maintenanceBlock?: (caller: WorkloadIdentity, targetIdentity: string) => Promise<ServiceBlock | undefined>) {
  let cached: { doc: AllowlistDocument; at: number } | undefined;
  /**
   * `onDemand`：评估侧发现没有可用文档时的重建。推导内容期间别的进程可能已经写出可用的新版本，
   * 那就直接用它，不再叠一份内容相同的版本；两边真的同时落库时由主键冲突兜底（见 ensureCurrent）。
   */
  const rebuild = async (onDemand = false): Promise<AllowlistDocument> => {
    const content = await composeAllowlist(deps);
    const latest = await deps.allowlists.latest();
    if (onDemand && latest?.identityVersion === 2) { cached = { doc: latest, at: Date.now() }; return latest; }
    const doc: AllowlistDocument = { identityVersion: 2, ...content, version: (latest?.version ?? 0) + 1, generatedAt: deps.clock.now().toISOString(), maxStaleSeconds: deps.settings.allowlistMaxStaleSeconds };
    await deps.allowlists.save(doc);
    cached = { doc, at: Date.now() };
    const fields = { version: doc.version, callers: doc.entries.length, defaultOpen: doc.defaultOpen.length };
    // 按需重建说明此前没有任何当前身份版本的文档（升级后没人触发过重算，或全新安装），值得让运维看见。
    if (!onDemand) deps.logger.info('allowlist rebuilt', fields);
    else deps.logger.warn('allowlist rebuilt on demand: no document of the current identity version', fields);
    return doc;
  };
  /** 纯读取：库里最新一份不是当前身份版本（升级前留下的旧文档）就照实当作没有，不在读取里写库。 */
  const current = async (): Promise<AllowlistDocument | undefined> => {
    if (cached && Date.now() - cached.at < 2000) return cached.doc;
    const doc = await deps.allowlists.latest();
    if (doc?.identityVersion !== 2) return undefined;
    cached = { doc, at: Date.now() };
    return doc;
  };
  let healing: Promise<AllowlistDocument | undefined> | undefined;
  /**
   * 评估侧用：没有当前身份版本的放行表时就地重建一次，同进程的并发请求合并成一次。
   * 重建原本只由授权／目录变更与手动「重算」触发；升级抬高 identityVersion 之后若没人触发，
   * 服务域调用会一直被「放行表尚未生成」拒掉（2026-09-21 本机实撞）。全新安装同理。
   */
  const ensureCurrent = async (): Promise<AllowlistDocument | undefined> => {
    const doc = await current();
    if (doc) return doc;
    healing ??= rebuild(true)
      .catch(async (error: unknown) => {
        // 另一个进程可能同时重建并抢到了同一个版本号；它落库的那一份同样可用。
        const winner = await current();
        if (!winner) deps.logger.error('allowlist rebuild on demand failed', { error: String(error) });
        return winner;
      })
      .finally(() => { healing = undefined; });
    return healing;
  };
  return {
    rebuildAllowlist: () => rebuild(),
    currentAllowlist: current,
    /**
     * 定时全量核对（RFC-025 设计 §7.4）：按当前在册服务与授权推导一份，与最新一版比内容（不看先后）。放行表照旧由事件触发重算，
     * 这里兜住漏掉的事件：不一致就重算一版并告警。返回有出入的调用方与核对之后的版本。
     */
    verifyAllowlist: async (): Promise<AllowlistDrift & { readonly version: number }> => {
      const latest = await deps.allowlists.latest();
      const drift = allowlistDrift(latest?.identityVersion === 2 ? latest : undefined, await composeAllowlist(deps));
      if (latest && !drift.global && drift.callers.length === 0) return { ...drift, version: latest.version };
      const doc = await rebuild();
      deps.logger.warn('allowlist drift repaired', { from: latest?.version, to: doc.version, callers: drift.callers, global: drift.global });
      return { ...drift, version: doc.version };
    },
    evaluate: async (caller: WorkloadIdentity, target: EvaluationTarget): Promise<Evaluation> => {
      const doc = await ensureCurrent();
      if (!doc) return { allowed: false, targetIdentity: target.host, reason: '放行表尚未生成' };
      const ageSeconds = (Date.now() - new Date(doc.generatedAt).getTime()) / 1000;
      if (ageSeconds > doc.maxStaleSeconds * 24) deps.logger.warn('allowlist very stale', { version: doc.version, ageSeconds });
      const verdict = evaluateServiceCall(doc, caller, target, { serviceDomain: deps.settings.serviceDomain });
      // 放行表允许之后再看目标的正式版本是否维护中（RFC-021 M7、M25）：拦下时是 503，不是 403。
      const block = verdict.allowed && maintenanceBlock ? await maintenanceBlock(caller, verdict.targetIdentity) : undefined;
      return block ? { allowed: false, targetIdentity: verdict.targetIdentity, reason: block.message, unavailable: block } : verdict;
    },
  };
}
