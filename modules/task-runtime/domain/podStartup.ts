import type { StartupErrorCode, StartupRecord, StartupStage, StartupStageKind } from '@crewstation/contracts';

/**
 * 主容器的等待／终止原因归类（RFC-006 §5.3、§6.2）：镜像拉不下来与容器起不来是两类原因，管理员的处置不同。
 * 档位测试、执行环境对账与启动进度（RFC-022）共用这一份表。
 */
export const IMAGE_PULL_FAILURES: ReadonlySet<string> = new Set(['ErrImagePull', 'ImagePullBackOff', 'InvalidImageName', 'ErrImageNeverPull', 'RegistryUnavailable', 'SignatureValidationFailed']);
export const CONTAINER_START_FAILURES: ReadonlySet<string> = new Set(['CreateContainerError', 'CreateContainerConfigError', 'RunContainerError', 'StartError', 'ContainerCannotRun', 'CrashLoopBackOff']);

export const RUNNER_UNAVAILABLE_HINT = '镜像里可能没有平台 Runner 启动路径 /opt/crewstation/bin/task-runner，请基于平台底座镜像构建';

/** 与 packages/k8s 的 PodStartupObservation 同构（领域层不依赖 k8s 包），适配器原样传入。 */
export interface StartupObservation {
  readonly createdAt?: string;
  readonly node?: string;
  readonly unschedulable?: { readonly reason?: string; readonly message?: string };
  readonly containers: ReadonlyArray<{ readonly name: string; readonly init: boolean; readonly image?: string; readonly waiting?: { readonly reason: string; readonly message?: string }; readonly startedAt?: string; readonly finishedAt?: string; readonly exitCode?: number }>;
  readonly pulls: ReadonlyArray<{ readonly container: string; readonly image?: string; readonly startedAt?: string; readonly endedAt?: string; readonly cached: boolean; readonly took?: string; readonly failure?: string }>;
}

/** 开发会话检出源码的 init 容器名（`adapters/k8s/taskObjects.ts`）。 */
export const CHECKOUT_CONTAINER = 'checkout';

/**
 * RFC-022 §5.2 的三种形状：首次创建（开发会话带检出）、重建、其余（业务任务、档位测试、执行环境）。
 * 执行环境的 ready 由 dev-session 换成准备环境／Agent 启动中／已就绪。
 */
export function initialStartup(at: Date, options: { checkout?: string; rebuild?: boolean } = {}): StartupRecord {
  const kinds: StartupStageKind[] = options.rebuild ? ['queue', 'replace', 'container', 'connect', 'ready']
    : options.checkout === undefined ? ['queue', 'container', 'connect', 'ready'] : ['queue', 'container', 'checkout', 'connect', 'ready'];
  const startedAt = at.toISOString();
  return {
    state: 'running', startedAt,
    stages: kinds.map((kind, index) => ({ kind, state: index === 0 ? 'running' : 'pending', ...(index === 0 ? { startedAt } : {}), ...(kind === 'checkout' ? { subject: options.checkout! } : {}) })),
  };
}

const iso = (value: string): string => new Date(value).toISOString();
/** 结束不早于开始：节点与控制面的时钟、Kubernetes 的整秒时间都可能让结束时间略早。 */
const notBefore = (start: string | undefined, at: string): string => (start && Date.parse(at) < Date.parse(start) ? start : at);

/**
 * 收束一段。成功与跳过的段去掉进行时的说明（「正在克隆分支」「等待 TaskRunner 连接」）与已经过去的警告，
 * 结果说明由调用方另给；失败的段两者都留着，是出错时的现场（2026-09-23 实机：打勾的段还写着「正在克隆」）。
 */
function settle(stage: StartupStage, state: 'succeeded' | 'failed' | 'skipped', at: string): StartupStage {
  const { warning: _warning, detail: _detail, ...rest } = stage;
  const endedAt = notBefore(stage.startedAt, iso(at));
  return { ...(state === 'failed' ? stage : rest), state, endedAt, ...(stage.startedAt ? { durationMs: Date.parse(endedAt) - Date.parse(stage.startedAt) } : {}) };
}

/** 一段成功，下一段从同一刻开始（首尾相接）；下一段是 ready 时一并成功、整体就绪。只进不退：这一段不在进行中就原样返回。 */
export function completeStage(record: StartupRecord, kind: StartupStageKind, at: string, patch: Partial<Pick<StartupStage, 'detail'>> = {}): StartupRecord {
  const index = record.stages.findIndex((stage) => stage.kind === kind);
  if (record.state !== 'running' || record.stages[index]?.state !== 'running') return record;
  const stages = [...record.stages];
  const settled = settle(stages[index]!, 'succeeded', at);
  const done = patch.detail ? { ...settled, detail: patch.detail.slice(0, 1024) } : settled;
  stages[index] = done;
  const next = stages[index + 1], end = done.endedAt!;
  if (!next || next.kind === 'ready') {
    if (next) stages[index + 1] = { ...next, state: 'succeeded', startedAt: end, endedAt: end, durationMs: 0 };
    return { ...record, state: 'ready', stages, endedAt: end };
  }
  stages[index + 1] = { ...next, state: 'running', startedAt: end };
  return { ...record, stages };
}

