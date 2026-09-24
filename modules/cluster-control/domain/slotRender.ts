/**
 * 服务槽记录（RFC-025 T8）里调和器建出工作负载要用的期望，release 写、不含配置与密钥：镜像、启动命令、端口、健康检查路径、副本、资源，
 * 这一次部署的环境 Secret 名（`<服务>-<物理槽>-env-<第几次部署>`，内容建的时候向 release 要），运维重启的标记。
 * Deployment、Service 与环境 Secret 的名字取自期望里的子对象，且必须是这个槽的名字。记录是数据：字段不全或类型不对就不渲染，不猜。
 */
export interface SlotRender {
  readonly namespace: string;
  /** Deployment 与 Service 同名：`<服务>-<物理槽>`。 */
  readonly name: string;
  readonly secret: string;
  readonly serviceId: string;
  readonly project: string;
  readonly service: string;
  readonly physical: 'blue' | 'green';
  readonly releaseId: string;
  readonly revision: number;
  readonly image: string;
  readonly command: readonly string[];
  readonly port: number;
  readonly healthPath: string;
  readonly replicas: number;
  readonly resources: { readonly cpu: string; readonly memory: string };
  readonly restartedAt?: string;
}

type Fields = Readonly<Record<string, unknown>>;
type Spec = { readonly children: readonly { readonly kind: string; readonly namespace?: string; readonly name: string }[]; readonly [field: string]: unknown };
const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const count = (value: unknown, min: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min;
const TEXT_FIELDS = ['serviceId', 'project', 'service', 'releaseId', 'image', 'healthPath'] as const;

/** 期望里的子对象：Deployment、Service 各一个、同名同命名空间，是这个槽的名字；环境 Secret 正好一个、就是 envSecret。 */
function namesOf(spec: Spec, slot: Fields): { readonly namespace: string; readonly name: string; readonly secret: string } | undefined {
  const deployment = spec.children.filter((child) => child.kind === 'Deployment'), service = spec.children.filter((child) => child.kind === 'Service');
  const secrets = spec.children.filter((child) => child.kind === 'Secret');
  const name = `${slot['service'] as string}-${slot['physical'] as string}`;
  if (deployment.length !== 1 || service.length !== 1 || secrets.length !== 1) return undefined;
  const [d, s, secret] = [deployment[0]!, service[0]!, secrets[0]!];
  if (!d.namespace || d.name !== name || s.name !== name || s.namespace !== d.namespace || secret.namespace !== d.namespace || secret.name !== slot['envSecret']) return undefined;
  return { namespace: d.namespace, name, secret: secret.name };
}

/** 服务槽记录的渲染输入；没有（旧形状：release 自己部署，或还没部署过）或字段不全都返回 undefined。 */
export function slotRenderOf(spec: Spec): SlotRender | undefined {
  const slot = spec['slot'];
  if (!isFields(slot) || !TEXT_FIELDS.every((key) => text(slot[key])) || !text(slot['envSecret'])) return undefined;
  if (slot['physical'] !== 'blue' && slot['physical'] !== 'green') return undefined;
  if (!count(slot['revision'], 1) || !count(slot['port'], 1) || (slot['port'] as number) > 65535 || !count(slot['replicas'], 0)) return undefined;
  const command = slot['command'], resources = slot['resources'], restartedAt = slot['restartedAt'];
  if (!Array.isArray(command) || !command.length || !command.every(text) || !isFields(resources) || !text(resources['cpu']) || !text(resources['memory'])) return undefined;
  if (restartedAt !== undefined && !text(restartedAt)) return undefined;
  const names = namesOf(spec, slot);
  if (!names) return undefined;
  return {
    ...names, serviceId: slot['serviceId'] as string, project: slot['project'] as string, service: slot['service'] as string, physical: slot['physical'], releaseId: slot['releaseId'] as string,
    revision: slot['revision'] as number, image: slot['image'] as string, command: [...command] as string[], port: slot['port'] as number, healthPath: slot['healthPath'] as string,
    replicas: slot['replicas'] as number, resources: { cpu: resources['cpu'] as string, memory: resources['memory'] as string }, ...(text(restartedAt) ? { restartedAt } : {}),
  };
}
