import type { ProjectId } from '@crewstation/contracts';

/** 写命名空间期望要用的项目事实（结构上是开通事实 ProjectFacts 的子集）。 */
export interface ProjectNamespace {
  readonly projectId: ProjectId;
  readonly slug: string;
  readonly namespace: string;
  readonly kind: 'DigitalWorker' | 'APIProxy' | 'EventProducer';
}

/** 项目命名空间的额度（T1.13 起的平台缺省）：Pod 数、CPU 与内存的请求合计、PVC 数。 */
export const PROJECT_QUOTA = { name: 'crewstation-project', hard: { pods: '30', 'requests.cpu': '8', 'requests.memory': '16Gi', persistentvolumeclaims: '20' } } as const;

/**
 * 项目命名空间的网络策略（名字即模板，内容在 `packages/k8s`，由调和器渲染）：默认策略（入向只接网关、出向不限制，D64）、
 * 任务容器与构建的出站；接入容器（APIProxy、EventProducer）另有服务槽的出站。后三条在默认策略放开出向后不再起作用，照旧下发。
 */
export const NETWORK_POLICIES = {
  default: 'crewstation-default', taskEgress: 'crewstation-task-egress', buildEgress: 'crewstation-build-egress', integrationEgress: 'crewstation-integration-egress',
} as const;

type Child = { readonly kind: string; readonly namespace?: string; readonly name: string };

/** 命名空间记录的期望（RFC-025 第四期）：子对象是 Namespace 与它的额度；调和器照标签与上限渲染，被改就改回，从不删。 */
export interface NamespaceDeclaration {
  readonly kind: 'namespace';
  readonly ref: string;
  readonly projectId: ProjectId;
  readonly spec: { readonly children: readonly Child[]; readonly labels: Readonly<Record<string, string>>; readonly quota: { readonly hard: Readonly<Record<string, string>> } };
  readonly display: Readonly<Record<string, string>>;
}

/** 网络策略记录的期望：子对象是这个项目该有的每条 NetworkPolicy，默认策略放行的系统命名空间写在期望里。 */
export interface NetworkPolicyDeclaration {
  readonly kind: 'network-policy-set';
  readonly ref: string;
  readonly projectId: ProjectId;
  readonly spec: { readonly children: readonly Child[]; readonly systemNamespace: string };
  readonly display: Readonly<Record<string, string>>;
}

/** 每个项目各一条，引用就是项目 ID（同一种类下唯一）。 */
export function namespaceDeclaration(facts: ProjectNamespace): NamespaceDeclaration {
  const hard = PROJECT_QUOTA.hard;
  return {
    kind: 'namespace', ref: facts.projectId, projectId: facts.projectId,
    spec: { children: [{ kind: 'Namespace', name: facts.namespace }, { kind: 'ResourceQuota', namespace: facts.namespace, name: PROJECT_QUOTA.name }], labels: { 'crewstation.io/project': facts.slug }, quota: { hard } },
    display: { namespace: facts.namespace, quota: Object.entries(hard).map(([resource, limit]) => `${resource} ${limit}`).join(' · ') },
  };
}

/**
 * 接入容器代公司系统转发，服务槽直接出站（RFC-018 Q1＝C），所以多一条接入出站策略。D64 起默认策略对所有 Pod 放开出向，
 * 数字人服务槽也能直连外部；策略集照旧，调和器对网络策略只建、只改回、从不删，缩掉某条也删不掉线上已有的对象。
 */
export function networkPolicyDeclaration(facts: ProjectNamespace, systemNamespace: string): NetworkPolicyDeclaration {
  const names: string[] = [NETWORK_POLICIES.default, NETWORK_POLICIES.taskEgress, NETWORK_POLICIES.buildEgress];
  if (facts.kind !== 'DigitalWorker') names.push(NETWORK_POLICIES.integrationEgress);
  return {
    kind: 'network-policy-set', ref: facts.projectId, projectId: facts.projectId,
    spec: { children: names.map((name) => ({ kind: 'NetworkPolicy', namespace: facts.namespace, name })), systemNamespace },
    display: { namespace: facts.namespace, policies: names.join(', ') },
  };
}
