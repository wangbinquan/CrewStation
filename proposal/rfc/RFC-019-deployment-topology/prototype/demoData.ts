// 设计附件的模拟数据：按本机 kind 集群 2026-09-22 的真实形态改写（命名空间、Pod 命名、标签约定、状态），数量与时间均为演示值。
import type { Topology, TopologyNode } from './topologyModel';

export const DEMO_NOW = '2026-09-22T12:40:00Z';
export type ProjectKind = 'digital-worker' | 'api-proxy' | 'event-producer';
export interface DemoProject {
  readonly id: string; readonly name: string; readonly slug: string; readonly kind: ProjectKind; readonly namespace: string;
  readonly workloads: number; readonly pods: number; readonly ready: number; readonly abnormal: number;
  readonly prod?: string; readonly preview?: string; readonly devSession?: string; readonly note?: string;
}

export const DEMO_PROJECTS: readonly DemoProject[] = [
  { id: 'demo', name: '演示数字人', slug: 'demo', kind: 'digital-worker', namespace: 'cs-demo', workloads: 5, pods: 8, ready: 5, abnormal: 1, prod: 'v0.1.4', preview: 'v0.1.5 部署中', devSession: '运行中 · 林晓', note: '1 个业务子任务等待调度' },
  { id: 'gitlab-event-producer', name: 'GitLab 事件生产者', slug: 'gitlab-event-producer', kind: 'event-producer', namespace: 'cs-gitlab-event-producer', workloads: 2, pods: 2, ready: 2, abnormal: 0, prod: 'v0.1.4', preview: 'v0.1.3' },
  { id: 'reference-api-proxy', name: '参考 API 代理', slug: 'reference-api-proxy', kind: 'api-proxy', namespace: 'cs-reference-api-proxy', workloads: 2, pods: 2, ready: 2, abnormal: 0, prod: 'v0.1.4', preview: 'v0.1.3' },
  { id: 'rfc003-ux', name: 'RFC-003 验收', slug: 'rfc003-ux', kind: 'digital-worker', namespace: 'cs-rfc003-ux', workloads: 1, pods: 1, ready: 1, abnormal: 0, prod: 'v0.1.2' },
  { id: 'rfc003-verify-workbench', name: 'RFC-003 新工作台验收', slug: 'rfc003-verify-workbench', kind: 'digital-worker', namespace: 'cs-rfc003-verify-workbench', workloads: 2, pods: 3, ready: 2, abnormal: 1, prod: 'v0.1.1', preview: 'v0.1.0', note: '1 个开发工作区 Pod 已失败（残留）' },
  { id: 'rfc003-verify-delivery', name: 'RFC-003 发布与故障验收', slug: 'rfc003-verify-delivery', kind: 'digital-worker', namespace: 'cs-rfc003-verify-delivery', workloads: 2, pods: 2, ready: 2, abnormal: 0, prod: 'v0.1.8', preview: 'v0.1.7' },
  { id: 'rfc003-verify-files', name: 'RFC-003 文件与预览验收', slug: 'rfc003-verify-files', kind: 'digital-worker', namespace: 'cs-rfc003-verify-files', workloads: 1, pods: 1, ready: 1, abnormal: 0, prod: 'v0.1.4' },
  { id: 'rfc003-verify-integration', name: 'RFC-003 管理接入验收', slug: 'rfc003-verify-integration', kind: 'digital-worker', namespace: 'cs-rfc003-verify-integration', workloads: 2, pods: 2, ready: 2, abnormal: 0, prod: 'v0.1.2', preview: 'v0.1.1' },
  { id: 'rfc006-verify', name: 'RFC-006 实机验收', slug: 'rfc006-verify', kind: 'digital-worker', namespace: 'cs-rfc006-verify', workloads: 1, pods: 2, ready: 1, abnormal: 1, prod: 'v0.1.2', note: '1 个开发工作区 Pod 已失败（残留）' },
  { id: 'rfc011-role-home', name: '首页角色验收', slug: 'rfc011-role-home', kind: 'digital-worker', namespace: 'cs-rfc011-role-home', workloads: 1, pods: 1, ready: 1, abnormal: 0, prod: 'v0.1.0' },
  { id: 'rfc010-cluster-qa', name: 'RFC010 集群运维验收', slug: 'rfc010-cluster-qa', kind: 'digital-worker', namespace: 'cs-rfc010-cluster-qa', workloads: 1, pods: 1, ready: 1, abnormal: 0, prod: 'v0.1.0' },
];

/** 模拟几百个项目时的折叠形态：只在评审工具里开启。 */
export function manyProjects(): readonly DemoProject[] {
  const generated = Array.from({ length: 109 }, (_, i) => {
    const n = i + 1, abnormal = n % 23 === 0 ? 1 : 0;
    return { id: `worker-${n}`, name: `数字人 ${String(n).padStart(3, '0')}`, slug: `worker-${n}`, kind: 'digital-worker' as const, namespace: `cs-worker-${n}`, workloads: 2, pods: 2 + abnormal, ready: 2, abnormal, prod: 'v1.2.0', preview: 'v1.3.0', ...(abnormal ? { note: '1 个业务子任务失败' } : {}) };
  });
  return [...DEMO_PROJECTS, ...generated];
}

