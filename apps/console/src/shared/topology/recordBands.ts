// RFC-025 设计 §10：形态图的开发会话与业务任务两带改由资源台账的标准记录组装——阶段、原因、子对象都照记录画，
// 页面不再按 Pod 的用途与 Kubernetes 阶段自己推导；盘点快照只用来补详情（镜像、容器表、日志入口）。
import type { ClusterResource, DataResourceDto, ResourceChild, ResourcePhase, ResourceRecord } from '@crewstation/contracts';
import type { Translate } from '../lib/useT';
import type { NodeStatus, TopologyBand, TopologyEdge, TopologyNode } from '../ui/topology/topologyModel';
import { databaseNode, durationText, factText, purposeSemantic } from './topologyText';

/** 形态图用到的开发会话事实：开发预览主机只在会话详情里有。 */
export interface RecordDevSession {
  readonly taskId: string;
  readonly branch: string;
  readonly previewHost?: string;
}

export interface RecordBandInput {
  readonly records: readonly ResourceRecord[];
  /** 盘点快照：按 Pod／PVC 的 UID 补详情，不决定状态。 */
  readonly resources: readonly ClusterResource[];
  readonly devSession?: RecordDevSession;
  readonly development?: DataResourceDto;
  readonly observedAt: string;
}

export interface BandParts {
  readonly nodes: TopologyNode[];
  readonly edges: TopologyEdge[];
  readonly bands: TopologyBand[];
}

const LANE = { entry: 0, pod: 2, data: 3 } as const;
const DEV_EXECUTIONS = new Set(['development-cli', 'development-agent']);
/** 阶段 → 图上的状态：降级按「待处理」着色并标需要关注；结束中是终止中；已结束的记录不画。 */
const PHASE_STATUS: Record<ResourcePhase, NodeStatus> = { pending: 'pending', provisioning: 'pending', starting: 'pending', ready: 'ready', degraded: 'pending', stopping: 'terminating', stopped: 'idle', failed: 'failed' };

export function recordStatus(record: Pick<ResourceRecord, 'phase' | 'reason'>, t: Translate): { status: NodeStatus; statusText: string } {
  const label = t(`resources.phase.${record.phase}`);
  return { status: PHASE_STATUS[record.phase], statusText: record.reason?.message ? `${label} · ${record.reason.message}` : label };
}

const childOf = (record: ResourceRecord, kind: string): ResourceChild | undefined =>
  record.children.find((child) => child.kind === kind && child.phase !== 'absent') ?? record.children.find((child) => child.kind === kind);
const observed = (resources: readonly ClusterResource[], child: ResourceChild | undefined) => (child?.uid ? resources.find((r) => r.uid === child.uid) : undefined);
/** 需要关注：记录失败或降级；另外沿用盘点对同一个 Pod／PVC 的异常判断（例如调度不上，记录仍是「启动中」）。 */
const abnormal = (record: ResourceRecord, inventory: ClusterResource | undefined) => record.phase === 'failed' || record.phase === 'degraded' || inventory?.abnormal === true;

function workloadNode(record: ResourceRecord, band: string, input: RecordBandInput, t: Translate): TopologyNode {
  const pod = childOf(record, 'Pod'), inventory = observed(input.resources, pod), purpose = record.purpose ?? 'unknown';
  // 存活时长只按盘点里 Pod 自己的创建时刻算：记录的创建时刻是它进台账的时刻（补投影时可能晚于 Pod），不代表 Pod 活了多久。
  const { status, statusText } = recordStatus(record, t), age = inventory ? durationText(inventory.createdAt, input.observedAt, t) : undefined;
  const image = inventory?.containers.find((c) => !c.init)?.image;
  const facts: (readonly [string, string])[] = [
    [t('topology.fact.purpose'), t(`cluster.purpose.${purpose}`)], [t('topology.fact.phase'), statusText],
    ...(pod?.node ? [[t('topology.fact.node'), pod.node] as const] : []), [t('topology.fact.restarts'), String(pod?.restarts ?? 0)],
    ...(image ? [[t('topology.fact.image'), image] as const] : []), ...(record.display?.profile ? [[t('topology.fact.profile'), record.display.profile] as const] : []),
    ...(record.display?.branch ? [[t('topology.fact.branch'), record.display.branch] as const] : []), ...(record.display?.agent ? [[t('topology.fact.agentId'), record.display.agent] as const] : []),
    ...(record.display?.terminal ? [[t('topology.fact.terminalId'), record.display.terminal] as const] : []), [t('topology.fact.taskId'), record.id],
    ...(record.parentId ? [[t('topology.fact.parentTaskId'), record.parentId] as const] : []), ...(pod?.uid ? [[t('topology.fact.uid'), pod.uid] as const] : []),
  ];
  return {
    id: record.id, kind: 'pod', semantic: purposeSemantic(purpose), title: pod?.name ?? record.id,
    subtitle: `${t(`cluster.purpose.${purpose}`)}${pod?.node ? ` · ${t('topology.pod.node', { node: pod.node })}` : ''}`,
    status, statusText, lane: LANE.pod, band, box: band, abnormal: abnormal(record, inventory), purpose, ...(inventory ? { resourceId: inventory.resourceId } : {}),
    meta: [t('topology.pod.restarts', { count: pod?.restarts ?? 0 }), ...(age ? [t('topology.pod.age', { duration: age })] : [])], facts,
  };
}

