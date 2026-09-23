/**
 * 把还用着旧地址（kindnet 从节点 podCIDR 分配）的 Pod 全部重建到 Calico 的地址池上。calico-cni.sh 装好 Calico、删掉 kindnet 之后调用。
 *
 * 有控制器的 Pod 按依赖分四批删掉、由控制器重建；每批等它们的工作负载重新就绪再走下一批：
 *   系统组件 → 平台底座（数据库、镜像仓库、指标、构建）→ 网关与平台服务 → 各项目的服务槽与接入容器。
 * 用删 Pod 而不是滚动重启：本机单节点的 CPU 请求几乎占满，滚动时多出来的新 Pod 会一直 Pending。
 *
 * 没有控制器的任务 Pod 不直接删——删了之后对账只会把记录判成失败。改为以管理员身份走集群管理的运维操作（RFC-010），
 * 由所属领域处理：开发会话按「管理员重启工作区」换新容器、保留工作卷，会话里的 CLI 与历史 Agent 随之结束，要重开；
 * 业务任务能重启就重启，否则删除；档位测试删除。
 *
 * 用法：bun deploy/local/rebuild-old-range-pods.ts --prefix 10.244.0. [--context docker-desktop]
 *       [--console http://console.cs.localhost] [--dry-run]
 * 退出码：0 旧地址上已经没有 Pod；2 还有留下的（逐个列出，calico-cni.sh 据此保留 kindnet 的地址转换链）；其他为出错。
 */
import { join } from 'node:path';
import type { ClusterOps, TaskResource } from './platform-admin-session';
import { adminSession, httpClusterOps } from './platform-admin-session';

interface RawPod {
  metadata?: { namespace?: string; name?: string; uid?: string; deletionTimestamp?: string; labels?: Record<string, string>; ownerReferences?: { kind?: string; name?: string; controller?: boolean }[] };
  spec?: { hostNetwork?: boolean };
  status?: { podIP?: string; phase?: string; conditions?: { type?: string; status?: string }[] };
}
export interface PodList { items?: RawPod[] }

export interface PodRow {
  namespace: string; name: string; uid: string; ip: string; phase: string; ready: boolean; terminating: boolean; hostNetwork: boolean;
  owner?: { kind: string; name: string }; templateHash?: string;
}
export interface Workload { namespace: string; kind: 'Deployment' | 'StatefulSet' | 'DaemonSet'; name: string }
export interface Wave { title: string; pods: PodRow[]; workloads: Workload[] }
export interface RebuildPlan { waves: Wave[]; tasks: PodRow[] }

export function parsePods(list: PodList): PodRow[] {
  return (list.items ?? []).map((pod) => {
    const meta = pod.metadata ?? {}, owner = meta.ownerReferences?.find((ref) => ref.controller && ref.kind && ref.name);
    const hash = meta.labels?.['pod-template-hash'];
    return {
      namespace: meta.namespace ?? '', name: meta.name ?? '', uid: meta.uid ?? '', ip: pod.status?.podIP ?? '', phase: pod.status?.phase ?? '',
      ready: pod.status?.conditions?.some((c) => c.type === 'Ready' && c.status === 'True') ?? false,
      terminating: !!meta.deletionTimestamp, hostNetwork: !!pod.spec?.hostNetwork,
      ...(owner ? { owner: { kind: owner.kind!, name: owner.name! } } : {}), ...(hash ? { templateHash: hash } : {}),
    };
  });
}

/** 还在旧网段上、还在用网络的 Pod：跳过 hostNetwork、正在终止的和已经结束的（结束的 Pod 状态里可能还留着地址）。 */
export function oldRangePods(pods: readonly PodRow[], prefix: string): PodRow[] {
  return pods.filter((pod) => !pod.hostNetwork && !pod.terminating && ['Running', 'Pending'].includes(pod.phase) && pod.ip.startsWith(prefix));
}