const podFacts = (node: string, purpose: string, image: string, ip: string, created: string): readonly (readonly [string, string])[] => [
  ['节点', 'desktop-control-plane'], ['用途', purpose], ['镜像', image], ['Pod IP', ip], ['创建时间', created], ['UID', `${node.slice(0, 8)}…（演示）`],
];

/** 演示数字人：完整的项目形态（线上槽、待命槽、开发会话、业务任务、构建与迁移）。tick 模拟 15 秒一次的快照变化。 */
export function projectTopology(project: DemoProject, tick: number, partial: boolean): Topology {
  if (project.id !== 'demo') return simpleProjectTopology(project, partial);
  const greenReady = tick >= 2, subtaskScheduled = tick >= 3, thirdCli = tick >= 1;
  const nodes: TopologyNode[] = [
    { id: 'route-prod', kind: 'route', semantic: 'gateway', title: 'demo.cs.localhost', subtitle: '用户域 · 线上流量', status: 'ready', statusText: 'HTTP 200', lane: 0, band: 'prod', meta: ['ForwardAuth 登录', '指向 blue'], facts: [['主机', 'demo.cs.localhost'], ['域', '用户域'], ['当前指向', 'blue（prod）'], ['最近切流', '2026-09-22 10:38 · rel_…4d5ff']] },
    { id: 'deploy-blue', kind: 'workload', semantic: 'service', title: 'demo-blue', subtitle: 'Deployment · v0.1.4 · 线上', status: 'ready', statusText: '1／1 就绪', lane: 1, band: 'prod', box: 'prod', meta: ['副本 1／1', '发布 rel_…4d5ff', '10 天'], purpose: 'digital-worker-service', facts: [['类型', 'Deployment'], ['物理槽', 'blue'], ['角色', 'prod'], ['版本', 'v0.1.4 · 7dee80b'], ['副本', '1／1'], ['最近更新', '2026-09-12 10:54']] },
    { id: 'pod-blue', kind: 'pod', semantic: 'service', title: 'demo-blue-56fb8ffff9-kl2cg', subtitle: '数字人服务 · 节点 desktop-control-plane', status: 'ready', statusText: '就绪', lane: 2, band: 'prod', box: 'prod', meta: ['重启 1', '存活 10 天 1 小时', '10.244.0.4'], purpose: 'digital-worker-service', facts: podFacts('demo-blue-56fb8ffff9-kl2cg', '数字人服务（线上槽）', 'registry.cs.internal/demo:v0.1.4', '10.244.0.4', '2026-09-12 10:54') },
    { id: 'db-prod', kind: 'database', semantic: 'data', title: 'cs_demo', subtitle: '生产库 · db-small · 两槽共用', status: 'ready', statusText: '就绪', lane: 3, band: 'prod', meta: ['PostgreSQL 17', '注入 CS_DATABASE_URL'], facts: [['种类', 'postgres'], ['环境', 'production'], ['套餐', 'db-small'], ['环境变量', 'CS_DATABASE_URL'], ['实例', 'postgres.crewstation-system:5432']] },
    { id: 'route-preview', kind: 'route', semantic: 'gateway', title: 'preview.demo.cs.localhost', subtitle: '用户域 · 待命流量', status: 'ready', statusText: 'HTTP 200', lane: 0, band: 'preview', meta: ['成员与测试员可见', '指向 green'], facts: [['主机', 'preview.demo.cs.localhost'], ['域', '用户域'], ['当前指向', 'green（preview）']] },
    { id: 'deploy-green', kind: 'workload', semantic: 'service', title: 'demo-green', subtitle: 'Deployment · v0.1.5 · 待命', status: greenReady ? 'ready' : 'pending', statusText: greenReady ? '1／1 就绪' : '0／1 · 部署中', lane: 1, band: 'preview', box: 'preview', meta: ['副本 ' + (greenReady ? '1／1' : '0／1'), '发布 rel_…c2a8', greenReady ? '3 分钟' : '2 分钟'], purpose: 'digital-worker-service', facts: [['类型', 'Deployment'], ['物理槽', 'green'], ['角色', 'preview'], ['版本', 'v0.1.5 · 1d88a7d2'], ['副本', greenReady ? '1／1' : '0／1']] },
    { id: 'pod-green', kind: 'pod', semantic: 'service', title: 'demo-green-7c9d4b8f6-x2k7q', subtitle: '数字人服务 · 节点 desktop-control-plane', status: greenReady ? 'ready' : 'pending', statusText: greenReady ? '就绪' : 'ContainerCreating', lane: 2, band: 'preview', box: 'preview', meta: ['重启 0', greenReady ? '存活 3 分钟' : '存活 2 分钟'], purpose: 'digital-worker-service', facts: podFacts('demo-green-7c9d4b8f6-x2k7q', '数字人服务（待命槽）', 'registry.cs.internal/demo:v0.1.5', greenReady ? '10.244.0.71' : '—', '2026-09-22 12:38') },
    { id: 'route-dev', kind: 'route', semantic: 'gateway', title: 'dev.demo.cs.localhost', subtitle: '用户域 · 开发预览', status: 'ready', statusText: 'HTTP 200', lane: 0, band: 'dev', meta: ['仅开发会话成员', '指向开发容器'], facts: [['主机', 'dev.demo.cs.localhost'], ['域', '用户域'], ['当前指向', '开发容器 :3000']] },
    { id: 'pod-session', kind: 'pod', semantic: 'development', title: 'task-01a0c12ade2a…', subtitle: '开发工作区 · 分支 main · 林晓', status: 'running', statusText: '运行中 · 5 小时', lane: 2, band: 'dev', box: 'dev', meta: ['Runner 已连接', '重启 0', '存活 5 小时 20 分'], purpose: 'development-workspace', facts: podFacts('task-01a0c12ade2a705a9de52680b8ed75c1', '开发工作区', 'registry.cs.internal/task-base:2026-09-21', '10.244.0.61', '2026-09-22 07:19') },
    { id: 'pod-cli-1', kind: 'pod', semantic: 'development', title: 'agent-01a0c8b2…-cli', subtitle: '开发 CLI · OpenCode · 档位 oc-base', status: 'running', statusText: '运行中 · 42 分钟', lane: 2, band: 'dev', box: 'dev', meta: ['林晓', '执行 42 分钟', '250m CPU · 1Gi'], purpose: 'development-cli', facts: [['用途', '开发 CLI'], ['算力档位', 'oc-base · 修订 3'], ['上级任务', 'task-01a0c12ade2a…'], ['终端', 'trm_01a0c8b2…'], ['开始', '2026-09-22 11:58'], ['执行时长', '42 分钟']] },
    { id: 'pod-agent-2', kind: 'pod', semantic: 'development', title: 'agent-01a0c8f1…', subtitle: '开发 Agent · headless · 档位 oc-base', status: 'running', statusText: '运行中 · 3 分钟', lane: 2, band: 'dev', box: 'dev', meta: ['林晓', '执行 3 分钟'], purpose: 'development-agent', facts: [['用途', '开发 Agent'], ['算力档位', 'oc-base · 修订 3'], ['上级任务', 'task-01a0c12ade2a…'], ['开始', '2026-09-22 12:37'], ['执行时长', '3 分钟']] },
    ...(thirdCli ? [{ id: 'pod-cli-3', kind: 'pod', semantic: 'development', title: 'agent-01a0c905…-cli', subtitle: '开发 CLI · Claude Code · 档位 cc-base', status: 'pending', statusText: 'ContainerCreating', lane: 2, band: 'dev', box: 'dev', meta: ['林晓', '创建 12 秒'], purpose: 'development-cli', facts: [['用途', '开发 CLI'], ['算力档位', 'cc-base · 修订 1'], ['上级任务', 'task-01a0c12ade2a…'], ['开始', '2026-09-22 12:40']] } as TopologyNode] : []),
    { id: 'pvc-work', kind: 'volume', semantic: 'data', title: 'task-01a0c12ade2a-work', subtitle: '工作卷 · 10Gi · 随容器', status: 'ready', statusText: 'Bound', lane: 3, band: 'dev', meta: ['standard', '已用 1.8Gi（演示）'], facts: [['类型', 'PersistentVolumeClaim'], ['容量', '10Gi'], ['访问模式', 'RWO'], ['模式', 'follow-container'], ['挂载', `${thirdCli ? 4 : 3} 个 Pod`]] },
    { id: 'db-dev', kind: 'database', semantic: 'data', title: 'cs_demo_dev', subtitle: '开发库 · db-small', status: 'ready', statusText: '就绪', lane: 3, band: 'dev', meta: ['development 绑定', '注入 CS_DATABASE_URL'], facts: [['种类', 'postgres'], ['环境', 'development'], ['套餐', 'db-small'], ['绑定模式', 'development']] },
    { id: 'pod-subtask-1', kind: 'pod', semantic: 'business', title: 'subtask-01a0c8a1…', subtitle: '业务子任务 · summarize-ticket · oneshot', status: subtaskScheduled ? 'running' : 'pending', statusText: subtaskScheduled ? '运行中 · 10 秒' : 'Insufficient cpu', lane: 2, band: 'business', box: 'business', meta: subtaskScheduled ? ['已调度', '档位 biz-small'] : ['等待调度 6 分钟', '档位 biz-small'], purpose: 'business-subtask', abnormal: !subtaskScheduled, facts: [['用途', '业务子任务'], ['子任务', 'summarize-ticket'], ['模式', 'oneshot'], ['业务任务', 'btk_01a0c89e…'], ['traceId', 'trc_01a0c89e…'], ['原因', subtaskScheduled ? '—' : '0/1 nodes are available: Insufficient cpu']] },
    { id: 'pod-subtask-2', kind: 'pod', semantic: 'business', title: 'subtask-01a0c89f…', subtitle: '业务子任务 · classify-email · oneshot', status: 'running', statusText: '运行中 · 2 分钟', lane: 2, band: 'business', box: 'business', meta: ['执行 2 分钟', '档位 biz-small'], purpose: 'business-subtask', facts: [['用途', '业务子任务'], ['子任务', 'classify-email'], ['模式', 'oneshot'], ['业务任务', 'btk_01a0c89d…'], ['traceId', 'trc_01a0c89d…'], ['执行时长', '2 分钟']] },
    { id: 'job-build', kind: 'job', semantic: 'build', title: 'build-v0.1.5', subtitle: '镜像构建 Job · SHA 1d88a7d2', status: 'succeeded', statusText: '已完成 · 3 分 12 秒', lane: 1, band: 'jobs', box: 'jobs', meta: ['12 分钟前完成', 'BuildKit'], purpose: 'build', facts: [['类型', 'Job'], ['发布', 'rel_…c2a8 · v0.1.5'], ['开始', '2026-09-22 12:25'], ['耗时', '3 分 12 秒'], ['镜像', 'registry.cs.internal/demo:v0.1.5']] },
    { id: 'job-migrate', kind: 'job', semantic: 'build', title: 'migrate-v0.1.5', subtitle: '数据迁移 Job · 迁移身份', status: 'running', statusText: '运行中 · 40 秒', lane: 1, band: 'jobs', box: 'jobs', meta: ['兼容线上槽', '生产库'], purpose: 'migration', facts: [['类型', 'Job'], ['发布', 'rel_…c2a8 · v0.1.5'], ['兼容范围', 'compatible: >=v0.1.4'], ['开始', '2026-09-22 12:39']] },
    { id: 'pod-migrate', kind: 'pod', semantic: 'build', title: 'migrate-v0.1.5-k8s2p', subtitle: '数据迁移 · 节点 desktop-control-plane', status: 'running', statusText: '运行中', lane: 2, band: 'jobs', box: 'jobs', meta: ['重启 0', '存活 40 秒'], purpose: 'migration', facts: podFacts('migrate-v0.1.5-k8s2p', '数据迁移', 'registry.cs.internal/demo:v0.1.5', '10.244.0.73', '2026-09-22 12:39') },
  ];
  return {
    id: 'project-demo', title: '演示数字人 · 部署与运行形态', nodes, lanes: ['入口', '工作负载', 'Pod', '数据与存储'],
    bands: [
      { id: 'prod', title: '线上槽 prod · blue', semantic: 'service', note: 'v0.1.4 · 切流于 10:38' },
      { id: 'preview', title: '待命槽 preview · green', semantic: 'service', note: greenReady ? 'v0.1.5 就绪，可切流' : 'v0.1.5 部署中' },
      { id: 'dev', title: '开发会话', semantic: 'development', note: `林晓 · main · ${thirdCli ? 3 : 2} 个 Agent` },
      { id: 'business', title: '业务任务', semantic: 'business', note: '并发配额 3 · 在用 2' },
      { id: 'jobs', title: '构建与迁移', semantic: 'build', note: '最近发布 v0.1.5' },
    ],
    edges: [
      { from: 'route-prod', to: 'deploy-blue', kind: 'routes', label: '线上流量', evidence: 'observed' },
      { from: 'route-preview', to: 'deploy-green', kind: 'routes', label: '待命流量', evidence: 'observed' },
      { from: 'route-dev', to: 'pod-session', kind: 'routes', label: '开发预览', evidence: 'observed' },
      { from: 'deploy-blue', to: 'pod-blue', kind: 'owns', evidence: 'observed' },
      { from: 'deploy-green', to: 'pod-green', kind: 'owns', evidence: 'observed' },
      { from: 'pod-blue', to: 'db-prod', kind: 'uses', label: 'CS_DATABASE_URL', evidence: 'observed' },
      { from: 'pod-green', to: 'db-prod', kind: 'uses', evidence: 'observed' },
      { from: 'pod-session', to: 'pod-cli-1', kind: 'child', evidence: 'observed' },
      { from: 'pod-session', to: 'pod-agent-2', kind: 'child', evidence: 'observed' },
      ...(thirdCli ? [{ from: 'pod-session', to: 'pod-cli-3', kind: 'child' as const, evidence: 'observed' as const }] : []),
      { from: 'pod-session', to: 'pvc-work', kind: 'mounts', label: '/work', evidence: 'observed' },
      { from: 'pod-cli-1', to: 'pvc-work', kind: 'mounts', evidence: 'observed' },
      { from: 'pod-agent-2', to: 'pvc-work', kind: 'mounts', evidence: 'observed' },
      { from: 'pod-session', to: 'db-dev', kind: 'uses', label: '开发库', evidence: 'observed' },
      { from: 'job-migrate', to: 'pod-migrate', kind: 'owns', evidence: 'observed' },
      { from: 'pod-migrate', to: 'db-prod', kind: 'uses', label: '迁移', evidence: 'observed' },
    ],
    observedAt: new Date(new Date(DEMO_NOW).getTime() + tick * 15_000).toISOString(),
    complete: !partial, incompleteReason: partial ? 'PersistentVolumeClaim 来源读取超时，数据与存储列为上次成功结果' : undefined,
  };
}

