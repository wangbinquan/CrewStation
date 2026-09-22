// 形态图的数据模型（RFC-019）：语义只决定颜色，状态另有非颜色提示，连线分观测与静态两种证据。无业务含义，文案由调用方经 i18n 提供。

export const SEMANTICS = ['gateway', 'security', 'service', 'development', 'business', 'build', 'data', 'platform', 'external'] as const;
export type Semantic = typeof SEMANTICS[number];
/** 排在前面的状态更需要关注：图例、横带汇总的「最差状态」都按这个顺序取。 */
export const STATUS_ORDER = ['failed', 'pending', 'unknown', 'terminating', 'running', 'ready', 'succeeded', 'idle'] as const;
export type NodeStatus = typeof STATUS_ORDER[number];
export type NodeKind = 'route' | 'workload' | 'pod' | 'database' | 'volume' | 'job' | 'component' | 'external' | 'summary';
export const EDGE_KINDS = ['routes', 'owns', 'child', 'mounts', 'uses', 'traffic', 'control', 'dial', 'push'] as const;
export type EdgeKind = typeof EDGE_KINDS[number];
export type Evidence = 'observed' | 'static';

export interface TopologyNode {
  readonly id: string;
  readonly kind: NodeKind;
  readonly semantic: Semantic;
  readonly title: string;
  readonly subtitle?: string;
  readonly status: NodeStatus;
  /** 状态短语，优先于状态名；例如「1／1 就绪」「Insufficient cpu」原样保留。 */
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
  /** 高卡片上的计数行（项目层、横带汇总），最多三行。 */
  readonly counts?: readonly (readonly [string, string])[];
  readonly abnormal?: boolean;
  /** 指向盘点快照里的资源，详情按它读取；聚合卡没有。 */
  readonly resourceId?: string;
  readonly purpose?: string;
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
export function hasFilter(filter: TopologyFilter): boolean { return Boolean(filter.semantics?.size || filter.statuses?.size || filter.abnormalOnly); }

export function semanticCounts(topology: Topology): readonly (readonly [Semantic, number])[] {
  const counts = new Map<Semantic, number>();
  for (const node of topology.nodes) counts.set(node.semantic, (counts.get(node.semantic) ?? 0) + 1);
  return SEMANTICS.filter((s) => counts.has(s)).map((semantic) => [semantic, counts.get(semantic)!] as const);
}
export function statusCounts(nodes: readonly TopologyNode[]): readonly (readonly [NodeStatus, number])[] {
  const counts = new Map<NodeStatus, number>();
  for (const node of nodes) counts.set(node.status, (counts.get(node.status) ?? 0) + 1);
  return STATUS_ORDER.filter((s) => counts.has(s)).map((status) => [status, counts.get(status)!] as const);
}
/** 一组节点里最需要关注的状态；空组视为空置。 */
export function worstStatus(nodes: readonly TopologyNode[]): NodeStatus { return STATUS_ORDER.find((status) => nodes.some((node) => node.status === status)) ?? 'idle'; }
