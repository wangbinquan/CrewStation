import type { ObservedObject } from './observation';

type Fields = Readonly<Record<string, unknown>>;
const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);
const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string | undefined => (typeof value === 'string' && value.length > 0 ? value : undefined);

/** 一个 Pod 规格里引用的 Secret 名：容器与 init 容器的 env（secretKeyRef）与 envFrom（secretRef），secret 与 projected 卷，拉镜像凭据。 */
function namesInPodSpec(spec: unknown): string[] {
  if (!isFields(spec)) return [];
  const names: (string | undefined)[] = [];
  for (const container of [...list(spec['containers']), ...list(spec['initContainers'])]) {
    if (!isFields(container)) continue;
    for (const env of list(container['env'])) names.push(isFields(env) && isFields(env['valueFrom']) && isFields(env['valueFrom']['secretKeyRef']) ? text(env['valueFrom']['secretKeyRef']['name']) : undefined);
    for (const from of list(container['envFrom'])) names.push(isFields(from) && isFields(from['secretRef']) ? text(from['secretRef']['name']) : undefined);
  }
  for (const volume of list(spec['volumes'])) {
    if (!isFields(volume)) continue;
    if (isFields(volume['secret'])) names.push(text(volume['secret']['secretName']));
    const sources = isFields(volume['projected']) ? list(volume['projected']['sources']) : [];
    for (const source of sources) names.push(isFields(source) && isFields(source['secret']) ? text(source['secret']['name']) : undefined);
  }
  for (const pull of list(spec['imagePullSecrets'])) names.push(isFields(pull) ? text(pull['name']) : undefined);
  return names.filter((name): name is string => name !== undefined);
}

/**
 * 工作负载引用的 Secret（`命名空间/名字`）：Pod 的规格，Deployment 与 Job 的 Pod 模板（RFC-025 T14）。没有记录认领、也不在这里的 Secret
 * 已没有人用——按服务共用的旧 Git 凭据（`git-checkout-*`、`git-cred-*`，I25 第三步与 T8 之后平台不再写）就是这样。
 */
export function referencedSecrets(workloads: readonly ObservedObject[]): Set<string> {
  const referenced = new Set<string>();
  for (const workload of workloads) {
    const spec = workload.kind === 'Pod' ? workload.spec : isFields(workload.spec) && isFields(workload.spec['template']) ? workload.spec['template']['spec'] : undefined;
    for (const name of namesInPodSpec(spec)) referenced.add(`${workload.metadata.namespace ?? ''}/${name}`);
  }
  return referenced;
}

/** 对象最近一次被写入的时刻：创建时刻与各字段管理者最近一次写入里最晚的（Secret 被原样重写时 managedFields 的时刻会变）。 */
export function lastWrittenAt(object: ObservedObject): number {
  const times = [object.metadata.creationTimestamp, ...(object.metadata.managedFields ?? []).map((field) => field.time)].map((time) => Date.parse(time ?? '')).filter((time) => !Number.isNaN(time));
  return times.length ? Math.max(...times) : Number.NaN;
}