function simpleProjectTopology(project: DemoProject, partial: boolean): Topology {
  const host = `${project.slug}.cs.localhost`;
  const failed = project.abnormal > 0;
  const nodes: TopologyNode[] = [
    { id: 'route-prod', kind: 'route', semantic: 'gateway', title: host, subtitle: project.kind === 'digital-worker' ? '用户域 · 线上流量' : '服务域 · 线上流量', status: 'ready', statusText: 'HTTP 200', lane: 0, band: 'prod', meta: ['指向 green'] },
    { id: 'deploy-green', kind: 'workload', semantic: 'service', title: `${project.slug}-green`, subtitle: `Deployment · ${project.prod ?? '—'} · 线上`, status: 'ready', statusText: '1／1 就绪', lane: 1, band: 'prod', box: 'prod', meta: ['副本 1／1'] },
    { id: 'pod-green', kind: 'pod', semantic: 'service', title: `${project.slug}-green-…`, subtitle: kindLabel(project.kind), status: 'ready', statusText: '就绪', lane: 2, band: 'prod', box: 'prod', meta: ['重启 1', '存活 7 天'] },
    { id: 'db-prod', kind: 'database', semantic: 'data', title: project.namespace.replace(/-/g, '_').replace(/^cs_/, 'cs_'), subtitle: '生产库 · db-small', status: 'ready', statusText: '就绪', lane: 3, band: 'prod', meta: ['未被应用使用（演示）'] },
    ...(project.preview ? [
      { id: 'route-preview', kind: 'route', semantic: 'gateway', title: `preview.${host}`, subtitle: '待命流量', status: 'ready', statusText: 'HTTP 200', lane: 0, band: 'preview', meta: ['指向 blue'] } as TopologyNode,
      { id: 'deploy-blue', kind: 'workload', semantic: 'service', title: `${project.slug}-blue`, subtitle: `Deployment · ${project.preview} · 待命`, status: 'ready', statusText: '1／1 就绪', lane: 1, band: 'preview', box: 'preview', meta: ['副本 1／1'] } as TopologyNode,
      { id: 'pod-blue', kind: 'pod', semantic: 'service', title: `${project.slug}-blue-…`, subtitle: kindLabel(project.kind), status: 'ready', statusText: '就绪', lane: 2, band: 'preview', box: 'preview', meta: ['重启 0', '存活 3 小时'] } as TopologyNode,
    ] : []),
    ...(failed ? [{ id: 'pod-task-failed', kind: 'pod', semantic: 'development', title: 'task-01a0bc96ee15', subtitle: '开发工作区 · 已释放会话的残留', status: 'failed', statusText: 'Failed · 残留', lane: 2, band: 'dev', box: 'dev', meta: ['2 天前', '节点重启后未回收'], abnormal: true, facts: [['原因', 'Pod 在节点重启后 Failed，会话已释放'], ['建议', '在集群管理里删除该残留 Pod']] } as TopologyNode] : []),
  ];
  return {
    id: `project-${project.id}`, title: `${project.name} · 部署与运行形态`, nodes, lanes: ['入口', '工作负载', 'Pod', '数据与存储'],
    bands: [
      { id: 'prod', title: '线上槽 prod · green', semantic: 'service', note: project.prod },
      ...(project.preview ? [{ id: 'preview', title: '待命槽 preview · blue', semantic: 'service' as const, note: project.preview }] : []),
      ...(failed ? [{ id: 'dev', title: '开发会话', semantic: 'development' as const, note: '没有运行中的会话' }] : []),
    ],
    edges: [
      { from: 'route-prod', to: 'deploy-green', kind: 'routes', label: '线上流量', evidence: 'observed' },
      { from: 'deploy-green', to: 'pod-green', kind: 'owns', evidence: 'observed' },
      { from: 'pod-green', to: 'db-prod', kind: 'uses', label: 'CS_DATABASE_URL', evidence: 'observed' },
      ...(project.preview ? [{ from: 'route-preview', to: 'deploy-blue', kind: 'routes' as const, label: '待命流量', evidence: 'observed' as const }, { from: 'deploy-blue', to: 'pod-blue', kind: 'owns' as const, evidence: 'observed' as const }, { from: 'pod-blue', to: 'db-prod', kind: 'uses' as const, evidence: 'observed' as const }] : []),
    ],
    observedAt: DEMO_NOW, complete: !partial, incompleteReason: partial ? 'PersistentVolumeClaim 来源读取超时' : undefined,
  };
}