/** 平台判定失败：当前进行中的段失败并写明原因，整体失败。 */
export function failStartup(record: StartupRecord, at: string, error: { code: StartupErrorCode; message: string }, logTail?: string): StartupRecord {
  const index = record.stages.findIndex((stage) => stage.state === 'running');
  if (record.state !== 'running' || index < 0) return record;
  const stages = [...record.stages];
  stages[index] = { ...settle(stages[index]!, 'failed', at), error: { code: error.code, message: error.message.slice(0, 4096) }, ...(logTail ? { logTail } : {}) };
  return { ...record, state: 'failed', stages, endedAt: stages[index]!.endedAt! };
}

/** 失败发生在 kind 这一段（例如握手被拒一定是在等待连接时）：之前还没收束的段先在这一刻收束，再让 kind 失败。 */
export function failAtStage(record: StartupRecord, kind: StartupStageKind, at: string, error: { code: StartupErrorCode; message: string }, logTail?: string): StartupRecord {
  const previous = record.stages[record.stages.findIndex((stage) => stage.kind === kind) - 1]?.kind;
  return failStartup(previous ? completeThrough(record, previous, at) : record, at, error, logTail);
}

/** 启动中被释放、停止或暂停：进行中的段记为跳过，整体已取消。 */
export function cancelStartup(record: StartupRecord, at: string): StartupRecord {
  if (record.state !== 'running') return record;
  const endedAt = iso(at);
  return { ...record, state: 'cancelled', endedAt, stages: record.stages.map((stage) => (stage.state === 'running' ? settle(stage, 'skipped', endedAt) : stage)) };
}

/**
 * 一直收束到 kind（含）：TaskRunner 连上说明之前各段都已完成，观测还没来得及写的段在这一刻一并成功。
 * 已有 Kubernetes 时间的段在连上之前由观测写好，这里只兜底。
 */
export function completeThrough(record: StartupRecord, kind: StartupStageKind, at: string): StartupRecord {
  const last = record.stages.findIndex((stage) => stage.kind === kind);
  let next = record;
  for (;;) {
    const current = runningStage(next);
    const index = next.stages.findIndex((stage) => stage.kind === current);
    if (!current || index < 0 || index > last) return next;
    next = completeStage(next, current, at);
  }
}

/** 环境直接进入 failed 而调用方没有给归类时，按进行中的段给一个。 */
const DEFAULT_FAILURE: Partial<Record<StartupStageKind, StartupErrorCode>> = {
  queue: 'admission-rejected', replace: 'replace-failed', container: 'container-start-failed', checkout: 'checkout-failed', connect: 'pod-exited',
};
export const defaultFailureCode = (record: StartupRecord): StartupErrorCode => DEFAULT_FAILURE[runningStage(record) ?? 'queue'] ?? 'pod-exited';

/** 进行中的段叫什么：判定失败时决定失败归类，失败时决定读哪个容器的日志。 */
export const runningStage = (record: StartupRecord | undefined): StartupStageKind | undefined => record?.stages.find((stage) => stage.state === 'running')?.kind;

/** 同一个原因在不同的段上归类不同：Pod 在检出时失败是检出失败，在主容器起来之前失败是容器起不来。 */
export function failureCode(record: StartupRecord | undefined, code: StartupErrorCode): StartupErrorCode {
  const kind = runningStage(record);
  if (code === 'pod-exited' && kind === 'checkout') return 'checkout-failed';
  if (code === 'pod-exited' && kind === 'container') return 'container-start-failed';
  return code;
}

