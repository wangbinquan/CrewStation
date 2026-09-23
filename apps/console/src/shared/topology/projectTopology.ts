// 一个项目的部署与运行形态（RFC-019 design §4）：盘点＋槽＋开发会话＋数据资源 → 图。纯函数，位置只由数据顺序决定。
// RFC-025 起，给了资源台账的记录时，开发会话与业务任务两带改由记录组装（recordBands），盘点只补详情。
import type { ClusterResource, DataResourceDto, DevSessionDto, ResourceRecord, SlotDto } from '@crewstation/contracts';
import type { Translate } from '../lib/useT';
import type { Topology, TopologyBand, TopologyEdge, TopologyNode } from '../ui/topology/topologyModel';
import { recordBands } from './recordBands';
import { databaseNode, durationText, factText, podFacts, podStatus, purposeSemantic, workloadStatus } from './topologyText';

/** 概览只有开发摘要（没有预览主机），完整页有整个会话；两者都够组装。 */
export type DevSessionFacts = Pick<DevSessionDto, 'taskId' | 'state' | 'branch'> & { readonly previewHost?: string };

export interface ProjectTopologyInput {
  readonly project: { readonly id: string; readonly name: string; readonly kind: string; readonly namespace: string };
  readonly resources: readonly ClusterResource[];
  readonly slots: readonly SlotDto[];
  readonly devSession?: DevSessionFacts;
  readonly dataResources: readonly DataResourceDto[];
  readonly snapshot: { readonly id: string; readonly observedAt: string; readonly complete: boolean; readonly incompleteReason?: string };
  /** 项目的资源台账记录（RFC-025）：给了就按记录画开发会话与业务任务；不给（集群管理的项目层）仍按盘点。 */
  readonly records?: readonly ResourceRecord[];
}
const LANE = { entry: 0, workload: 1, pod: 2, data: 3 } as const;
const DEV_PURPOSES = new Set(['development-workspace', 'development-cli', 'development-agent']);
const BUSINESS_PURPOSES = new Set(['business-workspace', 'business-subtask']);
const JOB_PURPOSES = new Set(['build', 'migration']);

interface Assembly {
  readonly input: ProjectTopologyInput;
  readonly t: Translate;
  readonly nodes: TopologyNode[];
  readonly edges: TopologyEdge[];
  readonly bands: TopologyBand[];
  readonly pods: readonly ClusterResource[];
  readonly pvcs: readonly ClusterResource[];
  readonly workloads: readonly ClusterResource[];
  readonly production?: DataResourceDto;
  readonly development?: DataResourceDto;
}

function podNode(a: Assembly, r: ClusterResource, band: string, box?: string): TopologyNode {
  const { t } = a, { status, statusText } = podStatus(r, t), age = durationText(r.createdAt, a.input.snapshot.observedAt, t);
  return { id: r.uid, kind: 'pod', semantic: purposeSemantic(r.purpose), title: r.name, subtitle: `${t(`cluster.purpose.${r.purpose}`)}${r.node ? ` · ${t('topology.pod.node', { node: r.node })}` : ''}`, status, statusText, lane: LANE.pod, band, box, abnormal: r.abnormal, resourceId: r.resourceId, purpose: r.purpose,
    meta: [t('topology.pod.restarts', { count: r.restarts }), ...(age ? [t('topology.pod.age', { duration: age })] : [])], facts: podFacts(r, t) };
}

