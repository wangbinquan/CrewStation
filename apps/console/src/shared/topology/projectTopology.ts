// 一个项目的部署与运行形态（RFC-019 design §4）：盘点＋槽＋开发会话＋数据资源 → 图。纯函数，位置只由数据顺序决定。
import type { ClusterResource, DataResourceDto, DevSessionDto, SlotDto } from '@crewstation/contracts';

/** 概览只有开发摘要（没有预览主机），完整页有整个会话；两者都够组装。 */
export type DevSessionFacts = Pick<DevSessionDto, 'taskId' | 'state' | 'branch'> & { readonly previewHost?: string };
import type { Translate } from '../lib/useT';
import type { Topology, TopologyBand, TopologyEdge, TopologyNode } from '../ui/topology/topologyModel';
import { durationText, factText, podFacts, podStatus, purposeSemantic, workloadStatus } from './topologyText';

export interface ProjectTopologyInput {
  readonly project: { readonly id: string; readonly name: string; readonly kind: string; readonly namespace: string };
  readonly resources: readonly ClusterResource[];
  readonly slots: readonly SlotDto[];
  readonly devSession?: DevSessionFacts;
  readonly dataResources: readonly DataResourceDto[];
  readonly snapshot: { readonly id: string; readonly observedAt: string; readonly complete: boolean; readonly incompleteReason?: string };
}
const LANE = { entry: 0, workload: 1, pod: 2, data: 3 } as const;
const DEV_PURPOSES = new Set(['development-workspace', 'development-cli', 'development-agent']);
const BUSINESS_PURPOSES = new Set(['business-workspace', 'business-subtask']);
const JOB_PURPOSES = new Set(['build', 'migration']);

