import type { AllowlistDocument, Actor, NamespaceQuota, ProjectId, ProjectNamespaceQuotaDto, ProjectRateLimitsDto, ResourceTarget } from '@crewstation/contracts';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import type { K8sClient, K8sObject } from '@crewstation/k8s';
import { resourcesMatch } from '@crewstation/k8s';
import { notFound, precondition } from '@crewstation/kernel';
import type { ResourceReceipt } from '../../ports/resourceCatalogs';

export interface ProjectResourceStatePorts {
  actor: Actor; service(id: ProjectId): Promise<{ namespace: string; identity: string } | undefined>;
  namespace(actor: Actor, id: ProjectId): Promise<ProjectNamespaceQuotaDto>; namespaceRevision(revision: number, quota: NamespaceQuota): string;
  gateway(actor: Actor, id: ProjectId): Promise<ProjectRateLimitsDto>; allowlist(): Promise<AllowlistDocument | undefined>;
}
interface ResourceQuotaObject extends K8sObject { spec?: { hard?: Record<string, string> }; status?: { hard?: Record<string, string>; used?: Record<string, string> } }
interface MiddlewareObject extends K8sObject { spec?: { rateLimit?: { average?: number; burst?: number; sourceCriterion?: { requestHeaderName?: string; requestHost?: boolean } } } }
export function projectResourceState(k8s: K8sClient, p: ProjectResourceStatePorts) {
  const service = async (id: ProjectId) => { const value = await p.service(id); if (!value) throw notFound('项目服务'); return value; };
  const quotaObject = async (id: ProjectId) => k8s.get<ResourceQuotaObject>({ apiVersion: 'v1', kind: 'ResourceQuota', plural: 'resourcequotas', namespaced: true }, 'crewstation-project', (await service(id)).namespace, AbortSignal.timeout(5000));
  return {
    quotaObject,
    observeNamespace: async (id: ProjectId, receipt: ResourceReceipt) => {
      const [value, object] = await Promise.all([p.namespace(p.actor, id), quotaObject(id)]);
      if (p.namespaceRevision(value.revision, value.quota) !== receipt.revision) throw precondition('命名空间额度政策在同步期间变化，请核对最新配置');
      const q = value.quota, expected = { pods: String(q.pods), 'requests.cpu': String(q.requestsCpu), 'requests.memory': `${q.requestsMemoryGiB}Gi`, persistentvolumeclaims: String(q.persistentVolumeClaims) };
      const applied = !!object && resourcesMatch({ requests: object.spec?.hard, limits: object.status?.hard }, expected);
      return { applied, effect: applied ? '命名空间 ResourceQuota 已实际同步；现有实例继续运行' : '等待命名空间 ResourceQuota 实际同步' };
    },
    observeGateway: async (id: ProjectId, receipt: ResourceReceipt) => {
      const [value, svc] = await Promise.all([p.gateway(p.actor, id), service(id)]);
      if (String(value.revision) !== receipt.revision) throw precondition('项目限流在同步期间变化，请核对最新配置');
      const effective = value.effective, buckets = [
        { name: 'rate-limit-user', value: effective.userDomain.perUser, key: { requestHeaderName: IDENTITY_HEADERS.userId } },
        { name: 'rate-limit-host', value: effective.userDomain.perHost, key: { requestHost: true } },
        { name: 'rate-limit-source', value: effective.serviceDomain.perSource, key: { requestHeaderName: IDENTITY_HEADERS.sourceService } },
        { name: 'rate-limit-target', value: effective.serviceDomain.perTarget, key: { requestHost: true } },
      ];
      const checks = await Promise.all(buckets.map(async (bucket) => {
        const object = await k8s.get<MiddlewareObject>({ apiVersion: 'traefik.io/v1alpha1', kind: 'Middleware', plural: 'middlewares', namespaced: true }, bucket.name, svc.namespace, AbortSignal.timeout(5000)), actual = object?.spec?.rateLimit;
        return actual?.average === bucket.value.average && actual?.burst === bucket.value.burst && Object.entries(bucket.key).every(([key, field]) => actual?.sourceCriterion?.[key as keyof typeof bucket.key] === field);
      }));
      const applied = checks.every(Boolean); return { applied, effect: applied ? '四个项目网关限流中间件已实际同步' : '等待项目网关限流中间件实际同步' };
    },
    observeApi: async (id: ProjectId, target: ResourceTarget) => {
      const [document, svc] = await Promise.all([p.allowlist(), service(id)]);
      const granted = document?.defaultOpen.includes(target.resourceId) || document?.entries.find((entry) => entry.caller === svc.identity)?.operations.includes(target.resourceId);
      const applied = !!document && Boolean(granted) === (target.action === 'grant');
      return { applied, effect: applied ? '网关放行表已确认此服务的 API 授权' : '等待网关放行表同步 API 授权' };
    },
  };
}