function kindLabel(kind: ProjectKind): string { return kind === 'digital-worker' ? '数字人服务' : kind === 'api-proxy' ? 'API 接入' : '事件接入'; }

/** 集群系统层：平台组件的观测状态 ＋ 静态标注的调用关系。 */
export function systemTopology(partial: boolean): Topology {
  const component = (id: string, title: string, subtitle: string, lane: number, row: number, extra: Partial<TopologyNode> = {}): TopologyNode => ({ id, kind: 'component', semantic: 'platform', title, subtitle, status: 'ready', statusText: '1／1 就绪', lane, band: 'system', row, box: 'system', meta: ['Deployment', '重启 0'], ...extra });
  const nodes: TopologyNode[] = [
    { id: 'users', kind: 'external', semantic: 'external', title: '用户浏览器', subtitle: '用户域 · 公司登录', status: 'idle', statusText: '—', lane: 0, band: 'system', row: 0, meta: ['OIDC 登录后进入'] },
    { id: 'slots', kind: 'summary', semantic: 'service', title: '服务槽 ×20', subtitle: '11 个项目 · 8 个数字人 · 3 个接入', status: 'ready', statusText: '20／20 就绪', lane: 0, band: 'system', row: 1, counts: [['数字人服务', '14 个 Pod'], ['API／事件接入', '6 个 Pod'], ['异常', '0']] },
    { id: 'sessions', kind: 'summary', semantic: 'development', title: '开发会话与 Agent ×4', subtitle: '1 个会话 · 3 个 Agent Pod', status: 'running', statusText: '3 运行 · 1 等待', lane: 0, band: 'system', row: 2, counts: [['开发工作区', '1'], ['CLI／Agent', '3'], ['残留 Failed', '2']], abnormal: true },
    { id: 'subtasks', kind: 'summary', semantic: 'business', title: '业务子任务 ×2', subtitle: '1 运行 · 1 等待调度', status: 'pending', statusText: '1 等待调度', lane: 0, band: 'system', row: 3, counts: [['运行中', '1'], ['等待调度', '1 · Insufficient cpu'], ['今日完成', '37']], abnormal: true },
    { id: 'jobs', kind: 'summary', semantic: 'build', title: '构建与迁移 ×2', subtitle: '1 迁移运行中', status: 'running', statusText: '1 运行中', lane: 0, band: 'system', row: 4, counts: [['镜像构建', '1 已完成'], ['数据迁移', '1 运行中']] },
    { id: 'traefik', kind: 'component', semantic: 'gateway', title: 'Traefik', subtitle: '网关 · 用户域与服务域', status: 'ready', statusText: '1／1 就绪', lane: 1, band: 'system', row: 0, box: 'system', meta: ['Deployment', '重启 1', '11 天'], facts: [['组件', 'traefik'], ['Service', 'LoadBalancer :80／:443'], ['ForwardAuth', 'cs-auth']] },
    { id: 'cs-auth', kind: 'component', semantic: 'security', title: 'cs-auth', subtitle: 'ForwardAuth · 身份注入 · 工作负载身份', status: 'ready', statusText: '1／1 就绪', lane: 1, band: 'system', row: 3, box: 'system', meta: ['Deployment', '重启 0'], facts: [['组件', 'cs-auth'], ['职责', '公司登录、身份头注入、源 Pod IP 解析、按需上游凭据']] },
    component('cs-console', 'cs-console', '工作台 SPA', 2, 0, { facts: [['组件', 'console'], ['镜像', 'cs-console:navwidth-20260922']] }),
    component('cs-api', 'cs-api', 'REST API · 集群盘点 · MCP 后端', 2, 1, { meta: ['Deployment', '重启 0', '连接池 10'] }),
    component('cs-session', 'cs-session', 'Agent 会话 · 终端 · 文件流', 2, 2),
    component('cs-controller', 'cs-controller', '任务容器 · 构建 · 发布 · 路由 · 数据供给', 2, 3),
    component('cs-events', 'cs-events', '事件去重 · 持久化 · 推送', 2, 4),
    component('mcp-capabilities', 'mcp-capabilities', '能力描述 MCP', 2, 5),
    component('mcp-operations', 'mcp-operations', '操作 MCP', 2, 6),
    { id: 'postgres', kind: 'database', semantic: 'data', title: 'PostgreSQL 17', subtitle: 'StatefulSet · 平台库 ＋ 24 个业务库', status: partial ? 'unknown' : 'ready', statusText: partial ? '来源超时' : '1／1 就绪', lane: 3, band: 'system', row: 0, box: 'system', meta: ['重启 3', 'PVC 10Gi', partial ? '用量待核对' : '已用 4.1Gi（演示）'], facts: [['组件', 'postgres-0'], ['数据库', 'crewstation ＋ 每项目生产库／开发库'], ['与设计差距', 'Design §9.2 要求平台库与业务库分实例']] },
    { id: 'registry', kind: 'component', semantic: 'build', title: 'registry', subtitle: '平台镜像仓库', status: 'ready', statusText: '1／1 就绪', lane: 3, band: 'system', row: 1, box: 'system', meta: ['Deployment', '重启 1'] },
    { id: 'buildkit', kind: 'component', semantic: 'build', title: 'BuildKit', subtitle: '镜像构建后端', status: 'ready', statusText: '1／1 就绪', lane: 3, band: 'system', row: 2, box: 'system', meta: ['Deployment', '重启 1'] },
    { id: 'prometheus', kind: 'component', semantic: 'platform', title: 'Prometheus', subtitle: '容量与用量指标（RFC-015）', status: 'ready', statusText: '1／1 就绪', lane: 3, band: 'system', row: 3, box: 'system', meta: ['StatefulSet', '重启 1'] },
    { id: 'gitlab', kind: 'external', semantic: 'external', title: 'GitLab', subtitle: '代码托管 · gitlab-ce 19.2', status: 'idle', statusText: '外部', lane: 4, band: 'system', row: 7, meta: ['仓库、标签与 webhook'] },
    { id: 'oidc', kind: 'external', semantic: 'external', title: 'OIDC 身份提供方', subtitle: '公司登录（RFC-005）', status: 'idle', statusText: '外部', lane: 4, band: 'system', row: 8 },
    { id: 'kube', kind: 'external', semantic: 'external', title: 'Kubernetes API', subtitle: '本集群控制面', status: 'idle', statusText: '外部', lane: 4, band: 'system', row: 9, meta: ['项目命名空间由 controller 下发'] },
  ];
  return {
    id: 'system', title: '平台系统层', nodes, lanes: ['调用方', '网关与身份', '平台服务', '基础组件', '外部系统'],
    bands: [{ id: 'system', title: '集群', semantic: 'platform', boxes: [{ id: 'system', title: 'crewstation-system 命名空间', semantic: 'platform', note: '9 个 Deployment · 2 个 StatefulSet' }] }],
    edges: [
      { from: 'users', to: 'traefik', kind: 'traffic', label: '用户域 HTTPS', evidence: 'static' },
      { from: 'traefik', to: 'cs-auth', kind: 'traffic', label: 'ForwardAuth', evidence: 'static' },
      { from: 'traefik', to: 'cs-console', kind: 'traffic', label: '工作台', evidence: 'static' },
      { from: 'traefik', to: 'cs-api', kind: 'traffic', label: '/v1', evidence: 'static' },
      { from: 'traefik', to: 'slots', kind: 'routes', label: '用户域路由', evidence: 'static' },
      { from: 'slots', to: 'traefik', kind: 'traffic', label: '服务域 · 源 Pod IP', evidence: 'static' },
      { from: 'cs-events', to: 'slots', kind: 'push', label: '事件推送到线上槽', evidence: 'static' },
      { from: 'sessions', to: 'cs-session', kind: 'dial', label: 'TaskRunner 回连', evidence: 'static' },
      { from: 'sessions', to: 'mcp-capabilities', kind: 'traffic', evidence: 'static' },
      { from: 'sessions', to: 'mcp-operations', kind: 'traffic', label: '会话令牌', evidence: 'static' },
      { from: 'cs-api', to: 'postgres', kind: 'uses', label: 'SQL', evidence: 'static' },
      { from: 'cs-session', to: 'postgres', kind: 'uses', evidence: 'static' },
      { from: 'cs-controller', to: 'postgres', kind: 'uses', evidence: 'static' },
      { from: 'cs-events', to: 'postgres', kind: 'uses', evidence: 'static' },
      { from: 'cs-api', to: 'prometheus', kind: 'uses', label: '指标查询', evidence: 'static' },
      { from: 'cs-controller', to: 'buildkit', kind: 'control', label: '构建', evidence: 'static' },
      { from: 'buildkit', to: 'registry', kind: 'push', label: '推送镜像', evidence: 'static' },
      { from: 'cs-controller', to: 'gitlab', kind: 'control', label: '仓库与标签', evidence: 'static' },
      { from: 'cs-auth', to: 'oidc', kind: 'traffic', label: '公司登录', evidence: 'static' },
      { from: 'cs-controller', to: 'kube', kind: 'control', label: '命名空间与 Pod', evidence: 'static' },
    ],
    observedAt: DEMO_NOW, complete: !partial, incompleteReason: partial ? 'PersistentVolumeClaim 与 StatefulSet 来源读取超时，显示上次成功结果' : undefined,
  };
}

