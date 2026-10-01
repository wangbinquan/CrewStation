import type { ProjectResourceNode } from '@crewstation/contracts';

export const RESOURCE_DOMAINS = ['configuration', 'services', 'storage', 'network', 'platform'] as const;
export type ResourceDomain = typeof RESOURCE_DOMAINS[number];
const legacyDomains: Record<string, ResourceDomain> = { foundation: 'configuration', service: 'services', execution: 'services', data: 'storage', integration: 'platform' };
const typesByDomain: Record<ResourceDomain, readonly string[]> = {
  configuration: ['project', 'namespace', 'namespace-quota', 'execution-quota', 'observability', 'repository', 'configuration', 'secret'],
  services: ['service', 'pod', 'deployment', 'job', 'service-plan', 'service-slot', 'release', 'compute-profile', 'task-profile', 'runtime-image', 'dev-workspace', 'agent-execution', 'business-workspace', 'archive-execution', 'build-job', 'migration-job'],
  storage: ['database', 'database-role', 'object-space', 'object-plan', 'data-binding', 'production-data', 'volume', 'persistentvolumeclaim', 'persistentvolume'],
  network: ['route', 'ingress', 'network-policy', 'gateway-limit', 'middleware'],
  platform: ['api-operation', 'event-subscription', 'event-delivery', 'mcp'],
};
const resourceClasses: Record<string, string> = { Namespace: 'namespace', PostgresDatabase: 'database', PostgresRole: 'database-role', ResourceQuota: 'namespace-quota', IngressRoute: 'route', NetworkPolicy: 'network-policy', 'network-policy-set': 'network-policy', 'rate-limit-policy': 'gateway-limit' };
export const resourceClass = (type: string) => resourceClasses[type] ?? type;
export function normalizeResourceDomain(value: string): ResourceDomain | undefined {
  return RESOURCE_DOMAINS.find((domain) => domain === value) ?? legacyDomains[value];
}
/** Presentation ownership is stable across catalog, ledger and observed source categories. */
export function resourceDomain(node: Pick<ProjectResourceNode, 'kind' | 'resourceType' | 'category'>): ResourceDomain {
  if (node.kind === 'project') return 'configuration';
  const type = resourceClass(node.resourceType).toLowerCase();
  return RESOURCE_DOMAINS.find((domain) => typesByDomain[domain].includes(type)) ?? legacyDomains[node.category] ?? 'configuration';
}