function mountEdges(a: Assembly, pod: ClusterResource, band: string): void {
  const { t } = a;
  for (const pvc of a.pvcs) if (pod.references.includes(`${pvc.namespace}/PersistentVolumeClaim/${pvc.name}`)) {
    if (!a.nodes.some((n) => n.id === pvc.uid)) a.nodes.push({ id: pvc.uid, kind: 'volume', semantic: 'data', title: pvc.name, subtitle: t('topology.volume.subtitle'), status: pvc.phase === 'Bound' ? 'ready' : pvc.abnormal ? 'failed' : 'pending', statusText: pvc.phase || t('topology.status.pending'), lane: LANE.data, band, resourceId: pvc.resourceId, meta: Object.entries(pvc.facts).slice(0, 2).map(([k, v]) => `${k} ${factText(v)}`), facts: Object.entries(pvc.facts).map(([k, v]) => [k, factText(v)] as const) });
    a.edges.push({ from: pod.uid, to: pvc.uid, kind: 'mounts', evidence: 'observed' });
  }
}

/** 两个槽：线上在前，待命在后；每槽一条横带（入口、Deployment、Pod、共用的生产库）。 */
function slotBands(a: Assembly): void {
  const { t, input, production } = a;
  const orderedSlots = [...input.slots].sort((x, y) => Number(y.active) - Number(x.active));
  for (const slot of orderedSlots) {
    const role = slot.active ? 'prod' : 'preview', deployments = a.workloads.filter((r) => r.slotRole === role), slotPods = a.pods.filter((r) => r.slotRole === role);
    const physical = deployments[0]?.physicalSlot ?? slotPods[0]?.physicalSlot ?? slot.name;
    const band = `slot:${role}`;
    a.bands.push({ id: band, title: t(slot.active ? 'topology.band.prod' : 'topology.band.preview', { slot: physical }), semantic: 'service', note: slot.tag ? t(`topology.slot.state.${slot.state}`, { tag: slot.tag }) : t('topology.slot.empty') });
    if (slot.host) {
      a.nodes.push({ id: `route:${role}`, kind: 'route', semantic: 'gateway', title: slot.host, subtitle: input.project.kind === 'DigitalWorker' ? t('topology.route.userDomain') : t('topology.route.serviceDomain'), status: slot.state === 'ready' ? 'ready' : slot.state === 'empty' ? 'idle' : slot.state === 'failed' ? 'failed' : 'pending', statusText: t(`topology.slot.short.${slot.state}`), lane: LANE.entry, band, meta: [t('topology.route.pointsTo', { slot: physical })], facts: [[t('topology.fact.host'), slot.host], [t('topology.fact.slot'), `${physical} · ${role}`], ...(slot.tag ? [[t('topology.fact.version'), `${slot.tag}${slot.commitSha ? ` · ${slot.commitSha.slice(0, 8)}` : ''}`] as const] : [])] });
      for (const d of deployments) a.edges.push({ from: `route:${role}`, to: d.uid, kind: 'routes', label: t(slot.active ? 'topology.edge.label.live' : 'topology.edge.label.standby'), evidence: 'observed' });
    }
    for (const d of deployments) {
      const { status, statusText } = workloadStatus(d, t);
      a.nodes.push({ id: d.uid, kind: 'workload', semantic: 'service', title: d.name, subtitle: `${d.kind}${slot.tag ? ` · ${slot.tag}` : ''}`, status, statusText, lane: LANE.workload, band, box: band, abnormal: d.abnormal, resourceId: d.resourceId, purpose: d.purpose, meta: [t('topology.workload.replicas', { ready: d.readyReplicas ?? 0, desired: d.desired ?? 0 }), ...(d.releaseId ? [`${t('topology.fact.releaseId')} ${d.releaseId.slice(0, 8)}…`] : [])], facts: [[t('topology.fact.kind'), d.kind], [t('topology.fact.slot'), `${physical} · ${role}`], ...(slot.tag ? [[t('topology.fact.version'), slot.tag] as const] : []), [t('topology.workload.replicasLabel'), `${d.readyReplicas ?? 0}／${d.desired ?? 0}`], ...(d.releaseId ? [[t('topology.fact.releaseId'), d.releaseId] as const] : [])] });
      for (const p of slotPods) a.edges.push({ from: d.uid, to: p.uid, kind: 'owns', evidence: 'observed' });
    }
    for (const p of slotPods) { a.nodes.push(podNode(a, p, band, band)); if (production) a.edges.push({ from: p.uid, to: 'db:production', kind: 'uses', label: production.envVar, evidence: 'observed' }); }
    if (slot.active && production) a.nodes.push(databaseNode(production, band, t));
  }
}

