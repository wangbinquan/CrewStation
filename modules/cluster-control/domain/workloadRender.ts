/**
 * 工作区记录（开发会话、业务任务，RFC-025 I25）里调和器建出容器要用的期望，task-runtime 写、不含凭据：
 * Pod 的镜像、资源、标签、工作卷、检出与 Runner Secret 名；开发预览的端口与主机。Pod 与预览的对象名取自期望里的子对象。
 * 记录是数据：字段不全或类型不对就不渲染，不猜。
 */
export interface WorkloadPodRender {
  readonly name: string;
  readonly namespace: string;
  readonly taskId: string;
  readonly image: string;
  readonly workerUid: number;
  readonly resources: { readonly cpu: string; readonly memory: string; readonly storage: string };
  readonly workload: string;
  readonly project: string;
  readonly service: string;
  readonly pvc: string;
  readonly secret: string;
  readonly checkout?: { readonly repoUrl: string; readonly branch: string; readonly credentialSecretName: string };
  /** 执行环境（I25 第二步）：钉在这个节点，挂父工作区的卷；建之前核对父工作区的 Pod 与卷还是受理时那一个（workspace）。 */
  readonly nodeName?: string;
  readonly workspace?: { readonly pod: string; readonly podUid: string; readonly pvcUid: string };
  /** 所属模块给的附加标签与注解（执行环境的所属工作区、受理意图），Pod 与 Runner Secret 都带；平台自己的标签不能改。 */
  readonly labels?: Readonly<Record<string, string>>;
  readonly annotations?: Readonly<Record<string, string>>;
}

export interface WorkloadPreviewRender {
  readonly name: string;
  readonly namespace: string;
  readonly taskId: string;
  readonly kind: string;
  readonly targetPort: number;
  readonly route?: { readonly host: string; readonly middlewares: readonly { readonly name: string; readonly namespace?: string }[] };
}

export interface WorkloadRender {
  readonly pod: WorkloadPodRender;
  readonly preview?: WorkloadPreviewRender;
}

/** 工作卷记录（I25）：PVC 的大小与标签；对象名与命名空间取自期望里的 PVC 子对象。 */
export interface VolumeRender {
  readonly name: string;
  readonly namespace: string;
  readonly size: string;
  readonly labels: Readonly<Record<string, string>>;
}

type Fields = Readonly<Record<string, unknown>>;
type Spec = { readonly children: readonly { readonly kind: string; readonly namespace?: string; readonly name: string }[]; readonly [field: string]: unknown };
const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const texts = (value: unknown, keys: readonly string[]): value is Fields => isFields(value) && keys.every((key) => text(value[key]));
const labelsOf = (value: unknown): Readonly<Record<string, string>> | undefined => (isFields(value) && Object.values(value).every((entry) => typeof entry === 'string') ? value as Record<string, string> : undefined);

type Middlewares = NonNullable<WorkloadPreviewRender['route']>['middlewares'];
type Extras = Pick<WorkloadPodRender, 'nodeName' | 'workspace' | 'labels' | 'annotations'>;

/** Pod 上平台自己的标签：附加标签不能改它们（身份索引、网络策略与归属都认这些）。 */
const RESERVED_LABELS: ReadonlySet<string> = new Set(['app.kubernetes.io/managed-by', 'crewstation.io/project', 'crewstation.io/service', 'crewstation.io/workload', 'crewstation.io/task']);

/** 执行环境的附加期望：节点、父工作区与附加标签注解；类型不对、改平台标签，或有父工作区却没有节点，都不渲染。 */
function extrasOf(pod: Fields): Extras | undefined {
  const nodeName = pod['nodeName'], workspace = pod['workspace'];
  const labels = pod['labels'] === undefined ? {} : labelsOf(pod['labels']), annotations = pod['annotations'] === undefined ? {} : labelsOf(pod['annotations']);
  if ((nodeName !== undefined && !text(nodeName)) || !labels || !annotations || Object.keys(labels).some((key) => RESERVED_LABELS.has(key))) return undefined;
  if (workspace !== undefined && (!texts(workspace, ['pod', 'podUid', 'pvcUid']) || !text(nodeName))) return undefined;
  return {
    ...(text(nodeName) ? { nodeName } : {}), ...(Object.keys(labels).length ? { labels } : {}), ...(Object.keys(annotations).length ? { annotations } : {}),
    ...(isFields(workspace) ? { workspace: { pod: workspace['pod'] as string, podUid: workspace['podUid'] as string, pvcUid: workspace['pvcUid'] as string } } : {}),
  };
}

function middlewaresOf(value: unknown): Middlewares | undefined {
  if (!Array.isArray(value) || !value.every((entry) => isFields(entry) && text(entry['name']) && (entry['namespace'] === undefined || text(entry['namespace'])))) return undefined;
  return value.map((entry: Fields) => ({ name: entry['name'] as string, ...(text(entry['namespace']) ? { namespace: entry['namespace'] } : {}) }));
}

