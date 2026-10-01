import type { ClusterPurpose, ResourceConditionStatus, ResourceKind, StartupRecord } from '@crewstation/contracts';
import { ProjectIdSchema } from '@crewstation/contracts';
import { developmentWorkloadProtection } from './development/protection';
import type { DevelopmentWorkloadProtection } from './development/protection';
import type { ExecutionPurpose, TaskEnvironment, WorkloadRender } from './taskEnvironment';
import { canonicalNativeIntent, EXECUTION_INTENT_ANNOTATION, WORKSPACE_TASK_LABEL } from './physicalIdentity';
import { checkoutSecretOf, podNameFor, purposeOf, reconcilerCreates, runnerSecretOf, WORKLOAD_LABELS, wantsProvisioning } from './taskEnvironment';

/**
 * 任务环境投影到资源台账（RFC-025 第二期）：每个环境一条工作负载记录（开发工作区、业务任务工作区、Agent 执行），
 * 有自己工作卷的再加一条工作卷记录。期望与领域条件由这里算出，阶段由资源中心按观测与条件算，不在这里写。
 */
export interface ProjectedCondition {
  readonly type: string;
  readonly status: ResourceConditionStatus;
  readonly reason?: string;
  readonly message?: string;
  /** 发生时刻（失败的保留期从这里算，D9）；台账只会把已记的起点往早改。 */
  readonly since?: Date;
}

export interface ProjectedRecord {
  /** 工作负载记录沿用环境 ID；工作卷记录由台账生成。 */
  readonly id?: string;
  readonly kind: ResourceKind;
  readonly ref: string;
  /** 平台档位自测没有租户项目；项目镜像验证仍用请求固定的真实项目。 */
  readonly projectId?: TaskEnvironment['projectId'];
  /** 上级记录的 ID：工作负载记录沿用环境 ID，所以 Agent 执行的上级就是父工作区的环境 ID。 */
  readonly parentId?: string;
  readonly purpose?: ClusterPurpose;
  readonly children: readonly { readonly kind: string; readonly namespace: string; readonly name: string }[];
  /** 工作卷上级结束后怎么处理（设计 §6.4）：跟随容器的随之删除，持久卷留着待回收。只有工作卷有。 */
  readonly reclaim?: 'delete' | 'retain';
  readonly display: Readonly<Record<string, string>>;
  readonly conditions: readonly ProjectedCondition[];
  readonly startup?: StartupRecord;
  /** 期望「不要了」及其原因；没有就是「要」。 */
  readonly release?: { readonly code: string; readonly message: string };
  /** 旧身份（设计 §6.5）：RFC-013 之前的 `tsk_…`，写进台账的别名，按旧 ID 也能找回这条记录。 */
  readonly aliases?: readonly { readonly source: 'tsk'; readonly alias: string }[];
  /** 资源中心建出子对象要用的期望（RFC-025 I25，不含凭据）：并进记录的 spec；没有就是所属模块自己建。 */
  readonly render?: Readonly<Record<string, unknown>>;
}

export interface EnvironmentProjection {
  readonly workload: ProjectedRecord;
  readonly volume?: ProjectedRecord;
  readonly route?: ProjectedRecord;
  /** Runner 当前是否连着；是否上报「断开」要看台账里是否曾经连上（资源中心按「曾经为真」判降级）。 */
  readonly connected: boolean;
}

