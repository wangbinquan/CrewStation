import type { K8sObject } from '../resources';
import { secretObject, serviceObject } from './cluster';
import { LABELS } from './labels';
import { deploymentObject } from './workloads';

/**
 * 服务槽的渲染输入（release 的部署与资源中心的调和器共用一个构造函数，RFC-025 设计 §6.2）：一个物理槽是同名的一个 Deployment 与一个 Service，
 * 名字 `<服务>-<物理槽>`。选择器只认服务与物理槽——Deployment 的选择器建了就不能改，两边渲染出的必须一样。
 */
export interface ServiceSlotInput {
  readonly namespace: string;
  readonly project: string;
  readonly service: string;
  readonly physical: string;
  readonly releaseId: string;
  readonly image: string;
  readonly command: readonly string[];
  readonly port: number;
  readonly healthPath: string;
  readonly replicas: number;
  readonly resources: { readonly cpu: string; readonly memory: string };
  /** 明文环境变量（旧形状：release 自己部署）；资源中心建的槽环境只从 `envFromSecret` 引用，规格里没有配置与密钥。 */
  readonly env?: Readonly<Record<string, string>>;
  readonly envFromSecret?: string;
  /** Deployment 自己的注解（调和器写渲染它的期望版本）与 Pod 模板的注解（运维重启的标记，一改就重新铺开）。 */
  readonly annotations?: Readonly<Record<string, string>>;
  readonly templateAnnotations?: Readonly<Record<string, string>>;
}

export const slotObjectName = (service: string, physical: string): string => `${service}-${physical}`;

export function serviceSlotObjects(input: ServiceSlotInput): [K8sObject, K8sObject] {
  const name = slotObjectName(input.service, input.physical);
  const selector = { [LABELS.service]: input.service, [LABELS.slot]: input.physical };
  const labels = { [LABELS.project]: input.project, [LABELS.service]: input.service, [LABELS.slot]: input.physical, [LABELS.workload]: 'service', [LABELS.release]: input.releaseId };
  const deployment = deploymentObject({
    name, namespace: input.namespace, labels, selector, replicas: input.replicas, image: input.image, command: [...input.command], port: input.port, healthPath: input.healthPath,
    env: Object.entries(input.env ?? {}).map(([key, value]) => ({ name: key, value })), resources: { cpu: input.resources.cpu, memory: input.resources.memory }, imagePullPolicy: 'Always',
  });
  const template = (deployment.spec as { template: { metadata: Record<string, unknown>; spec: { containers: Array<Record<string, unknown>> } } }).template;
  if (input.envFromSecret) template.spec.containers[0]!.envFrom = [{ secretRef: { name: input.envFromSecret } }];
  if (input.templateAnnotations && Object.keys(input.templateAnnotations).length) template.metadata.annotations = { ...input.templateAnnotations };
  if (input.annotations && Object.keys(input.annotations).length) deployment.metadata.annotations = { ...input.annotations };
  return [deployment, serviceObject({ name, namespace: input.namespace, selector, port: 80, targetPort: input.port, labels })];
}

/** 资源中心建的槽的环境 Secret：不可变，内容是建的时候向 release 要来的（值不落台账）；标签与槽的对象相同。 */
export function serviceSlotSecret(input: Pick<ServiceSlotInput, 'namespace' | 'project' | 'service' | 'physical' | 'releaseId'> & { readonly name: string }, values: Readonly<Record<string, string>>): K8sObject {
  const labels = { [LABELS.project]: input.project, [LABELS.service]: input.service, [LABELS.slot]: input.physical, [LABELS.workload]: 'service', [LABELS.release]: input.releaseId };
  return { ...secretObject({ name: input.name, namespace: input.namespace, stringData: { ...values }, labels }), immutable: true } as K8sObject;
}
