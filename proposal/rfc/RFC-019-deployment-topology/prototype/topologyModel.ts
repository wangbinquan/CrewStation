// 部署与运行形态图的数据模型：语义（颜色只表达含义）、状态（不靠颜色单独表达）、连线证据（观测／静态标注分开）。

export type Semantic = 'gateway' | 'security' | 'service' | 'development' | 'business' | 'build' | 'data' | 'platform' | 'external';
export type NodeStatus = 'ready' | 'running' | 'pending' | 'failed' | 'succeeded' | 'terminating' | 'idle' | 'unknown';
export type NodeKind = 'route' | 'workload' | 'pod' | 'database' | 'volume' | 'job' | 'component' | 'external' | 'summary';
export type EdgeKind = 'routes' | 'owns' | 'child' | 'mounts' | 'uses' | 'traffic' | 'control' | 'dial' | 'push';
export type Evidence = 'observed' | 'static';

export interface TopologyNode {
  readonly id: string;
  readonly kind: NodeKind;
  readonly semantic: Semantic;
  readonly title: string;
  readonly subtitle?: string;
  readonly status: NodeStatus;
  /** 状态短语，优先于 STATUS_LABEL；例如「1／1 就绪」「Insufficient cpu」。 */
  readonly statusText?: string;
  readonly lane: number;
  /** 所在横带；横带决定纵向位置，带内按泳道各自向下堆叠。 */
  readonly band: string;
  /** 指定带内的行号；不指定时按出现顺序填入空行。 */
  readonly row?: number;
  /** 所属虚线边界框（横带内可有多个）；入口与数据资源通常在框外同一行。 */
  readonly box?: string;
  /** 节点底部一行小字事实：副本、重启、时长。 */
  readonly meta?: readonly string[];
  /** 详情面板的名值对。 */
  readonly facts?: readonly (readonly [string, string])[];
  readonly purpose?: string;
  readonly abnormal?: boolean;
  /** 集群项目层：卡片上的计数行（最多三行）。 */
  readonly counts?: readonly (readonly [string, string])[];
}

export interface TopologyBox { readonly id: string; readonly title?: string; readonly semantic?: Semantic; readonly note?: string }
export interface TopologyBand { readonly id: string; readonly title: string; readonly semantic: Semantic; readonly note?: string; readonly boxes?: readonly TopologyBox[] }
export interface TopologyEdge { readonly from: string; readonly to: string; readonly kind: EdgeKind; readonly label?: string; readonly evidence: Evidence }
export interface Topology {
  readonly id: string;
  readonly title: string;
  readonly lanes: readonly string[];
  readonly bands: readonly TopologyBand[];
  readonly nodes: readonly TopologyNode[];
  readonly edges: readonly TopologyEdge[];
  readonly observedAt: string;
  readonly complete: boolean;
  readonly incompleteReason?: string;
}

export const SEMANTIC_LABEL: Record<Semantic, string> = {
  gateway: '网关入口', security: '身份与安全', service: '服务槽', development: '开发会话', business: '业务任务',
  build: '构建与迁移', data: '数据与存储', platform: '平台组件', external: '外部系统',
};
export const STATUS_LABEL: Record<NodeStatus, string> = {
  ready: '就绪', running: '运行中', pending: '等待中', failed: '失败', succeeded: '已完成', terminating: '终止中', idle: '空置', unknown: '待核对',
};
export const EDGE_LABEL: Record<EdgeKind, string> = {
  routes: '路由到', owns: '管理', child: '从属', mounts: '挂载', uses: '连接', traffic: '调用', control: '控制', dial: '回连', push: '推送',
};
export const STATUS_ORDER: readonly NodeStatus[] = ['failed', 'pending', 'unknown', 'terminating', 'running', 'ready', 'succeeded', 'idle'];

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';
export function statusTone(status: NodeStatus): Tone {
  switch (status) {
    case 'ready': return 'success';
    case 'running': return 'info';
    case 'pending': case 'unknown': return 'warning';
    case 'failed': return 'danger';
    default: return 'neutral';
  }
}

/** 焦点集合：节点自身与所有直接相连的节点。 */
export function neighbours(topology: Topology, id: string): ReadonlySet<string> {
  const set = new Set<string>([id]);
  for (const edge of topology.edges) { if (edge.from === id) set.add(edge.to); if (edge.to === id) set.add(edge.from); }
  return set;
}

export interface TopologyFilter { readonly semantics?: ReadonlySet<Semantic>; readonly statuses?: ReadonlySet<NodeStatus>; readonly abnormalOnly?: boolean }
export function matchesFilter(node: TopologyNode, filter: TopologyFilter): boolean {
  if (filter.semantics && filter.semantics.size > 0 && !filter.semantics.has(node.semantic)) return false;
  if (filter.statuses && filter.statuses.size > 0 && !filter.statuses.has(node.status)) return false;
  if (filter.abnormalOnly && !node.abnormal) return false;
  return true;
}

export interface SemanticCount { readonly semantic: Semantic; readonly count: number }
export function semanticCounts(topology: Topology): readonly SemanticCount[] {
  const counts = new Map<Semantic, number>();
  for (const node of topology.nodes) counts.set(node.semantic, (counts.get(node.semantic) ?? 0) + 1);
  return (Object.keys(SEMANTIC_LABEL) as Semantic[]).filter((s) => counts.has(s)).map((semantic) => ({ semantic, count: counts.get(semantic)! }));
}

/** 概览缩略：每个横带汇成一张卡（最差状态、Pod 与就绪数、需要关注数），一行铺满宽度；点卡片进完整形态。 */
export function bandSummaryTopology(topology: Topology): Topology {
  const nodes: TopologyNode[] = topology.bands.map((band, lane) => {
    const members = topology.nodes.filter((node) => node.band === band.id);
    const pods = members.filter((node) => node.kind === 'pod');
    const worst = STATUS_ORDER.find((status) => members.some((node) => node.status === status)) ?? 'idle';
    const abnormal = members.filter((node) => node.abnormal).length;
    const byStatus = statusCounts({ ...topology, nodes: members }).map(([status, count]) => `${count} ${STATUS_LABEL[status]}`).join(' · ');
    return {
      id: `band:${band.id}`, kind: 'summary', semantic: band.semantic, title: band.title, subtitle: band.note, status: worst,
      statusText: abnormal > 0 ? `${abnormal} 个需要关注` : STATUS_LABEL[worst], lane, band: 'summary', abnormal: abnormal > 0,
      counts: [['Pod', pods.length > 0 ? `${pods.length} · ${pods.filter((pod) => pod.status === 'ready').length} 就绪` : '无'], ['状态', byStatus || '空'], ['节点', `${members.length}`]],
    };
  });
  return { ...topology, id: `${topology.id}-summary`, lanes: topology.bands.map(() => ''), bands: [{ id: 'summary', title: '', semantic: 'platform' }], nodes, edges: [] };
}

export function statusCounts(topology: Topology): readonly (readonly [NodeStatus, number])[] {
  const counts = new Map<NodeStatus, number>();
  for (const node of topology.nodes) counts.set(node.status, (counts.get(node.status) ?? 0) + 1);
  return STATUS_ORDER.filter((s) => counts.has(s)).map((status) => [status, counts.get(status)!] as const);
}
