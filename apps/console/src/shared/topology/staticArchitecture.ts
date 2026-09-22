// 系统层的静态架构表（RFC-019 design §4）：组件的泳道／行号／语义与调用关系是手写常量，随架构文档改，不从集群推断；连线全部是静态标注。
import type { Semantic } from '../ui/topology/topologyModel';

export interface StaticComponent { readonly id: string; readonly names: readonly string[]; readonly semantic: Semantic; readonly lane: number; readonly row: number; readonly subtitleKey: string; readonly kind: 'component' | 'database' }
export const SYSTEM_LANES = ['callers', 'gateway', 'platform', 'infrastructure', 'external'] as const;
/** `names` 是安装清单里的工作负载名（Deployment／StatefulSet），按名字对上盘点里的观测状态。 */
export const STATIC_COMPONENTS: readonly StaticComponent[] = [
  { id: 'traefik', names: ['traefik'], semantic: 'gateway', lane: 1, row: 0, subtitleKey: 'topology.system.traefik', kind: 'component' },
  { id: 'cs-auth', names: ['cs-auth'], semantic: 'security', lane: 1, row: 3, subtitleKey: 'topology.system.csAuth', kind: 'component' },
  { id: 'console', names: ['console', 'cs-console'], semantic: 'platform', lane: 2, row: 0, subtitleKey: 'topology.system.console', kind: 'component' },
  { id: 'cs-api', names: ['cs-api'], semantic: 'platform', lane: 2, row: 1, subtitleKey: 'topology.system.csApi', kind: 'component' },
  { id: 'cs-session', names: ['cs-session'], semantic: 'platform', lane: 2, row: 2, subtitleKey: 'topology.system.csSession', kind: 'component' },
  { id: 'cs-controller', names: ['cs-controller'], semantic: 'platform', lane: 2, row: 3, subtitleKey: 'topology.system.csController', kind: 'component' },
  { id: 'cs-events', names: ['cs-events'], semantic: 'platform', lane: 2, row: 4, subtitleKey: 'topology.system.csEvents', kind: 'component' },
  { id: 'mcp-capabilities', names: ['mcp-capabilities'], semantic: 'platform', lane: 2, row: 5, subtitleKey: 'topology.system.mcpCapabilities', kind: 'component' },
  { id: 'mcp-operations', names: ['mcp-operations'], semantic: 'platform', lane: 2, row: 6, subtitleKey: 'topology.system.mcpOperations', kind: 'component' },
  { id: 'postgres', names: ['postgres'], semantic: 'data', lane: 3, row: 0, subtitleKey: 'topology.system.postgres', kind: 'database' },
  { id: 'registry', names: ['registry'], semantic: 'build', lane: 3, row: 1, subtitleKey: 'topology.system.registry', kind: 'component' },
  { id: 'buildkit', names: ['buildkitd', 'buildkit'], semantic: 'build', lane: 3, row: 2, subtitleKey: 'topology.system.buildkit', kind: 'component' },
  { id: 'prometheus', names: ['prometheus'], semantic: 'platform', lane: 3, row: 3, subtitleKey: 'topology.system.prometheus', kind: 'component' },
];
export interface StaticExternal { readonly id: string; readonly row: number; readonly titleKey: string; readonly subtitleKey: string }
export const STATIC_EXTERNALS: readonly StaticExternal[] = [
  { id: 'gitlab', row: 7, titleKey: 'topology.system.gitlab', subtitleKey: 'topology.system.gitlabSub' },
  { id: 'oidc', row: 8, titleKey: 'topology.system.oidc', subtitleKey: 'topology.system.oidcSub' },
  { id: 'kube', row: 9, titleKey: 'topology.system.kube', subtitleKey: 'topology.system.kubeSub' },
];
export interface StaticEdge { readonly from: string; readonly to: string; readonly kind: 'traffic' | 'routes' | 'dial' | 'push' | 'uses' | 'control'; readonly labelKey?: string }
export const STATIC_EDGES: readonly StaticEdge[] = [
  { from: 'users', to: 'traefik', kind: 'traffic', labelKey: 'topology.system.edge.userHttps' },
  { from: 'traefik', to: 'cs-auth', kind: 'traffic', labelKey: 'topology.system.edge.forwardAuth' },
  { from: 'traefik', to: 'console', kind: 'traffic', labelKey: 'topology.system.edge.console' },
  { from: 'traefik', to: 'cs-api', kind: 'traffic', labelKey: 'topology.system.edge.api' },
  { from: 'traefik', to: 'slots', kind: 'routes', labelKey: 'topology.system.edge.userRoute' },
  { from: 'slots', to: 'traefik', kind: 'traffic', labelKey: 'topology.system.edge.serviceDomain' },
  { from: 'cs-events', to: 'slots', kind: 'push', labelKey: 'topology.system.edge.eventPush' },
  { from: 'sessions', to: 'cs-session', kind: 'dial', labelKey: 'topology.system.edge.runnerDial' },
  { from: 'sessions', to: 'mcp-capabilities', kind: 'traffic' },
  { from: 'sessions', to: 'mcp-operations', kind: 'traffic', labelKey: 'topology.system.edge.sessionToken' },
  { from: 'cs-api', to: 'postgres', kind: 'uses', labelKey: 'topology.system.edge.sql' },
  { from: 'cs-session', to: 'postgres', kind: 'uses' },
  { from: 'cs-controller', to: 'postgres', kind: 'uses' },
  { from: 'cs-events', to: 'postgres', kind: 'uses' },
  { from: 'cs-api', to: 'prometheus', kind: 'uses', labelKey: 'topology.system.edge.metrics' },
  { from: 'cs-controller', to: 'buildkit', kind: 'control', labelKey: 'topology.system.edge.build' },
  { from: 'buildkit', to: 'registry', kind: 'push', labelKey: 'topology.system.edge.pushImage' },
  { from: 'cs-controller', to: 'gitlab', kind: 'control', labelKey: 'topology.system.edge.gitlab' },
  { from: 'cs-auth', to: 'oidc', kind: 'traffic', labelKey: 'topology.system.edge.oidc' },
  { from: 'cs-controller', to: 'kube', kind: 'control', labelKey: 'topology.system.edge.kube' },
];