/** Pod 所属的工作负载；ReplicaSet 按 pod-template-hash 还原成 Deployment。Job 与自管的 ReplicaSet 返回 undefined：删掉即可，不等。 */
export function workloadOf(pod: PodRow): Workload | undefined {
  const owner = pod.owner;
  if (!owner) return undefined;
  if (owner.kind === 'StatefulSet' || owner.kind === 'DaemonSet') return { namespace: pod.namespace, kind: owner.kind, name: owner.name };
  if (owner.kind === 'ReplicaSet' && pod.templateHash && owner.name.endsWith(`-${pod.templateHash}`)) {
    return { namespace: pod.namespace, kind: 'Deployment', name: owner.name.slice(0, -(pod.templateHash.length + 1)) };
  }
  return undefined;
}

const SYSTEM_NAMESPACES = new Set(['kube-system', 'local-path-storage']);
const PLATFORM_NAMESPACE = 'crewstation-system';
const PLATFORM_BASE = new Set(['postgres', 'registry', 'prometheus', 'buildkitd']);
const WAVE_TITLES = ['系统组件（kube-system、local-path-storage）', '平台底座（数据库、镜像仓库、指标、构建）', '网关与平台服务', '各项目的服务槽与接入容器'];

function waveOf(pod: PodRow): number {
  if (SYSTEM_NAMESPACES.has(pod.namespace)) return 0;
  if (pod.namespace === PLATFORM_NAMESPACE) return PLATFORM_BASE.has(workloadOf(pod)?.name ?? '') ? 1 : 2;
  return 3;
}

const sameWorkload = (a: Workload, b: Workload) => a.namespace === b.namespace && a.kind === b.kind && a.name === b.name;

/** 有控制器的按依赖分批；没有控制器的是任务 Pod，交给集群管理。 */
export function planRebuild(pods: readonly PodRow[]): RebuildPlan {
  const waves: Wave[] = WAVE_TITLES.map((title) => ({ title, pods: [], workloads: [] }));
  const tasks: PodRow[] = [];
  for (const pod of pods) {
    if (!pod.owner) { tasks.push(pod); continue; }
    const wave = waves[waveOf(pod)]!, workload = workloadOf(pod);
    wave.pods.push(pod);
    if (workload && !wave.workloads.some((w) => sameWorkload(w, workload))) wave.workloads.push(workload);
  }
  return { waves, tasks };
}

export type TaskChoice = { kind: 'run'; action: 'restart' | 'delete' } | { kind: 'follow' } | { kind: 'skip'; reason: string };

/** 各用途依次尝试的动作；不在表里的用途不由迁移处理。 */
const PREFERRED: Readonly<Record<string, readonly ('restart' | 'delete')[]>> = {
  'development-workspace': ['restart'], 'development-cli': ['restart'], 'development-agent': ['restart'],
  'business-workspace': ['restart', 'delete'], 'business-subtask': ['restart', 'delete'], 'profile-test': ['delete'],
};
const PURPOSE_ORDER = ['development-workspace', 'business-workspace', 'business-subtask', 'development-cli', 'development-agent', 'profile-test'];

/** 开发会话先重启：它会结束会话里的 CLI 与历史 Agent，这些随会话走（follow），不再单独处理。 */
export function taskAction(resource: TaskResource | undefined, restartedWorkspaces: ReadonlySet<string>): TaskChoice {
  if (!resource) return { kind: 'skip', reason: '集群管理的盘点里找不到它' };
  const child = resource.purpose === 'development-cli' || resource.purpose === 'development-agent';
  if (child && resource.parentTaskId && restartedWorkspaces.has(resource.parentTaskId)) return { kind: 'follow' };
  const preferred = PREFERRED[resource.purpose];
  if (!preferred) return { kind: 'skip', reason: `用途 ${resource.purpose} 不由迁移处理` };
  for (const action of preferred) if (resource.availableActions.find((a) => a.action === action)?.enabled) return { kind: 'run', action };
  const refused = resource.availableActions.find((a) => preferred.includes(a.action as 'restart' | 'delete'));
  return { kind: 'skip', reason: refused?.reason || '集群管理没有给出可用的重启或删除' };
}