/** 集群项目层：每个项目一张卡；需要关注的置顶；超过 60 个时按状态折叠。 */
export function projectLayerTopology(projects: readonly DemoProject[], partial: boolean, expanded: boolean): Topology {
  const columns = 4;
  const attention = projects.filter((p) => p.abnormal > 0), calm = projects.filter((p) => p.abnormal === 0);
  const fold = projects.length > 60 && !expanded;
  const shownCalm = fold ? calm.slice(0, 12) : calm;
  const card = (p: DemoProject, band: string, index: number): TopologyNode => ({
    id: `project:${p.id}`, kind: 'summary', semantic: p.kind === 'digital-worker' ? 'service' : p.kind === 'api-proxy' ? 'external' : 'business', title: p.name, subtitle: `${kindLabel(p.kind)} · ${p.namespace}`,
    status: p.abnormal > 0 ? 'pending' : 'ready', statusText: p.abnormal > 0 ? `${p.abnormal} 个异常` : `${p.ready}／${p.pods} 就绪`, lane: index % columns, band, row: Math.floor(index / columns), abnormal: p.abnormal > 0,
    counts: [['工作负载', `${p.workloads}`], ['Pod', partial ? '—（部分来源失败）' : `${p.pods} · ${p.ready} 就绪`], [p.devSession ? '开发会话' : '线上／待命', p.devSession ?? `${p.prod ?? '—'} ／ ${p.preview ?? '—'}`]],
    facts: [['命名空间', p.namespace], ['线上', p.prod ?? '空'], ['待命', p.preview ?? '空'], ['开发会话', p.devSession ?? '无'], ...(p.note ? [['需要关注', p.note] as const] : [])],
  });
  const nodes = [...attention.map((p, i) => card(p, 'attention', i)), ...shownCalm.map((p, i) => card(p, 'calm', i))];
  if (fold) nodes.push({ id: 'project:more', kind: 'summary', semantic: 'platform', title: `还有 ${calm.length - shownCalm.length} 个正常项目`, subtitle: '点击展开全部', status: 'idle', statusText: '已折叠', lane: shownCalm.length % columns, band: 'calm', row: Math.floor(shownCalm.length / columns), counts: [['展示规则', '异常置顶，正常项目超过 60 个时折叠']] });
  return {
    id: 'projects', title: '项目层', nodes, lanes: Array.from({ length: columns }, () => ''),
    bands: [
      ...(attention.length > 0 ? [{ id: 'attention', title: `需要关注 · ${attention.length} 个项目`, semantic: 'business' as const }] : []),
      { id: 'calm', title: fold ? `正常 · ${calm.length} 个项目，显示前 ${shownCalm.length} 个` : `正常 · ${calm.length} 个项目`, semantic: 'service' },
    ],
    edges: [], observedAt: DEMO_NOW, complete: !partial, incompleteReason: partial ? 'Pod 来源部分失败，计数不能当作完整总量' : undefined,
  };
}