export function buildProjectTopology(input: ProjectTopologyInput, t: Translate): Topology {
  const { resources, snapshot } = input;
  const nodes: TopologyNode[] = [], edges: TopologyEdge[] = [], bands: TopologyBand[] = [];
  const pods = resources.filter((r) => r.kind === 'Pod'), workloads = resources.filter((r) => r.view === 'workloads' && r.topLevel);
  const pvcs = resources.filter((r) => r.kind === 'PersistentVolumeClaim');
  const production = input.dataResources.find((d) => d.kind === 'postgres' && d.env === 'production'), development = input.dataResources.find((d) => d.kind === 'postgres' && d.env === 'development');
  const podNode = (r: ClusterResource, band: string, box?: string): TopologyNode => {
    const { status, statusText } = podStatus(r, t), age = durationText(r.createdAt, snapshot.observedAt, t);
    return { id: r.uid, kind: 'pod', semantic: purposeSemantic(r.purpose), title: r.name, subtitle: `${t(`cluster.purpose.${r.purpose}`)}${r.node ? ` · ${t('topology.pod.node', { node: r.node })}` : ''}`, status, statusText, lane: LANE.pod, band, box, abnormal: r.abnormal, resourceId: r.resourceId, purpose: r.purpose,
      meta: [t('topology.pod.restarts', { count: r.restarts }), ...(age ? [t('topology.pod.age', { duration: age })] : [])], facts: podFacts(r, t) };
  };
  const mountEdges = (pod: ClusterResource, band: string) => {
    for (const pvc of pvcs) if (pod.references.includes(`${pvc.namespace}/PersistentVolumeClaim/${pvc.name}`)) {
      if (!nodes.some((n) => n.id === pvc.uid)) nodes.push({ id: pvc.uid, kind: 'volume', semantic: 'data', title: pvc.name, subtitle: t('topology.volume.subtitle'), status: pvc.phase === 'Bound' ? 'ready' : pvc.abnormal ? 'failed' : 'pending', statusText: pvc.phase || t('topology.status.pending'), lane: LANE.data, band, resourceId: pvc.resourceId, meta: Object.entries(pvc.facts).slice(0, 2).map(([k, v]) => `${k} ${factText(v)}`), facts: Object.entries(pvc.facts).map(([k, v]) => [k, factText(v)] as const) });
      edges.push({ from: pod.uid, to: pvc.uid, kind: 'mounts', evidence: 'observed' });
    }
  };
  // 两个槽：线上在前，待命在后；每槽一条横带（入口、Deployment、Pod、共用的生产库）。
  const orderedSlots = [...input.slots].sort((a, b) => Number(b.active) - Number(a.active));
  for (const slot of orderedSlots) {
    const role = slot.active ? 'prod' : 'preview', deployments = workloads.filter((r) => r.slotRole === role), slotPods = pods.filter((r) => r.slotRole === role);
    const physical = deployments[0]?.physicalSlot ?? slotPods[0]?.physicalSlot ?? slot.name;
    const band = `slot:${role}`;
    bands.push({ id: band, title: t(slot.active ? 'topology.band.prod' : 'topology.band.preview', { slot: physical }), semantic: 'service', note: slot.tag ? t(`topology.slot.state.${slot.state}`, { tag: slot.tag }) : t('topology.slot.empty') });
    if (slot.host) {
      nodes.push({ id: `route:${role}`, kind: 'route', semantic: 'gateway', title: slot.host, subtitle: input.project.kind === 'DigitalWorker' ? t('topology.route.userDomain') : t('topology.route.serviceDomain'), status: slot.state === 'ready' ? 'ready' : slot.state === 'empty' ? 'idle' : slot.state === 'failed' ? 'failed' : 'pending', statusText: t(`topology.slot.short.${slot.state}`), lane: LANE.entry, band, meta: [t('topology.route.pointsTo', { slot: physical })], facts: [[t('topology.fact.host'), slot.host], [t('topology.fact.slot'), `${physical} · ${role}`], ...(slot.tag ? [[t('topology.fact.version'), `${slot.tag}${slot.commitSha ? ` · ${slot.commitSha.slice(0, 8)}` : ''}`] as const] : [])] });
      for (const d of deployments) edges.push({ from: `route:${role}`, to: d.uid, kind: 'routes', label: t(slot.active ? 'topology.edge.label.live' : 'topology.edge.label.standby'), evidence: 'observed' });
    }
    for (const d of deployments) {
      const { status, statusText } = workloadStatus(d, t);
      nodes.push({ id: d.uid, kind: 'workload', semantic: 'service', title: d.name, subtitle: `${d.kind}${slot.tag ? ` · ${slot.tag}` : ''}`, status, statusText, lane: LANE.workload, band, box: band, abnormal: d.abnormal, resourceId: d.resourceId, purpose: d.purpose, meta: [t('topology.workload.replicas', { ready: d.readyReplicas ?? 0, desired: d.desired ?? 0 }), ...(d.releaseId ? [`${t('topology.fact.releaseId')} ${d.releaseId.slice(0, 8)}…`] : [])], facts: [[t('topology.fact.kind'), d.kind], [t('topology.fact.slot'), `${physical} · ${role}`], ...(slot.tag ? [[t('topology.fact.version'), slot.tag] as const] : []), [t('topology.workload.replicasLabel'), `${d.readyReplicas ?? 0}／${d.desired ?? 0}`], ...(d.releaseId ? [[t('topology.fact.releaseId'), d.releaseId] as const] : [])] });
      for (const p of slotPods) edges.push({ from: d.uid, to: p.uid, kind: 'owns', evidence: 'observed' });
    }
    for (const p of slotPods) { nodes.push(podNode(p, band, band)); if (production) edges.push({ from: p.uid, to: 'db:production', kind: 'uses', label: production.envVar, evidence: 'observed' }); }
    if (slot.active && production) nodes.push(dataNode(production, band, t));
  }
  // 开发会话：入口是开发预览主机，工作区 Pod 带着它的 CLI／Agent Pod、工作卷与开发库。
  const devPods = pods.filter((r) => DEV_PURPOSES.has(r.purpose)), session = input.devSession && input.devSession.state !== 'released' ? input.devSession : undefined;
  if (session || devPods.length > 0) {
    const band = 'dev';
    bands.push({ id: band, title: t('topology.band.dev'), semantic: 'development', note: session ? t('topology.dev.note', { branch: session.branch, agents: devPods.filter((r) => r.purpose !== 'development-workspace').length }) : t('topology.dev.none') });
    const workspace = devPods.find((r) => r.purpose === 'development-workspace');
    if (session?.previewHost) {
      nodes.push({ id: 'route:dev', kind: 'route', semantic: 'gateway', title: session.previewHost, subtitle: t('topology.route.devPreview'), status: session.state === 'running' ? 'ready' : session.state === 'failed' ? 'failed' : 'pending', statusText: t(`topology.dev.state.${session.state}`), lane: LANE.entry, band, meta: [t('topology.route.devMembers')], facts: [[t('topology.fact.host'), session.previewHost], [t('topology.fact.taskId'), session.taskId], [t('topology.fact.branch'), session.branch]] });
      if (workspace) edges.push({ from: 'route:dev', to: workspace.uid, kind: 'routes', label: t('topology.edge.label.devPreview'), evidence: 'observed' });
    }
    for (const p of [...(workspace ? [workspace] : []), ...devPods.filter((r) => r !== workspace)]) { nodes.push(podNode(p, band, band)); mountEdges(p, band); }
    if (workspace) for (const p of devPods) if (p !== workspace && (!p.parentTaskId || p.parentTaskId === workspace.taskId)) edges.push({ from: workspace.uid, to: p.uid, kind: 'child', evidence: 'observed' });
    if (development) { nodes.push(dataNode(development, band, t)); if (workspace) edges.push({ from: workspace.uid, to: 'db:development', kind: 'uses', label: t('topology.data.development'), evidence: 'observed' }); }
  }
  const businessPods = pods.filter((r) => BUSINESS_PURPOSES.has(r.purpose));
  if (businessPods.length > 0) {
    bands.push({ id: 'business', title: t('topology.band.business'), semantic: 'business', note: t('topology.business.note', { running: businessPods.filter((r) => r.phase === 'Running').length, waiting: businessPods.filter((r) => r.phase === 'Pending').length }) });
    for (const p of businessPods) { nodes.push(podNode(p, 'business', 'business')); mountEdges(p, 'business'); }
  }
  const jobs = workloads.filter((r) => JOB_PURPOSES.has(r.purpose)), jobPods = pods.filter((r) => JOB_PURPOSES.has(r.purpose));
  if (jobs.length > 0 || jobPods.length > 0) {
    bands.push({ id: 'jobs', title: t('topology.band.jobs'), semantic: 'build' });
    for (const j of jobs) { const { status, statusText } = workloadStatus(j, t); nodes.push({ id: j.uid, kind: 'job', semantic: 'build', title: j.name, subtitle: `${j.kind} · ${t(`cluster.purpose.${j.purpose}`)}`, status, statusText, lane: LANE.workload, band: 'jobs', box: 'jobs', abnormal: j.abnormal, resourceId: j.resourceId, purpose: j.purpose, meta: [...(j.releaseId ? [`${t('topology.fact.releaseId')} ${j.releaseId.slice(0, 8)}…`] : [])], facts: [[t('topology.fact.kind'), j.kind], [t('topology.fact.phase'), j.phase], ...(j.releaseId ? [[t('topology.fact.releaseId'), j.releaseId] as const] : [])] }); }
    for (const p of jobPods) {
      nodes.push(podNode(p, 'jobs', 'jobs'));
      for (const j of jobs) if (p.owners.some((o) => o.uid === j.uid)) edges.push({ from: j.uid, to: p.uid, kind: 'owns', evidence: 'observed' });
      if (p.purpose === 'migration' && production) edges.push({ from: p.uid, to: 'db:production', kind: 'uses', label: t('topology.edge.label.migration'), evidence: 'observed' });
    }
  }
  // 用途待核对的 Pod 不猜成任何一带：单列并标待核对。
  const placed = new Set(nodes.map((n) => n.id)), others = pods.filter((r) => !placed.has(r.uid));
  if (others.length > 0) { bands.push({ id: 'other', title: t('topology.band.other'), semantic: 'platform' }); for (const p of others) nodes.push({ ...podNode(p, 'other', 'other'), status: 'unknown', statusText: t('topology.status.unknown') }); }
  const edgeIds = new Set(nodes.map((n) => n.id));
  return { id: `project:${input.project.id}`, title: t('topology.project.title', { name: input.project.name }), lanes: [t('topology.lane.entry'), t('topology.lane.workloads'), t('topology.lane.pods'), t('topology.lane.data')], bands, nodes, edges: edges.filter((e) => edgeIds.has(e.from) && edgeIds.has(e.to)), observedAt: snapshot.observedAt, complete: snapshot.complete, incompleteReason: snapshot.incompleteReason };
}

function dataNode(d: DataResourceDto, band: string, t: Translate): TopologyNode {
  const status = d.state === 'ready' ? 'ready' : d.state === 'failed' ? 'failed' : d.state === 'releasing' ? 'terminating' : d.state === 'released' ? 'idle' : 'pending';
  return { id: `db:${d.env}`, kind: 'database', semantic: 'data', title: t(d.env === 'production' ? 'topology.data.production' : 'topology.data.development'), subtitle: t('topology.data.plan', { plan: d.plan }), status, statusText: t(`topology.data.state.${d.state}`), lane: 3, band, meta: [t('topology.data.envVar', { name: d.envVar })], facts: [[t('topology.fact.kind'), d.kind], [t('topology.fact.env'), d.env], [t('topology.fact.plan'), d.plan], [t('topology.fact.envVar'), d.envVar], ...(d.message ? [[t('topology.fact.message'), d.message] as const] : [])] };
}
