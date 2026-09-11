import type { AllowlistDocument, WorkloadIdentity } from '@crewstation/contracts';
import { PLATFORM_PATHS, PLATFORM_SERVICE_HOSTS, matchesOperationPath } from '@crewstation/contracts';

export interface EvaluationTarget { host: string; method: string; path: string }
export interface Evaluation { allowed: boolean; targetIdentity: string; reason?: string }

export interface DomainNames { serviceDomain: string }

/**
 * 服务域放行判定（R09、R45）：
 * - `api.<serviceDomain>/api/<proxy>/…` → 内部 API，按操作键（默认开放＋定向授权）放行；
 * - `api.<serviceDomain>/…` 其余路径 → 平台 API，已登记服务默认可调；
 * - `events.<sd>`、两个 `mcp-*.<sd>` → 平台自身的端点，按条目的 platformHosts 放行，不走操作键；
 * - `<service>.<serviceDomain>/…` → 数字人自身暴露的 API，操作键的 proxy 就是该服务名。
 */
export function evaluateServiceCall(doc: AllowlistDocument, caller: WorkloadIdentity, target: EvaluationTarget, names: DomainNames): Evaluation {
  const entry = doc.entries.find((e) => e.caller === caller.identity);
  const granted = new Set([...doc.defaultOpen, ...(entry?.operations ?? [])]);
  const apiHost = `api.${names.serviceDomain}`;
  const path = target.path.split('?')[0] ?? target.path;
  if (target.host === apiHost) {
    if (path.startsWith(PLATFORM_PATHS.internalApiPrefix)) {
      const [proxy = '', ...rest] = path.slice(PLATFORM_PATHS.internalApiPrefix.length).split('/');
      const upstreamPath = `/${rest.join('/')}`;
      return decideOperation(granted, proxy, target.method, upstreamPath, `proxy:${proxy}`);
    }
    if (entry?.platformApi ?? false) return { allowed: true, targetIdentity: 'platform-api' };
    return { allowed: false, targetIdentity: 'platform-api', reason: `${caller.identity} 未登记为平台服务，不能调用平台 API` };
  }
  const suffix = `.${names.serviceDomain}`;
  if (target.host.endsWith(suffix)) {
    const serviceName = target.host.slice(0, -suffix.length);
    const platformHost = platformHostOf(serviceName);
    if (platformHost) {
      const allowed = (entry?.platformHosts ?? []).includes(platformHost);
      return allowed
        ? { allowed: true, targetIdentity: `platform:${serviceName}` }
        : { allowed: false, targetIdentity: `platform:${serviceName}`, reason: `${caller.identity} 不能调用平台端点 ${target.host}` };
    }
    return decideOperation(granted, serviceName, target.method, path, `service:${serviceName}`);
  }
  return { allowed: false, targetIdentity: target.host, reason: `未知的服务域主机 ${target.host}` };
}

function platformHostOf(hostPrefix: string): keyof typeof PLATFORM_SERVICE_HOSTS | undefined {
  for (const [name, prefix] of Object.entries(PLATFORM_SERVICE_HOSTS)) {
    if (prefix === hostPrefix) return name as keyof typeof PLATFORM_SERVICE_HOSTS;
  }
  return undefined;
}

function decideOperation(granted: Set<string>, proxy: string, method: string, path: string, targetIdentity: string): Evaluation {
  for (const key of granted) {
    const [keyProxy, keyMethod, ...templateParts] = key.split(':');
    if (keyProxy !== proxy || keyMethod !== method.toUpperCase()) continue;
    if (matchesOperationPath(templateParts.join(':'), path)) return { allowed: true, targetIdentity };
  }
  return { allowed: false, targetIdentity, reason: `操作 ${proxy}:${method.toUpperCase()}:${path} 未对调用方开放` };
}
