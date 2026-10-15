// 交互设计附件：仅演示数据；正式实现继续消费资源中心的动作描述及稳定身份。
export type Perspective = 'services' | 'development' | 'business' | 'delivery';
export type Role = 'owner' | 'developer' | 'admin';
export type Eligibility = 'used' | 'available' | 'requestable';
export interface Capability {
  id: string; name: string; type: string; contexts: string[]; scope: string;
  eligibility: Eligibility; source: string; value: string; effect: string;
  used?: number; limit?: number; unit?: string; adjustable?: boolean;
}
export interface Change {
  id: string; target: string; from: string; to: string; reason: string;
  status: 'pending' | 'applying' | 'applied' | 'rejected'; source: 'owner' | 'admin';
}
export const PERSPECTIVES: { id: Perspective; name: string; note: string }[] = [
  { id: 'services', name: '服务部署', note: '正式与待验证槽共享生产数据；副本聚合在所属部署中。' },
  { id: 'development', name: '开发工作区', note: '工作区与 Agent 是独立容器，通过已观测到的挂载共享工作卷。' },
  { id: 'business', name: '业务任务', note: '按任务保留归属与专属存储；多个实例在权限列表中查看。' },
  { id: 'delivery', name: '构建与迁移', note: '发布拥有构建和迁移作业，迁移连接对应的生产数据库。' },
];
export const CONTEXT_NAMES: Record<string, string> = {
  'service:prod': '正式服务', 'service:preview': '待验证服务', 'route:prod': '正式入口', 'route:preview': '待验证入口',
  'db:production': '生产数据库', 'objects:prod': '生产对象空间', apis: '平台 API', events: '事件订阅',
  'route:dev': '开发预览入口', 'dev-work': '开发工作区', 'dev-agents': '开发 Agent', 'dev-volume': '开发工作卷', 'db:development': '开发数据库', mcp: '开发 MCP',
  'business-work': '业务任务工作区', 'business-agents': '业务 Agent', 'business-volume': '任务工作卷',
  release: '发布版本', 'build': '镜像构建', migration: '数据库迁移', namespace: '命名空间配额', project: '项目公共能力',
};
export const statusName = { used: '已使用', available: '已授权 · 未使用', requestable: '可申请' };
export const changeName = { pending: '待审批', applying: '已批准 · 待生效', applied: '已生效', rejected: '已驳回' };
export const openChange = (changes: Change[], id: string) => changes.find((c) => c.target === id && (c.status === 'pending' || c.status === 'applying'));