export interface Kube {
  pods(): Promise<PodList>;
  deletePod(namespace: string, name: string): Promise<void>;
  desiredReplicas(workload: Workload): Promise<number>;
}
export interface RebuildDeps {
  kube: Kube; ops: () => Promise<ClusterOps>; prefix: string; dryRun?: boolean;
  log: (line: string) => void; sleep?: (ms: number) => Promise<void>; now?: () => number; waveTimeoutMs?: number; taskTimeoutMs?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const describe = (pod: PodRow) => `${pod.namespace} ${pod.name}`;

async function waitUntil(deps: RebuildDeps, timeoutMs: number, done: () => Promise<string | undefined>): Promise<void> {
  const sleep = deps.sleep ?? defaultSleep, now = deps.now ?? Date.now, deadline = now() + timeoutMs;
  for (;;) {
    const pending = await done();
    if (pending === undefined) return;
    if (now() >= deadline) throw new Error(`等待超时：${pending}`);
    await sleep(2000);
  }
}

/** 一批删掉之后，每个工作负载都要有足够的新 Pod 就绪：不是刚删掉的那些、也不在旧网段上。 */
async function rebuildWave(wave: Wave, deps: RebuildDeps): Promise<void> {
  const desired = new Map<Workload, number>();
  for (const workload of wave.workloads) desired.set(workload, await deps.kube.desiredReplicas(workload));
  for (const pod of wave.pods) await deps.kube.deletePod(pod.namespace, pod.name);
  const deleted = new Set(wave.pods.map((pod) => pod.uid));
  await waitUntil(deps, deps.waveTimeoutMs ?? 300_000, async () => {
    const pods = parsePods(await deps.kube.pods());
    const replacement = (p: PodRow, workload: Workload) => {
      const owner = workloadOf(p);
      return !!owner && sameWorkload(owner, workload) && p.ready && !p.terminating && !deleted.has(p.uid) && !p.ip.startsWith(deps.prefix);
    };
    const short = wave.workloads.flatMap((workload) => {
      const ready = pods.filter((p) => replacement(p, workload)).length, want = desired.get(workload)!;
      return ready >= want ? [] : [`${workload.namespace}/${workload.kind}/${workload.name} 就绪 ${ready}/${want}`];
    });
    return short.length ? short.join('，') : undefined;
  });
}

async function rebuildTasks(tasks: readonly PodRow[], deps: RebuildDeps): Promise<void> {
  let ops: ClusterOps;
  try { ops = await deps.ops(); } catch (error) {
    deps.log(`  无法以管理员身份使用集群管理（${error instanceof Error ? error.message : String(error)}），这些任务 Pod 留在旧地址上：`);
    for (const pod of tasks) deps.log(`    ${describe(pod)}`);
    return;
  }
  const found = new Map<PodRow, TaskResource | undefined>();
  for (const pod of tasks) found.set(pod, await ops.findPod(pod));
  const rank = (pod: PodRow) => { const at = PURPOSE_ORDER.indexOf(found.get(pod)?.purpose ?? ''); return at < 0 ? PURPOSE_ORDER.length : at; };
  // restarted：已重启的开发会话（其 CLI 随之结束）；awaited：之后要等它离开旧地址的 Pod——跳过的与执行失败的不等。
  const restarted = new Set<string>(), awaited = new Set<string>();
  for (const pod of [...tasks].sort((a, b) => rank(a) - rank(b))) {
    const resource = found.get(pod), choice = taskAction(resource, restarted), label = `${describe(pod)}（${resource?.purpose ?? '未知用途'}）`;
    if (choice.kind === 'skip') { deps.log(`  跳过 ${label}：${choice.reason}`); continue; }
    if (choice.kind === 'follow') { deps.log(`  ${label} 随所在的开发会话结束`); awaited.add(pod.uid); continue; }
    const verb = choice.action === 'restart' ? '重启' : '删除';
    const result = deps.dryRun ? { phase: 'succeeded', reason: '' } : await ops.run(resource!, choice.action, `calico-migration:${pod.uid}:${choice.action}`);
    deps.log(deps.dryRun ? `  将${verb} ${label}` : `  ${verb} ${label}：${result.phase}${result.reason ? `（${result.reason}）` : ''}`);
    if (result.phase !== 'succeeded') continue;
    awaited.add(pod.uid);
    if (resource!.purpose === 'development-workspace' && resource!.taskId) restarted.add(resource!.taskId);
  }
  if (deps.dryRun || !awaited.size) return;
  // 会话里的 CLI 由平台的执行清理收走，业务任务由各自领域收走；等这些旧 Pod 都离开旧地址。
  const uids = awaited;
  await waitUntil(deps, deps.taskTimeoutMs ?? 300_000, async () => {
    const left = oldRangePods(parsePods(await deps.kube.pods()), deps.prefix).filter((pod) => uids.has(pod.uid));
    return left.length ? `任务 Pod 还在旧地址上：${left.map(describe).join('，')}` : undefined;
  }).catch((error: unknown) => deps.log(`  ${error instanceof Error ? error.message : String(error)}`));
}

/** 按计划重建，返回之后仍在旧地址上的 Pod。 */
export async function rebuildOldRangePods(deps: RebuildDeps): Promise<PodRow[]> {
  const plan = planRebuild(oldRangePods(parsePods(await deps.kube.pods()), deps.prefix));
  for (const [index, wave] of plan.waves.entries()) {
    if (!wave.pods.length) continue;
    deps.log(`第 ${index + 1} 批：${wave.title}`);
    for (const pod of wave.pods) deps.log(`  ${deps.dryRun ? '将删除' : '删除'} ${describe(pod)}`);
    if (!deps.dryRun) await rebuildWave(wave, deps);
  }
  if (plan.tasks.length) {
    deps.log('任务 Pod：走集群管理的运维操作');
    await rebuildTasks(plan.tasks, deps);
  }
  return deps.dryRun ? [] : oldRangePods(parsePods(await deps.kube.pods()), deps.prefix);
}

async function kubectl(binary: string, args: readonly string[]): Promise<string> {
  const child = Bun.spawn([binary, ...args], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const [status, out, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (status !== 0) throw new Error(`kubectl ${args.join(' ')}：${error.trim() || `退出码 ${status}`}`);
  return out;
}

export function kubectlAdapter(context: string, binary = 'kubectl'): Kube {
  const kc = (...args: string[]) => kubectl(binary, ['--context', context, ...args]);
  return {
    pods: async () => JSON.parse(await kc('get', 'pods', '-A', '-o', 'json')) as PodList,
    deletePod: async (namespace, name) => { await kc('-n', namespace, 'delete', 'pod', name, '--wait=false', '--ignore-not-found'); },
    desiredReplicas: async (workload) => {
      const path = workload.kind === 'DaemonSet' ? '{.status.desiredNumberScheduled}' : '{.spec.replicas}';
      return Number(await kc('-n', workload.namespace, 'get', workload.kind.toLowerCase(), workload.name, '-o', `jsonpath=${path}`)) || 0;
    },
  };
}

function option(args: readonly string[], name: string, fallback?: string): string {
  const at = args.indexOf(name), value = at >= 0 ? args[at + 1] : fallback;
  if (!value) throw new Error(`缺少 ${name}`);
  return value;
}

export interface MainDeps {
  kube: (context: string) => Kube;
  ops: (consoleUrl: string) => () => Promise<ClusterOps>;
  out: (line: string) => void;
  err: (line: string) => void;
}

const realDeps: MainDeps = {
  kube: (context) => kubectlAdapter(context),
  ops: (consoleUrl) => async () => {
    const http = { fetch, consoleUrl, root: join(import.meta.dir, '../..'), env: process.env, sleep: defaultSleep, now: Date.now };
    return httpClusterOps(http, await adminSession(http));
  },
  out: (line) => console.log(line), err: (line) => console.error(line),
};

/** 命令行入口；返回退出码（见文件头）。 */
export async function main(args: readonly string[], env: Record<string, string | undefined>, deps: MainDeps = realDeps): Promise<number> {
  const dryRun = args.includes('--dry-run');
  const leftovers = await rebuildOldRangePods({
    kube: deps.kube(option(args, '--context', env.CREWSTATION_KUBE_CONTEXT ?? 'docker-desktop')),
    ops: deps.ops(option(args, '--console', env.CS_CONSOLE_URL ?? 'http://console.cs.localhost')),
    prefix: option(args, '--prefix'), dryRun, log: deps.out,
  });
  if (leftovers.length) {
    deps.err('还在旧地址上的 Pod：');
    for (const pod of leftovers) deps.err(`    ${describe(pod)}`);
    return 2;
  }
  deps.out(dryRun ? '（只列计划，没有执行）' : '旧地址上已经没有 Pod');
  return 0;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2), process.env));