/** 按盘点画开发会话：入口是开发预览主机，工作区 Pod 带着它的 CLI／Agent Pod、工作卷与开发库。 */
function inventoryDevBand(a: Assembly): void {
  const { t, input, development } = a;
  const devPods = a.pods.filter((r) => DEV_PURPOSES.has(r.purpose)), session = input.devSession && input.devSession.state !== 'released' ? input.devSession : undefined;
  if (!session && devPods.length === 0) return;
  const band = 'dev';
  a.bands.push({ id: band, title: t('topology.band.dev'), semantic: 'development', note: session ? t('topology.dev.note', { branch: session.branch, agents: devPods.filter((r) => r.purpose !== 'development-workspace').length }) : t('topology.dev.none') });
  const workspace = devPods.find((r) => r.purpose === 'development-workspace');
  if (session?.previewHost) {
    a.nodes.push({ id: 'route:dev', kind: 'route', semantic: 'gateway', title: session.previewHost, subtitle: t('topology.route.devPreview'), status: session.state === 'running' ? 'ready' : session.state === 'failed' ? 'failed' : 'pending', statusText: t(`topology.dev.state.${session.state}`), lane: LANE.entry, band, meta: [t('topology.route.devMembers')], facts: [[t('topology.fact.host'), session.previewHost], [t('topology.fact.taskId'), session.taskId], [t('topology.fact.branch'), session.branch]] });
    if (workspace) a.edges.push({ from: 'route:dev', to: workspace.uid, kind: 'routes', label: t('topology.edge.label.devPreview'), evidence: 'observed' });
  }
  for (const p of [...(workspace ? [workspace] : []), ...devPods.filter((r) => r !== workspace)]) { a.nodes.push(podNode(a, p, band, band)); mountEdges(a, p, band); }
  if (workspace) for (const p of devPods) if (p !== workspace && (!p.parentTaskId || p.parentTaskId === workspace.taskId)) a.edges.push({ from: workspace.uid, to: p.uid, kind: 'child', evidence: 'observed' });
  if (development) { a.nodes.push(databaseNode(development, band, t)); if (workspace) a.edges.push({ from: workspace.uid, to: 'db:development', kind: 'uses', label: t('topology.data.development'), evidence: 'observed' }); }
}

function inventoryBusinessBand(a: Assembly): void {
  const businessPods = a.pods.filter((r) => BUSINESS_PURPOSES.has(r.purpose));
  if (businessPods.length === 0) return;
  a.bands.push({ id: 'business', title: a.t('topology.band.business'), semantic: 'business', note: a.t('topology.business.note', { running: businessPods.filter((r) => r.phase === 'Running').length, waiting: businessPods.filter((r) => r.phase === 'Pending').length }) });
  for (const p of businessPods) { a.nodes.push(podNode(a, p, 'business', 'business')); mountEdges(a, p, 'business'); }
}

/** 按台账记录画开发会话与业务任务（RFC-025）；盘点里这两类 Pod 不再单独成节点。 */
function recordTaskBands(a: Assembly, records: readonly ResourceRecord[]): void {
  const session = a.input.devSession && a.input.devSession.state !== 'released' ? a.input.devSession : undefined;
  const parts = recordBands({ records, resources: a.input.resources, ...(session ? { devSession: session } : {}), ...(a.development ? { development: a.development } : {}), observedAt: a.input.snapshot.observedAt }, a.t);
  a.nodes.push(...parts.nodes); a.edges.push(...parts.edges); a.bands.push(...parts.bands);
}

