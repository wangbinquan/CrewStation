/**
 * 命名空间记录里调和器渲染要用的期望（RFC-025 第四期，provisioning 写）：Namespace 的名字取自期望里的 Namespace 子对象，
 * 额度的名字取自 ResourceQuota 子对象；标签（项目标识）与额度的上限写在期望里。记录是数据：字段不全或类型不对就不渲染，不猜。
 */
export interface NamespaceRender {
  readonly name: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly quota: { readonly name: string; readonly hard: Readonly<Record<string, string>> };
}

/**
 * 项目命名空间的网络策略按名字取模板（策略的内容在 `packages/k8s`，平台换版改了形状时调和器发现不一致即按新形状改回，
 * 取代启动时的重下发）：默认策略（入向只接网关、出向只到 DNS 与系统命名空间）、任务与构建的出站、接入容器服务槽的出站。
 */
export const NETWORK_POLICY_TEMPLATES = ['crewstation-default', 'crewstation-task-egress', 'crewstation-build-egress', 'crewstation-integration-egress'] as const;
export type NetworkPolicyTemplate = (typeof NETWORK_POLICY_TEMPLATES)[number];

export interface NetworkPolicyRender {
  readonly namespace: string;
  readonly name: NetworkPolicyTemplate;
  /** 默认策略放行的系统命名空间（网关与平台服务所在）。 */
  readonly systemNamespace: string;
}

type Spec = { readonly children: readonly { readonly kind: string; readonly namespace?: string; readonly name: string }[]; readonly [field: string]: unknown };
type Fields = Readonly<Record<string, unknown>>;
const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const isTextMap = (value: unknown): value is Readonly<Record<string, string>> => isFields(value) && Object.values(value).every(text);
const isTemplate = (name: string): name is NetworkPolicyTemplate => (NETWORK_POLICY_TEMPLATES as readonly string[]).includes(name);

/** 从命名空间记录的期望取出渲染输入：一个 Namespace、一个在它里面的 ResourceQuota、标签与额度上限都齐才渲染。 */
export function namespaceRenderOf(spec: Spec): NamespaceRender | undefined {
  const namespaces = spec.children.filter((child) => child.kind === 'Namespace');
  const quotas = spec.children.filter((child) => child.kind === 'ResourceQuota');
  const quota = spec['quota'];
  if (namespaces.length !== 1 || quotas.length !== 1 || !isTextMap(spec['labels']) || !isFields(quota) || !isTextMap(quota['hard'])) return undefined;
  const [namespace] = namespaces, [object] = quotas;
  if (!namespace || !object || object.namespace !== namespace.name || !Object.keys(quota['hard']).length) return undefined;
  return { name: namespace.name, labels: spec['labels'], quota: { name: object.name, hard: quota['hard'] } };
}

/** 从网络策略记录的期望取出每条策略的渲染输入；有一条不认识（没有这个模板）或缺系统命名空间就整条不渲染。 */
export function networkPolicyRendersOf(spec: Spec): readonly NetworkPolicyRender[] | undefined {
  const systemNamespace = spec['systemNamespace'];
  const policies = spec.children.filter((child) => child.kind === 'NetworkPolicy');
  if (!text(systemNamespace) || !policies.length || policies.length !== spec.children.length) return undefined;
  const renders = policies.map((child) => (child.namespace && isTemplate(child.name) ? { namespace: child.namespace, name: child.name, systemNamespace } : undefined));
  return renders.every((entry) => entry !== undefined) ? renders as NetworkPolicyRender[] : undefined;
}