function podOf(recordId: string, pod: unknown, child: { readonly namespace?: string; readonly name: string } | undefined): WorkloadPodRender | undefined {
  if (!child?.namespace || !texts(pod, ['image', 'workload', 'pvc', 'secret']) || typeof pod['workerUid'] !== 'number' || typeof pod['project'] !== 'string' || typeof pod['service'] !== 'string') return undefined;
  if (!texts(pod['resources'], ['cpu', 'memory', 'storage'])) return undefined;
  const checkout = pod['checkout'], extras = extrasOf(pod);
  if ((checkout !== undefined && !texts(checkout, ['repoUrl', 'branch', 'credentialSecretName'])) || !extras) return undefined;
  const resources = pod['resources'];
  return {
    name: child.name, namespace: child.namespace, taskId: recordId, image: pod['image'] as string, workerUid: pod['workerUid'],
    resources: { cpu: resources['cpu'] as string, memory: resources['memory'] as string, storage: resources['storage'] as string },
    workload: pod['workload'] as string, project: pod['project'], service: pod['service'], pvc: pod['pvc'] as string, secret: pod['secret'] as string,
    ...(checkout ? { checkout: { repoUrl: checkout['repoUrl'] as string, branch: checkout['branch'] as string, credentialSecretName: checkout['credentialSecretName'] as string } } : {}),
    ...extras,
  };
}

function previewOf(recordId: string, preview: unknown, service: { readonly namespace?: string; readonly name: string } | undefined): WorkloadPreviewRender | undefined | false {
  if (preview === undefined) return undefined;
  if (!service?.namespace || !isFields(preview) || typeof preview['port'] !== 'number' || !text(preview['kind'])) return false;
  const route = preview['route'];
  if (route === undefined) return { name: service.name, namespace: service.namespace, taskId: recordId, kind: preview['kind'], targetPort: preview['port'] };
  const middlewares = isFields(route) && text(route['host']) ? middlewaresOf(route['middlewares']) : undefined;
  if (!middlewares || !isFields(route)) return false;
  return { name: service.name, namespace: service.namespace, taskId: recordId, kind: preview['kind'], targetPort: preview['port'], route: { host: route['host'] as string, middlewares } };
}

/** 工作区记录的渲染输入；没有（旧形状：所属模块自己建）或字段不全都返回 undefined。 */
export function workloadRenderOf(recordId: string, spec: Spec): WorkloadRender | undefined {
  const pod = podOf(recordId, spec['pod'], spec.children.find((child) => child.kind === 'Pod'));
  if (!pod) return undefined;
  const preview = previewOf(recordId, spec['preview'], spec.children.find((child) => child.kind === 'Service'));
  if (preview === false) return undefined;
  return { pod, ...(preview ? { preview } : {}) };
}

/** 工作卷记录的渲染输入；没有或字段不全返回 undefined。 */
export function volumeRenderOf(spec: Spec): VolumeRender | undefined {
  const child = spec.children.find((entry) => entry.kind === 'PersistentVolumeClaim'), pvc = spec['pvc'];
  if (!child?.namespace || !isFields(pvc) || !text(pvc['size'])) return undefined;
  const labels = labelsOf(pvc['labels'] ?? {});
  return labels ? { name: child.name, namespace: child.namespace, size: pvc['size'], labels } : undefined;
}

/** 观测缓存里的对象，这里只看用得到的几项。 */
interface Observed {
  readonly metadata: { readonly uid?: string; readonly deletionTimestamp?: string };
  readonly spec?: unknown;
  readonly status?: unknown;
}

/**
 * 执行环境建出之前核对父工作区（与 task-runtime 自己建时同一条前提）：Pod 与卷还是受理时那两个实例、Pod 在运行且在受理时的节点、卷已绑定、
 * 都不在删除中。它们在受理之前就在，调和又只在观测缓存同步之后进行，所以缓存里没有就是已经没了（例如工作区重建换了 Pod），同样算变了。
 * 没有要核对的父工作区（工作区自己）一律算没变。
 */
export function workspaceUnchanged(pod: WorkloadPodRender, workspacePod: Observed | undefined, volume: Observed | undefined): boolean {
  const workspace = pod.workspace;
  if (!workspace) return true;
  if (!workspacePod || !volume) return false;
  const running = (workspacePod.status as { phase?: string } | undefined)?.phase === 'Running', node = (workspacePod.spec as { nodeName?: string } | undefined)?.nodeName;
  const bound = (volume.status as { phase?: string } | undefined)?.phase === 'Bound';
  const podSame = workspacePod.metadata.uid === workspace.podUid && !workspacePod.metadata.deletionTimestamp && running && node === pod.nodeName;
  return podSame && volume.metadata.uid === workspace.pvcUid && !volume.metadata.deletionTimestamp && bound;
}