/** 观测推进：容器启动中 →（检出代码）→ 等待连接；只写离散变化，计时由页面算。等待连接只由 TaskRunner 连上结束。 */
export function advanceStartup(record: StartupRecord, observation: StartupObservation): StartupRecord {
  if (record.state !== 'running') return record;
  let next = record;
  // 建 Pod 的一方（创建、执行作业、重建作业）会写这一步；Pod 已在而记录没跟上时按 Pod 的创建时间补上。
  const waiting = runningStage(next);
  if ((waiting === 'queue' || waiting === 'replace') && observation.createdAt) next = completeStage(next, waiting, observation.createdAt);
  if (runningStage(next) === 'container') {
    const first = observation.containers.find((container) => container.startedAt);
    if (!first) return patchRunning(next, containerDetail(observation));
    // 完成的这一轮也读了事件：结果说明按这一轮写（调度到的节点、镜像已有或拉取用时），不留上一轮的「创建容器」。
    const result = containerResult(observation);
    next = completeStage(next, 'container', first.startedAt!, result ? { detail: result } : {});
    const checkout = observation.containers.find((container) => container.init && container.name === CHECKOUT_CONTAINER);
    if (runningStage(next) === 'checkout' && !checkout) next = skipRunning(next, iso(first.startedAt!));
  }
  if (runningStage(next) === 'checkout') {
    const init = observation.containers.find((container) => container.init && container.name === CHECKOUT_CONTAINER);
    if (init?.finishedAt && init.exitCode === 0) next = completeStage(next, 'checkout', init.finishedAt);
    else return patchRunning(next, { detail: `正在克隆分支 ${next.stages.find((stage) => stage.kind === 'checkout')?.subject ?? ''}`.trim(), ...(init?.exitCode ? { warning: `检出失败（退出码 ${init.exitCode}）` } : {}) });
  }
  if (runningStage(next) === 'connect') {
    const main = observation.containers.find((container) => !container.init);
    const problem = main?.waiting && CONTAINER_START_FAILURES.has(main.waiting.reason) ? `容器无法启动（${main.waiting.reason}）${main.waiting.message ? `：${main.waiting.message}` : ''}` : undefined;
    return patchRunning(next, { detail: main?.startedAt ? '容器已启动，等待 TaskRunner 连接' : '等待主容器启动', ...(problem ? { warning: problem } : {}) });
  }
  return next;
}

type Pull = StartupObservation['pulls'][number];
const firstPull = (observation: StartupObservation): Pull | undefined => observation.pulls.find((item) => item.container === observation.containers[0]?.name);
const pulledText = (pull: Pull): string => (pull.cached ? '镜像节点上已有' : `镜像已拉取${pull.took ? `（用时 ${pull.took}）` : ''}`);

/** 容器启动中这一段完成时的结果说明：调度到的节点与镜像来源；都不知道时不写。 */
function containerResult(observation: StartupObservation): string | undefined {
  const pull = firstPull(observation);
  const parts = [observation.node ? `已调度到节点 ${observation.node}` : undefined, pull?.endedAt ? pulledText(pull) : undefined].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

/** 容器启动中的细节：调度 → 拉取镜像 → 创建容器；Kubernetes 仍在重试的问题记为警告。 */
function containerDetail(observation: StartupObservation): { detail: string; warning?: string } {
  const target = observation.containers[0];
  const pull = firstPull(observation);
  const parts = [observation.node ? `已调度到节点 ${observation.node}` : '等待调度'];
  if (pull?.endedAt) parts.push(pulledText(pull), '创建容器');
  else if (pull?.startedAt) parts.push(`正在拉取镜像 ${shortImage(pull.image ?? target?.image ?? '')}`);
  else if (observation.node) parts.push('创建容器');
  const waiting = observation.containers.map((container) => container.waiting).find((w) => w && (IMAGE_PULL_FAILURES.has(w.reason) || CONTAINER_START_FAILURES.has(w.reason)));
  const warning = observation.unschedulable ? `调度不上：${observation.unschedulable.message ?? observation.unschedulable.reason ?? '等待调度器给出原因'}`
    : waiting ? `${IMAGE_PULL_FAILURES.has(waiting.reason) ? '镜像拉取失败' : '容器无法创建'}（${waiting.reason}）${waiting.message ? `：${waiting.message}` : ''}`
      : pull?.failure ? `镜像拉取失败：${pull.failure}` : undefined;
  return { detail: parts.join(' · '), ...(warning ? { warning } : {}) };
}

/** 摘要固定的镜像只留前 12 位摘要，免得细节被一长串十六进制撑满。 */
function shortImage(image: string): string {
  const at = image.indexOf('@sha256:');
  return at < 0 ? image : image.slice(0, at + 8 + 12);
}

function patchRunning(record: StartupRecord, patch: { detail: string; warning?: string }): StartupRecord {
  const index = record.stages.findIndex((stage) => stage.state === 'running');
  const stage = record.stages[index];
  if (!stage || (stage.detail === patch.detail && stage.warning === patch.warning)) return record;
  const { warning: _old, ...rest } = stage;
  const stages = [...record.stages];
  stages[index] = { ...rest, detail: patch.detail.slice(0, 1024), ...(patch.warning ? { warning: patch.warning.slice(0, 1024) } : {}) };
  return { ...record, stages };
}

function skipRunning(record: StartupRecord, at: string): StartupRecord {
  const index = record.stages.findIndex((stage) => stage.state === 'running');
  if (index < 0) return record;
  const stages = [...record.stages];
  stages[index] = settle(stages[index]!, 'skipped', at);
  const next = stages[index + 1];
  if (next) stages[index + 1] = { ...next, state: 'running', startedAt: stages[index]!.endedAt! };
  return { ...record, stages };
}