const EXECUTION_PURPOSE: Record<ExecutionPurpose, ClusterPurpose> = { cli: 'development-cli', agent: 'development-agent', subtask: 'business-subtask' };
const RELEASE_MESSAGE: Record<string, string> = {
  user: '用户释放', 'owner-force': '负责人强制释放', business: '业务释放', failed: '失败后释放', 'pod-lost': '容器丢失后释放', 'profile-test': '档位测试结束',
  'retention-expired': '失败保留期已满，平台自动回收',
};
/** 失败会话过了保留期由平台回收（D9）：容器与路由删掉，工作卷不随之删除，只进待回收（D8）。 */
export const RETENTION_EXPIRED = 'retention-expired';
const MAX_MESSAGE = 2000;
const clip = (text: string) => (text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE - 1)}…` : text);

function workloadKind(env: TaskEnvironment): ResourceKind {
  if (env.native || env.kind === 'profile-test') return 'agent-execution';
  return env.kind === 'dev-session' ? 'dev-workspace' : 'business-workspace';
}

function workloadPurpose(env: TaskEnvironment): ClusterPurpose {
  if (env.native) return EXECUTION_PURPOSE[purposeOf(env.native)];
  if (env.kind === 'profile-test') return 'profile-test';
  return env.kind === 'dev-session' ? 'development-workspace' : 'business-workspace';
}

/**
 * 已受理结束：环境在释放或已释放；Agent 执行进入清理或已结束。工作区直接释放时，受理那一步还不知道原因
 * （释放完才把 `released: <原因>` 写进 message），先报泛泛的 released，台账在拿到具体原因时补上。
 */
function releaseOf(env: TaskEnvironment): ProjectedRecord['release'] {
  if (env.render?.developmentUsageProtection !== undefined && env.native?.state === 'cleaning') return undefined;
  const executionEnded = env.native?.state === 'cleaning' || env.native?.state === 'finished';
  if (env.state !== 'releasing' && env.state !== 'released' && !executionEnded) return undefined;
  // 执行环境的说明写结局（进程为何结束），不写「正在回收」这类过程——它在已结束的记录上也一直显示。
  if (env.native) return { code: env.release?.reason ?? 'execution-ended', message: clip(env.native.failureReason ?? '执行已结束') };
  const code = env.release?.reason ?? /^released: ([a-z-]+)$/.exec(env.message ?? '')?.[1] ?? 'released';
  return { code, message: RELEASE_MESSAGE[code] ?? '已释放' };
}

function failureCode(env: TaskEnvironment): string {
  const failed = env.startup?.stages.find((stage) => stage.state === 'failed');
  return failed?.error?.code ?? 'failed';
}

function conditionsOf(env: TaskEnvironment): ProjectedCondition[] {
  const failed = env.state === 'failed';
  const conditions: ProjectedCondition[] = [
    // 判失败的时刻：环境进入 failed 那次落库的时间（之后同一状态的落库只会让台账保留更早的起点）。
    failed ? { type: 'Failed', status: 'true', reason: failureCode(env), message: clip(env.message ?? '平台判定失败'), since: env.updatedAt } : { type: 'Failed', status: 'false' },
    { type: 'Paused', status: env.state === 'paused' ? 'true' : 'false' },
    { type: 'Rebuilding', status: env.rebuildId && env.state === 'creating' ? 'true' : 'false' },
  ];
  if (env.render?.developmentUsageProtection !== undefined) conditions.push({ type: 'ReleasePending', status: env.native?.state === 'cleaning' ? 'true' : 'false', reason: 'development-digital-cleanup-pending', message: '开发数值排空与原执行停止尚未确认' });
  if (env.render?.businessStorage) conditions.push({ type: 'ReleasePending', status: (env.render.completionPolicy && env.businessWorkspace?.phase === 'pausing') || (env.state === 'releasing' && (!!env.native || !!env.release?.occupied)) ? 'true' : 'false', reason: 'execution-cleanup-pending', message: '执行资源尚未完成回收确认' });
  if (env.native) conditions.push({ type: 'Prepared', status: env.native.state === 'queued' ? 'false' : 'true' });
  if (env.render) conditions.push(provisioningOf(env));
  return conditions;
}

/** 要资源中心建出容器（RFC-025 I25）：创建中、还没绑定 Pod 实例时为真；调和器只在它为真时建，Pod 丢了不补建（照旧判容器不存在）。 */
function provisioningOf(env: TaskEnvironment): ProjectedCondition {
  return { type: 'Provisioning', status: wantsProvisioning(env) ? 'true' : 'false' };
}

/**
 * 调和器建 Pod、Runner Secret 与开发预览要用的期望（RFC-025 I25）：镜像、资源、标签、工作卷、检出与 Secret 名；预览的端口与主机。
 * 凭据不在这里：Secret 的内容建的时候向 task-runtime 要（runnerValues）。
 */
function workloadRender(env: TaskEnvironment, protection: DevelopmentWorkloadProtection | undefined): ProjectedRecord['render'] {
  if (!reconcilerCreates(env) && !(protection && env.render?.execution?.creator === 'native')) return undefined;
  const render = env.render!;
  const { image, workerUid, resources, checkout } = render;
  const pod = {
    ...(protection ?? {}),
    ...(protection && env.native?.podUid ? { expectedPodUid: env.native.podUid } : {}),
    ...(render.completionPolicy ? { consumer: { id: render.workloadConsumerId, taskId: env.native?.parentTaskId ?? env.id, revision: render.start, purpose: env.native ? 'agent' : 'business', finalization: null } } : {}),
    ...(env.businessWorkspace ? { expectedVolumeUid: env.businessWorkspace.volumeUid } : {}),
    ...(render.runtimeImage ? { runtimeInitialization: true } : {}),
    ...(render.developmentUsageStorage ? { developmentUsageStorage: render.developmentUsageStorage } : {}),
    ...(render.businessStorage ? { businessStorage: { ...render.businessStorage, initialize: !env.native && !env.rebuildId && render.start === 1 } } : {}),
    image, workerUid, resources, workload: WORKLOAD_LABELS[env.kind], project: env.labels['crewstation.io/project'] ?? '', service: env.labels['crewstation.io/service'] ?? '',
    // 档位测试（I25 第四步）用 Pod 内的临时目录，没有工作卷。
    ...(render.workVolume === 'emptyDir' ? { emptyDir: true } : { pvc: env.pvcName }), secret: runnerSecretOf({ ...env, render }), ...executionRender(env),
    ...(render.rebuild ? { labels: { 'crewstation.io/rebuild': render.rebuild.id }, annotations: { 'crewstation.io/rebuild-intent': render.rebuild.intent }, ...(render.rebuild.nodeName ? { nodeName: render.rebuild.nodeName } : {}) } : {}),
    // 检出（I25）：没带 Secret 名的，凭据 Secret 由资源中心按这一次启动建（ownedCredential），令牌建的时候向本模块要。
    ...(checkout ? { checkout: { repoUrl: checkout.repoUrl, branch: checkout.branch, credentialSecretName: checkoutSecretOf({ ...env, render })!, ...(checkout.credentialSecretName ? {} : { ownedCredential: true }) } } : {}),
  };
  return { pod, ...(render.workloadConsumerId ? { workloadConsumerId: render.workloadConsumerId } : {}), ...(render.rebuild ? { rebuild: render.rebuild } : {}), ...(env.preview ? { preview: { port: env.preview.port, kind: env.kind } } : {}) };
}

/**
 * 执行环境（I25 第二步）：钉在父工作区的节点、挂它的工作卷；Pod 与 Runner Secret 带所属工作区标签和受理意图注解（清理时照它们认领）；
 * 调和器建之前照 workspace 核对父工作区的 Pod 与卷还是受理时那一个。
 */
function executionRender(env: TaskEnvironment): Record<string, unknown> {
  const n = env.native, workspacePod = env.render?.execution?.workspacePod;
  if (!n || !workspacePod) return {};
  return {
    nodeName: n.nodeName, labels: { [WORKSPACE_TASK_LABEL]: n.parentTaskId }, annotations: { [EXECUTION_INTENT_ANNOTATION]: canonicalNativeIntent(env.id, n) },
    workspace: { pod: workspacePod, podUid: n.parentPodUid, pvcUid: n.pvcUid },
  };
}

function workloadDisplay(env: TaskEnvironment): Record<string, string> {
  if (env.native) return { profile: env.native.profile.name, agent: env.native.agentId, ...(env.native.terminalId ? { terminal: env.native.terminalId } : {}) };
  return { profile: env.profile, ...(env.branch ? { branch: env.branch } : {}) };
}

/**
 * 工作负载的子对象（与 task-runtime 建出的名字一一对应）：Pod；执行环境与重建过的工作区另有一个 Runner Secret（`<Pod 名>-runner`）；
 * 有开发预览的工作区另有预览 Service 与 IngressRoute——重建后沿用原路由名（按环境 ID 算），避免同 Host 两条路由（rebuildProvisioner）。
 */
function workloadChildren(env: TaskEnvironment, protection: DevelopmentWorkloadProtection | undefined): ProjectedRecord['children'] {
  const at = (kind: string, name: string) => ({ kind, namespace: env.namespace, name });
  // 资源中心建出的环境（I25）：每次启动一个 Runner Secret（检出用的 Git 凭据由资源中心建的也归这一次启动），预览与 Pod 同名。
  if (reconcilerCreates(env)) {
    const checkout = env.render.checkout && !env.render.checkout.credentialSecretName ? [at('Secret', checkoutSecretOf(env)!)] : [];
    return [at('Pod', env.podName), at('Secret', runnerSecretOf(env)), ...(env.render.completionPolicy || protection ? [at('Secret', `${env.podName}-admission`)] : []), ...checkout, ...(env.preview ? [at('Service', env.rebuildId ? podNameFor(env.id) : env.podName), at('IngressRoute', env.rebuildId ? podNameFor(env.id) : env.podName)] : [])];
  }
  const route = env.rebuildId ? podNameFor(env.id) : env.podName;
  return [
    at('Pod', env.podName), ...(env.native || env.rebuildId ? [at('Secret', `${env.podName}-runner`)] : []),
    ...(protection ? [at('Secret', `${env.podName}-admission`)] : []),
    ...(env.preview && !env.native ? [at('Service', route), at('IngressRoute', route)] : []),
  ];
}

/** 哨兵仅用于平台并发计数；资源归属决定真实项目的可用性与删除准入，不能混用。 */
function workloadProject(env: TaskEnvironment): Pick<ProjectedRecord, 'projectId'> {
  if (env.kind !== 'profile-test') return { projectId: env.projectId };
  if (env.render?.runtimeValidation === undefined) return {};
  return { projectId: ProjectIdSchema.parse(env.render.runtimeValidation.projectId) };
}

export function projectEnvironment(env: TaskEnvironment, previewRoute: WorkloadRender['previewRoute'] = env.render?.previewRoute): EnvironmentProjection {
  const protection = developmentWorkloadProtection(env), render = workloadRender(env, protection);
  const release = releaseOf(env);
  const split = !!env.preview && !env.native && !!previewRoute;
  const workload: ProjectedRecord = {
    id: env.id, kind: workloadKind(env), ref: env.id, ...workloadProject(env),
    ...(env.native ? { parentId: env.native.parentTaskId } : {}),
    purpose: workloadPurpose(env), children: workloadChildren(env, protection).filter((child) => !split || child.kind !== 'IngressRoute'),
    display: workloadDisplay(env), conditions: conditionsOf(env), ...(env.startup ? { startup: env.startup } : {}), ...(release ? { release } : {}),
    ...(env.legacyCluster?.taskId ? { aliases: [{ source: 'tsk' as const, alias: env.legacyCluster.taskId }] } : {}),
    ...(render ? { render } : {}),
  };
  // Agent 执行挂父工作区的卷；档位测试用一次性的空目录。只有工作区自己有工作卷。保留期满回收的会话，卷不随之删除（D8、D9）。
  const ownsVolume = !env.native && env.kind !== 'profile-test';
  const protectedVolume = env.render?.completionPolicy === 'archive-and-delete';
  const volumeReleased = !protectedVolume && release && env.volumeMode === 'follow-container' && release.code !== RETENTION_EXPIRED ? release : undefined;
  const volume: ProjectedRecord | undefined = ownsVolume ? {
    kind: 'volume', ref: `${env.id}/work`, projectId: env.projectId, parentId: env.id,
    children: [{ kind: 'PersistentVolumeClaim', namespace: env.namespace, name: env.pvcName }], reclaim: !protectedVolume && env.volumeMode === 'follow-container' ? 'delete' : 'retain',
    display: { mode: env.volumeMode, ...(protectedVolume ? { completionPolicy: 'archive-and-delete' } : {}) }, conditions: env.render ? [{ ...provisioningOf(env), ...(env.businessWorkspace ? { status: 'false' as const } : {}) }] : [], ...(volumeReleased ? { release: volumeReleased } : {}),
    // 资源中心建出的环境（I25）：卷由调和器照这里建，只在要建出容器时建一次，卷丢了不补建（数据不能凭空换成空卷）。
    ...(protectedVolume || (reconcilerCreates(env) && !env.render.rebuild && !env.businessWorkspace) ? { render: { ...(protectedVolume ? { taskStorage: { taskId: env.id, completionPolicy: 'archive-and-delete' } } : {}),
      ...(reconcilerCreates(env) && !env.render.rebuild && !env.businessWorkspace ? { pvc: { size: env.render.resources.storage, labels: { 'crewstation.io/task': env.id, 'crewstation.io/project': env.labels['crewstation.io/project'] ?? '' } } } : {}) } } : {}),
  } : undefined;
  const name = env.rebuildId ? podNameFor(env.id) : env.podName;
  const route: ProjectedRecord | undefined = split ? {
    kind: 'route', ref: `${env.id}/preview`, projectId: env.projectId, parentId: env.id, purpose: workloadPurpose(env),
    children: [{ kind: 'IngressRoute', namespace: env.namespace, name }], display: { host: previewRoute!.host, entry: 'development-preview' }, conditions: [],
    render: { ...previewRoute, releaseWithParent: true, service: env.labels['crewstation.io/service'] || env.serviceId, target: { namespace: env.namespace, service: name, port: 80 } },
    ...(release ? { release } : {}),
  } : undefined;
  return { workload, ...(volume ? { volume } : {}), ...(route ? { route } : {}), connected: env.connected };
}

/**
 * Runner 连接条件：连着报「连上」；没连着时，台账里曾经连上过才报「断开」（资源中心按「曾经为真、现在为假」判降级），
 * 从没连上过就不报——那是还在启动。
 */
export function runnerCondition(connected: boolean, recorded: readonly { readonly type: string; readonly status: string }[]): ProjectedCondition[] {
  if (connected) return [{ type: 'RunnerConnected', status: 'true' }];
  const previous = recorded.find((condition) => condition.type === 'RunnerConnected');
  return previous && previous.status !== 'false' ? [{ type: 'RunnerConnected', status: 'false', message: 'Runner 已断开' }] : [];
}