function jobsBand(a: Assembly): void {
  const { t, production } = a;
  const jobs = a.workloads.filter((r) => JOB_PURPOSES.has(r.purpose)), jobPods = a.pods.filter((r) => JOB_PURPOSES.has(r.purpose));
  if (jobs.length === 0 && jobPods.length === 0) return;
  a.bands.push({ id: 'jobs', title: t('topology.band.jobs'), semantic: 'build' });
  for (const j of jobs) { const { status, statusText } = workloadStatus(j, t); a.nodes.push({ id: j.uid, kind: 'job', semantic: 'build', title: j.name, subtitle: `${j.kind} · ${t(`cluster.purpose.${j.purpose}`)}`, status, statusText, lane: LANE.workload, band: 'jobs', box: 'jobs', abnormal: j.abnormal, resourceId: j.resourceId, purpose: j.purpose, meta: [...(j.releaseId ? [`${t('topology.fact.releaseId')} ${j.releaseId.slice(0, 8)}…`] : [])], facts: [[t('topology.fact.kind'), j.kind], [t('topology.fact.phase'), j.phase], ...(j.releaseId ? [[t('topology.fact.releaseId'), j.releaseId] as const] : [])] }); }
  for (const p of jobPods) {
    a.nodes.push(podNode(a, p, 'jobs', 'jobs'));
    for (const j of jobs) if (p.owners.some((o) => o.uid === j.uid)) a.edges.push({ from: j.uid, to: p.uid, kind: 'owns', evidence: 'observed' });
    if (p.purpose === 'migration' && production) a.edges.push({ from: p.uid, to: 'db:production', kind: 'uses', label: t('topology.edge.label.migration'), evidence: 'observed' });
  }
}

/** 用途待核对的 Pod 不猜成任何一带：单列并标待核对。按记录画任务两带时，这两类 Pod 由记录代表，不再落进这里。 */
function otherBand(a: Assembly, fromRecords: boolean): void {
  const placed = new Set(a.nodes.map((n) => n.id));
  const others = a.pods.filter((r) => !placed.has(r.uid) && !(fromRecords && (DEV_PURPOSES.has(r.purpose) || BUSINESS_PURPOSES.has(r.purpose))));
  if (others.length === 0) return;
  a.bands.push({ id: 'other', title: a.t('topology.band.other'), semantic: 'platform' });
  for (const p of others) a.nodes.push({ ...podNode(a, p, 'other', 'other'), status: 'unknown', statusText: a.t('topology.status.unknown') });
}

export function buildProjectTopology(input: ProjectTopologyInput, t: Translate): Topology {
  const { resources, snapshot } = input;
  const production = input.dataResources.find((d) => d.kind === 'postgres' && d.env === 'production'), development = input.dataResources.find((d) => d.kind === 'postgres' && d.env === 'development');
  const a: Assembly = {
    input, t, nodes: [], edges: [], bands: [], pods: resources.filter((r) => r.kind === 'Pod'), pvcs: resources.filter((r) => r.kind === 'PersistentVolumeClaim'),
    workloads: resources.filter((r) => r.view === 'workloads' && r.topLevel), ...(production ? { production } : {}), ...(development ? { development } : {}),
  };
  slotBands(a);
  if (input.records) recordTaskBands(a, input.records);
  else { inventoryDevBand(a); inventoryBusinessBand(a); }
  jobsBand(a);
  otherBand(a, !!input.records);
  const edgeIds = new Set(a.nodes.map((n) => n.id));
  return { id: `project:${input.project.id}`, title: t('topology.project.title', { name: input.project.name }), lanes: [t('topology.lane.entry'), t('topology.lane.workloads'), t('topology.lane.pods'), t('topology.lane.data')], bands: a.bands, nodes: a.nodes, edges: a.edges.filter((e) => edgeIds.has(e.from) && edgeIds.has(e.to)), observedAt: snapshot.observedAt, complete: snapshot.complete, incompleteReason: snapshot.incompleteReason };
}
