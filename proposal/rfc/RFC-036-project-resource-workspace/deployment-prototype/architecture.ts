// 复用运行与诊断的组图函数，随后仅做展示折叠和资源摘要，不复制 SVG 绘图器。
import { buildProjectTopology } from '../../../../apps/console/src/shared/topology/projectTopology';
import type { Topology, TopologyEdge, TopologyNode } from '../../../../apps/console/src/shared/ui/topology/topologyModel';
import { worstStatus } from '../../../../apps/console/src/shared/ui/topology/topologyModel';
import type { Translate } from '../../../../apps/console/src/shared/lib/useT';
import { runtimeFixture } from './runtimeFixture';
import type { Capability, Change, Perspective } from './model';
import { openChange } from './model';

interface Group {
  id: string; title: string; lane: number; row: number; members: string[]; box?: string;
  subtitle: string; kind?: TopologyNode['kind']; semantic?: TopologyNode['semantic']; facts?: [string, string][];
}
const slot = (role: string, names: string[], row: number): Group => ({ id: `service:${role}`, title: role === 'prod' ? '正式服务 · v2.4.0' : '待验证服务 · v2.5.0', lane: 1, row, members: names.map((n) => `uid:${n}`), box: 'namespace', subtitle: role === 'prod' ? 'green · 2 个副本' : 'blue · 1 个副本', facts: [['单副本', '1 核 / 2 GiB']] });
const groups: Record<Perspective, Group[]> = {
  services: [
    { id: 'route:prod', title: '正式入口', lane: 0, row: 0, members: ['route:prod'], subtitle: 'knowledge.cs.localhost', facts: [['权限', '自动供给 · 身份校验']] },
    { id: 'route:preview', title: '待验证入口', lane: 0, row: 1, members: ['route:preview'], subtitle: 'preview.knowledge.cs.localhost', facts: [['权限', '自动供给 · 身份校验']] },
    slot('prod', ['prod-deploy', 'prod-pod-1', 'prod-pod-2'], 0), slot('preview', ['preview-deploy', 'preview-pod'], 1),
    { id: 'db:production', title: '生产数据库', lane: 2, row: 0, members: ['db:production'], subtitle: 'PostgreSQL · 双槽共享', facts: [['供给', '自动供给'], ['容量', '共享实例 · 未单列配额']] },
    { id: 'objects:prod', title: '生产对象空间', lane: 2, row: 1, members: ['objects:prod'], subtitle: 'Garage · 双槽共享' },
    { id: 'apis', title: '平台 API', lane: 3, row: 0, members: [], subtitle: '按发布声明调用', kind: 'external', semantic: 'platform', facts: [['当前依赖', 'GET /customers']] },
    { id: 'events', title: '事件订阅', lane: 3, row: 1, members: [], subtitle: 'order.updated', kind: 'external', semantic: 'platform', facts: [['推送目标', '正式服务'], ['待验证槽', '无此订阅']] },
  ],
  development: [
    { id: 'route:dev', title: '开发预览入口', lane: 0, row: 0, members: ['route:dev'], subtitle: '仅项目成员', facts: [['供给', '自动供给']] },
    { id: 'dev-work', title: '开发工作区', lane: 1, row: 0, members: ['dev-work'], box: 'namespace', subtitle: 'main · 1 个工作区', facts: [['规格', '0.5 核 / 1 GiB']] },
    { id: 'dev-agents', title: '开发 Agent', lane: 1, row: 1, members: ['dev-agent-1', 'dev-agent-2'], box: 'namespace', subtitle: '2 个独立执行容器', facts: [['每实例', '0.5 核 / 1 GiB']] },
    { id: 'dev-volume', title: '开发工作卷', lane: 2, row: 0, members: ['dev-volume'], box: 'namespace', subtitle: 'workdir · 10 GiB', facts: [['范围', '本工作区及关联执行'], ['文件用量', '未观测']] },
    { id: 'db:development', title: '开发数据库', lane: 3, row: 0, members: ['db:development'], subtitle: '与生产数据库隔离', facts: [['供给', '自动供给']] },
    { id: 'mcp', title: '平台能力 MCP', lane: 3, row: 1, members: [], subtitle: '开发会话身份', semantic: 'platform', kind: 'external', facts: [['工具范围', '按会话身份提供']] },
  ],
  business: [
    { id: 'business-work', title: '业务任务工作区', lane: 0, row: 0, members: ['business-work'], box: 'namespace', subtitle: '任务 T-204 · 1 个工作区', facts: [['规格', '0.5 核 / 1 GiB']] },
    { id: 'business-agents', title: '业务 Agent', lane: 1, row: 0, members: ['business-agent-1', 'business-agent-2'], box: 'namespace', subtitle: 'T-204 下的 2 个执行', facts: [['每实例', '0.5 核 / 1 GiB']] },
    { id: 'business-volume', title: '任务工作卷', lane: 2, row: 0, members: ['business-volume'], box: 'namespace', subtitle: 'T-204 专属 · 10 GiB', facts: [['范围', '仅所属任务与关联执行'], ['文件用量', '未观测']] },
  ],
  delivery: [
    { id: 'release', title: '发布版本 · v2.5.0', lane: 0, row: 0, members: [], subtitle: 'knowledge · main', kind: 'component', semantic: 'service', facts: [['版本', '固定发布修订']] },
    { id: 'build', title: '镜像构建', lane: 1, row: 0, members: ['uid:build-job'], box: 'namespace', subtitle: '1 个作业 · 已完成', facts: [['归属', '发布 v2.5.0']] },
    { id: 'migration', title: '数据库迁移', lane: 1, row: 1, members: ['uid:migration-job', 'uid:migration-pod'], box: 'namespace', subtitle: '1 个作业 · 执行中', facts: [['归属', '发布 v2.5.0']] },
    { id: 'db:production', title: '生产数据库', lane: 2, row: 1, members: ['db:production'], subtitle: '发布迁移目标', facts: [['连接', '发布声明的生产数据库']] },
  ],
};
const configured: Record<Perspective, TopologyEdge[]> = {
  services: [{ from: 'service:prod', to: 'apis', kind: 'traffic', evidence: 'configured', label: '调用' }, { from: 'service:preview', to: 'apis', kind: 'traffic', evidence: 'configured', label: '调用' }, { from: 'events', to: 'service:prod', kind: 'push', evidence: 'configured', label: '推送' }],
  development: [{ from: 'dev-work', to: 'mcp', kind: 'traffic', evidence: 'configured', label: '调用' }],
  business: [], delivery: [{ from: 'release', to: 'build', kind: 'owns', evidence: 'configured', label: '构建' }, { from: 'release', to: 'migration', kind: 'owns', evidence: 'configured', label: '迁移' }],
};
export function resourceCounts(id: string, capabilities: Capability[], changes: Change[]): [string, string][] {
  const items = capabilities.filter((c) => c.contexts.includes(id)), pending = items.filter((c) => openChange(changes, c.id)).length;
  const used = items.filter((c) => c.eligibility === 'used').length, available = items.filter((c) => c.eligibility === 'available').length;
  const requestable = items.filter((c) => c.eligibility === 'requestable' && !openChange(changes, c.id)).length;
  return [['权限', `${used} 已使用 · ${available} 可选`], ['资源变更', `${requestable} 可申请 · ${pending} 在途`]];
}
export function architecture(view: Perspective, t: Translate, capabilities: Capability[], changes: Change[]) {
  const original = buildProjectTopology(runtimeFixture, t), mapping = new Map<string, string>();
  for (const group of groups[view]) for (const id of group.members) mapping.set(id, group.id);
  const nodes = groups[view].map((group): TopologyNode => {
    const members = original.nodes.filter((node) => group.members.includes(node.id)), first = members[0];
    const counts = resourceCounts(group.id, capabilities, changes);
    const object = capabilities.find((c) => c.id === 'object-capacity');
    const rate = capabilities.find((c) => c.id === 'gateway-rate');
    const head: [string, string][] = group.id === 'objects:prod' ? [['容量', `${object?.used} / ${object?.limit} GiB`]] : group.id.startsWith('route:') && view === 'services' ? [['共享限流', `${rate?.limit} 次/秒`]] : (group.facts ?? []).slice(0, 1);
    return { ...first, id: group.id, title: group.title, subtitle: group.subtitle, kind: group.kind ?? first?.kind ?? 'summary', semantic: group.semantic ?? first?.semantic ?? 'platform', status: members.length ? worstStatus(members) : 'ready', statusText: members.length ? first?.statusText?.split(' · ')[0] ?? '就绪' : '已配置', lane: group.lane, row: group.row, box: group.box, band: 'architecture', counts: [...head, ...counts], facts: [...(group.facts ?? []), ['原始节点', group.members.join(', ') || '资源中心配置关系']] };
  });
  const edgeMap = new Map<string, TopologyEdge>();
  for (const edge of original.edges) {
    const from = mapping.get(edge.from), to = mapping.get(edge.to);
    if (from && to && from !== to) { const mapped = { ...edge, from, to, label: edge.kind === 'routes' ? '路由' : edge.kind === 'mounts' ? '挂载' : edge.kind === 'child' ? '从属' : '连接' }; edgeMap.set(`${from}:${to}:${edge.kind}:${edge.evidence}`, mapped); }
  }
  const lanes = view === 'services' ? ['访问入口', '部署与运行', '生产数据 · 双槽共享', '平台依赖'] : view === 'development' ? ['访问入口', '工作区与执行', '专属工作存储', '平台依赖'] : view === 'business' ? ['任务工作区', '关联执行', '专属工作存储'] : ['发布版本', '作业执行', '生产数据'];
  const topology: Topology = { id: `deployment-resources:${view}`, title: '部署架构与资源', nodes, edges: [...edgeMap.values(), ...configured[view]], lanes, bands: [{ id: 'architecture', title: '', semantic: 'service', boxes: [{ id: 'namespace', title: '命名空间 · cs-knowledge', semantic: 'service' }] }], observedAt: original.observedAt, complete: true };
  return { topology, original, groups: groups[view] };
}
