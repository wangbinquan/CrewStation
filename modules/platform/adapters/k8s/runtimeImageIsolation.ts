import type { K8sClient } from '@crewstation/k8s';
import { precondition } from '@crewstation/kernel';

const ref = { apiVersion: 'crd.projectcalico.org/v1', kind: 'GlobalNetworkPolicy', plural: 'globalnetworkpolicies', namespaced: false };

/** 首版内置 registry 使用 5000／30500；其他后端布局必须另行提供等价隔离，不能默默裸连。 */
export async function assertRuntimeImageBuildIsolation(k8s: K8sClient, registryBase: string): Promise<void> {
  if (!registryBase.endsWith(':5000')) throw precondition('镜像构建需要已配置隔离策略的仓库后端');
  const policy = await k8s.get(ref, 'crewstation-image-build-registry', undefined, AbortSignal.timeout(10000));
  const spec = policy?.spec as { order?: number; selector?: string; types?: string[]; egress?: unknown[]; ingress?: unknown[]; tier?: string; preDNAT?: boolean; doNotTrack?: boolean } | undefined;
  const rules = [{ action: 'Deny', protocol: 'TCP', destination: { ports: [5000, 30500] } }, { action: 'Allow' }];
  const canonical = (value: unknown): string => JSON.stringify(value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, JSON.parse(canonical(child))])) : Array.isArray(value) ? value.map((child) => JSON.parse(canonical(child))) : value);
  if (!spec || policy?.metadata.deletionTimestamp || spec.order !== 10 || spec.selector !== 'has(crewstation.io/image-build)' || spec.types?.join(',') !== 'Egress' || (spec.tier && spec.tier !== 'default') || spec.preDNAT || spec.doNotTrack || canonical(spec.egress ?? []) !== canonical(rules)) throw precondition('运行镜像构建的仓库隔离策略未就绪');
}