function volumeNode(record: ResourceRecord, band: string, input: RecordBandInput, t: Translate): TopologyNode {
  const pvc = childOf(record, 'PersistentVolumeClaim'), inventory = observed(input.resources, pvc), { status, statusText } = recordStatus(record, t);
  const facts = Object.entries(inventory?.facts ?? {});
  return {
    id: record.id, kind: 'volume', semantic: 'data', title: pvc?.name ?? record.id, subtitle: t('topology.volume.subtitle'), status, statusText, lane: LANE.data, band,
    abnormal: abnormal(record, inventory), ...(inventory ? { resourceId: inventory.resourceId } : {}),
    meta: facts.slice(0, 2).map(([k, v]) => `${k} ${factText(v)}`), facts: [[t('topology.fact.phase'), statusText], ...facts.map(([k, v]) => [k, factText(v)] as const)],
  };
}

/** 一个工作区与挂在它下面的执行、工作卷：工作区 → 执行是从属，工作区与执行都挂着工作区的卷。 */
function workspaceGroup(parts: BandParts, workspace: ResourceRecord, executions: readonly ResourceRecord[], volumes: readonly ResourceRecord[], band: string, input: RecordBandInput, t: Translate): void {
  parts.nodes.push(workloadNode(workspace, band, input, t));
  const mine = executions.filter((execution) => execution.parentId === workspace.id);
  for (const execution of mine) { parts.nodes.push(workloadNode(execution, band, input, t)); parts.edges.push({ from: workspace.id, to: execution.id, kind: 'child', evidence: 'observed' }); }
  for (const volume of volumes.filter((v) => v.parentId === workspace.id)) {
    parts.nodes.push(volumeNode(volume, band, input, t));
    for (const holder of [workspace, ...mine]) parts.edges.push({ from: holder.id, to: volume.id, kind: 'mounts', evidence: 'observed' });
  }
}

/** 最近的放前面；在运行的工作区排在失败保留中的前面（入口与开发库连在它上面）。 */
const byRecency = (a: ResourceRecord, b: ResourceRecord) => Number(a.phase === 'failed') - Number(b.phase === 'failed') || b.createdAt.localeCompare(a.createdAt);

function devBand(parts: BandParts, shown: readonly ResourceRecord[], volumes: readonly ResourceRecord[], input: RecordBandInput, t: Translate): void {
  const workspaces = shown.filter((r) => r.kind === 'dev-workspace').sort(byRecency);
  const executions = shown.filter((r) => r.kind === 'agent-execution' && DEV_EXECUTIONS.has(r.purpose ?? ''));
  if (workspaces.length === 0 && executions.length === 0) return;
  const band = 'dev', main = workspaces[0], session = input.devSession && main && input.devSession.taskId === main.id ? input.devSession : undefined;
  const live = executions.filter((r) => !main || r.parentId === main.id).length;
  parts.bands.push({ id: band, title: t('topology.band.dev'), semantic: 'development', note: main ? t('topology.dev.note', { branch: main.display?.branch ?? session?.branch ?? '', agents: live }) : t('topology.dev.none') });
  if (main && session?.previewHost) {
    const { status, statusText } = recordStatus(main, t);
    parts.nodes.push({ id: 'route:dev', kind: 'route', semantic: 'gateway', title: session.previewHost, subtitle: t('topology.route.devPreview'), status, statusText, lane: LANE.entry, band, meta: [t('topology.route.devMembers')], facts: [[t('topology.fact.host'), session.previewHost], [t('topology.fact.taskId'), main.id], [t('topology.fact.branch'), main.display?.branch ?? session.branch]] });
    parts.edges.push({ from: 'route:dev', to: main.id, kind: 'routes', label: t('topology.edge.label.devPreview'), evidence: 'observed' });
  }
  for (const workspace of workspaces) workspaceGroup(parts, workspace, executions, volumes, band, input, t);
  // 上级工作区不在图上的执行（上级已结束而它还在收尾）单独画出，不丢。
  for (const orphan of executions.filter((r) => !workspaces.some((w) => w.id === r.parentId))) parts.nodes.push(workloadNode(orphan, band, input, t));
  if (input.development) {
    parts.nodes.push(databaseNode(input.development, band, t));
    if (main) parts.edges.push({ from: main.id, to: 'db:development', kind: 'uses', label: t('topology.data.development'), evidence: 'observed' });
  }
}

function businessBand(parts: BandParts, shown: readonly ResourceRecord[], volumes: readonly ResourceRecord[], input: RecordBandInput, t: Translate): void {
  const workspaces = shown.filter((r) => r.kind === 'business-workspace').sort(byRecency);
  const executions = shown.filter((r) => r.kind === 'agent-execution' && r.purpose === 'business-subtask');
  const all = [...workspaces, ...executions];
  if (all.length === 0) return;
  const band = 'business';
  parts.bands.push({ id: band, title: t('topology.band.business'), semantic: 'business', note: t('topology.business.note', { running: all.filter((r) => r.phase === 'ready').length, waiting: all.filter((r) => r.phase === 'pending' || r.phase === 'provisioning' || r.phase === 'starting').length }) });
  for (const workspace of workspaces) workspaceGroup(parts, workspace, executions, volumes, band, input, t);
  for (const orphan of executions.filter((r) => !workspaces.some((w) => w.id === r.parentId))) parts.nodes.push(workloadNode(orphan, band, input, t));
}

/** 开发会话带与业务任务带：只画没结束的记录（已结束的只为推送流的「结束」留在缓存里）。 */
export function recordBands(input: RecordBandInput, t: Translate): BandParts {
  const parts: BandParts = { nodes: [], edges: [], bands: [] };
  const shown = input.records.filter((r) => r.phase !== 'stopped'), volumes = shown.filter((r) => r.kind === 'volume');
  devBand(parts, shown, volumes, input, t);
  businessBand(parts, shown, volumes, input, t);
  return parts;
}