export interface DemoContainer { readonly name: string; readonly image: string; readonly ready: boolean; readonly restarts: number; readonly state: string }
export function demoContainers(node: TopologyNode): readonly DemoContainer[] {
  if (node.kind !== 'pod' && node.kind !== 'component') return [];
  if (node.semantic === 'development') return [{ name: 'init-clone', image: 'task-base:2026-09-21', ready: true, restarts: 0, state: 'Completed' }, { name: 'runner', image: 'task-base:2026-09-21', ready: node.status === 'running', restarts: 0, state: node.status === 'running' ? 'Running' : node.statusText ?? 'Waiting' }];
  return [{ name: node.kind === 'component' ? node.title.toLowerCase() : 'app', image: (node.facts?.find(([k]) => k === '镜像')?.[1]) ?? 'registry.cs.internal/demo:v0.1.4', ready: node.status === 'ready' || node.status === 'running', restarts: Number(node.meta?.find((m) => m.startsWith('重启'))?.replace(/\D/g, '') ?? 0), state: node.status === 'pending' ? node.statusText ?? 'Waiting' : node.status === 'failed' ? 'Terminated' : 'Running' }];
}
export function demoEvents(node: TopologyNode): readonly { readonly at: string; readonly type: string; readonly reason: string; readonly message: string }[] {
  if (node.status === 'pending' && node.abnormal) return [{ at: '12:34', type: 'Warning', reason: 'FailedScheduling', message: '0/1 nodes are available: 1 Insufficient cpu. preemption: 0/1 nodes are available.' }];
  if (node.status === 'pending') return [{ at: '12:38', type: 'Normal', reason: 'Scheduled', message: 'Successfully assigned to desktop-control-plane' }, { at: '12:38', type: 'Normal', reason: 'Pulling', message: 'Pulling image "registry.cs.internal/demo:v0.1.5"' }];
  if (node.status === 'failed') return [{ at: '09-20 02:13', type: 'Warning', reason: 'NodeNotReady', message: 'Node is not ready' }];
  return [{ at: '12:25', type: 'Normal', reason: 'Started', message: 'Started container' }];
}
