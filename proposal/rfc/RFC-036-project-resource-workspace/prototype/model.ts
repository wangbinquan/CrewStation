import type { NodeKind, NodeStatus, Semantic, TopologyEdge } from '../../../../apps/console/src/shared/ui/topology/topologyModel';

export type ViewRole = 'owner' | 'developer' | 'admin';
export type Access = 'owned' | 'requestable' | 'pending';
export type Category = 'production' | 'execution' | 'integration' | 'foundation';
export type RequestState = 'pending' | 'applying' | 'applied' | 'rejected' | 'cancelled' | 'needs-review' | 'apply-failed';
export interface Entry {
  id: string; title: string; kind: NodeKind; semantic: Semantic; category: Category; lane: number; row: number;
  access: Access; source: string; owner: string; state: NodeStatus; stateText: string; summary: string;
  facts: Array<[string, string]>; metrics: Array<[string, string]>;
  quota?: { label: string; unit: string; used: number; limit: number; next: number };
  adjustable?: boolean; effect: string; private?: boolean;
  settings?: Record<string, number | string>;
}
export interface ResourceRequest {
  id: string; target: string; type: 'grant' | 'quota'; state: RequestState; title: string; before: string; after: string;
  quantity?: number; reason: string; requester: string; createdAt: string; decision?: string;
  changes?: Change[]; direct?: boolean;
  approvedQuantity?: number; approvedChanges?: Change[]; approvedAfter?: string;
}
export interface Change { key: string; label: string; before: string | number; after: string | number; unit: string }
export interface Field { key: string; label: string; value: number | string; unit: string; used?: number; options?: string[] }
export interface Draft { reason: string; values: Record<string, number | string> }
export const ACCESS_LABEL = { owned: '已有能力', requestable: '可以申请', pending: '申请中' } as const;
export const REQUEST_LABEL: Record<RequestState, string> = { pending: '待审批', applying: '生效中', applied: '已生效', rejected: '已驳回', cancelled: '已撤回', 'needs-review': '需重新核对', 'apply-failed': '生效失败' };
export const CATEGORY_LABEL: Record<Category, string> = { production: '生产服务与数据', execution: '开发与任务执行', integration: '接口与协作', foundation: '项目底座与约束' };
export const PENDING_STATES: RequestState[] = ['pending', 'applying', 'needs-review', 'apply-failed'];
export const pendingFor = (requests: ResourceRequest[], id: string) => requests.find((r) => r.target === id && PENDING_STATES.includes(r.state));
export const edges: TopologyEdge[] = [
  { from: 'build-jobs', to: 'artifacts', kind: 'push', label: '构建产物', evidence: 'observed' },
  { from: 'service', to: 'artifacts', kind: 'uses', label: '部署镜像', evidence: 'observed' },
  { from: 'dev', to: 'base-image', kind: 'uses', label: '运行环境', evidence: 'observed' },
  { from: 'tasks', to: 'base-image', kind: 'uses', label: '运行环境', evidence: 'observed' },
  { from: 'agents', to: 'base-image', kind: 'uses', label: '运行环境', evidence: 'observed' },
  { from: 'dev', to: 'repository', kind: 'uses', label: '代码读写', evidence: 'observed' },
  { from: 'build-jobs', to: 'repository', kind: 'uses', label: '构建来源', evidence: 'observed' },
  { from: 'service-policy', to: 'service', kind: 'owns', label: '分配', evidence: 'observed' },
  { from: 'service', to: 'prod-db', kind: 'uses', label: '连接', evidence: 'observed' },
  { from: 'service', to: 'objects', kind: 'uses', label: '读写', evidence: 'observed' },
  { from: 'service', to: 'service-large', kind: 'uses', label: '可申请', evidence: 'static' },
  { from: 'service', to: 'archive-space', kind: 'uses', label: '可申请', evidence: 'static' },
  { from: 'execution-quota', to: 'dev', kind: 'owns', label: '占用 1', evidence: 'observed' },
  { from: 'execution-quota', to: 'tasks', kind: 'owns', label: '占用 2', evidence: 'observed' },
  { from: 'execution-quota', to: 'agents', kind: 'owns', label: '占用 2', evidence: 'observed' },
  { from: 'dev', to: 'agents', kind: 'uses', label: '启动', evidence: 'observed' },
  { from: 'tasks', to: 'agents', kind: 'uses', label: '启动', evidence: 'observed' },
  { from: 'tasks', to: 'volumes', kind: 'mounts', label: '独立挂载', evidence: 'observed' },
  { from: 'dev', to: 'dev-db', kind: 'uses', label: '连接', evidence: 'observed' },
  { from: 'tasks', to: 'compute-pro', kind: 'uses', label: '待授权', evidence: 'static' },
  { from: 'dev', to: 'image-python', kind: 'uses', label: '可申请', evidence: 'static' },
  { from: 'application', to: 'erp', kind: 'traffic', label: '调用', evidence: 'observed' },
  { from: 'events', to: 'application', kind: 'push', label: '推送', evidence: 'observed' },
  { from: 'application', to: 'config', kind: 'uses', label: '注入', evidence: 'observed' },
  { from: 'agents', to: 'mcp', kind: 'uses', label: '调用', evidence: 'observed' },
  { from: 'application', to: 'finance-api', kind: 'traffic', label: '可申请', evidence: 'static' },
  { from: 'dev', to: 'prod-access', kind: 'uses', label: '临时申请', evidence: 'static' },
  { from: 'namespace', to: 'network', kind: 'owns', label: '管理', evidence: 'observed' },
  { from: 'network', to: 'rate-limit', kind: 'uses', label: '约束', evidence: 'observed' },
  { from: 'namespace', to: 'observability', kind: 'owns', label: '观测', evidence: 'observed' },
];
