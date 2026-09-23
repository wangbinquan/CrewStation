import { describe, expect, test } from 'bun:test';
import type { ClusterProjectCounts, ClusterResource, ClusterSummary } from '@crewstation/contracts';
import { messages as appMessages } from '../app/i18n/zh-CN';
import { messages as clusterMessages } from '../features/cluster/i18n/zh-CN';
import { translate } from '../shared/lib/i18n';
import type { Messages } from '../shared/lib/i18n';
import type { Translate } from '../shared/lib/useT';
import { bandSummaryTopology } from '../shared/topology/bandSummary';
import { buildProjectTopology } from '../shared/topology/projectTopology';
import { buildProjectsLayer, FOLD_SHOWN, MORE_NODE_ID } from '../shared/topology/projectsLayer';
import { STATIC_EDGES } from '../shared/topology/staticArchitecture';
import { buildSystemTopology } from '../shared/topology/systemTopology';
import { resourceRecord } from './resourceRecordFixture';

// RFC-019 design §4：形态的组装规则——每条横带的进入条件、边的生成、状态归一、用途待核对不猜、折叠阈值。
const catalog = { ...appMessages, ...clusterMessages } as Messages;
const t: Translate = (key, values) => translate(catalog, key, values);
const now = '2026-09-22T12:40:00.000Z', projectId = '01a0bf5d-8f4b-7178-82e1-9a99060b1192';
const res = (over: Partial<ClusterResource> & { name: string; kind: string }): ClusterResource => ({
  resourceId: `r-${over.name}`, apiVersion: 'v1', namespace: 'cs-demo', uid: `uid-${over.name}`, resourceVersion: '1', revision: '1', observedAt: now, createdAt: '2026-09-22T11:00:00.000Z',
  view: over.kind === 'Pod' ? 'pods' : over.kind === 'PersistentVolumeClaim' ? 'storage' : 'workloads', ownership: { scope: 'project', projectId, projectName: '演示数字人', slug: 'demo', projectKind: 'DigitalWorker', archived: false },
  purpose: 'digital-worker-service', phase: 'Running', ready: true, abnormal: false, reason: '', topLevel: over.kind !== 'Pod', standalone: false, restarts: 0, labels: {}, owners: [], references: [], containers: [], facts: {}, availableActions: [], ...over,
});
const resources: ClusterResource[] = [
  res({ name: 'demo-blue', kind: 'Deployment', slotRole: 'prod', physicalSlot: 'blue', desired: 1, readyReplicas: 1, releaseId: 'rel-blue' }),
  res({ name: 'demo-blue-1', kind: 'Pod', slotRole: 'prod', physicalSlot: 'blue', node: 'node-a', restarts: 1, containers: [{ name: 'app', init: false, image: 'demo:v0.1.4', ready: true, restarts: 1, state: 'running', requests: {}, limits: {}, ports: [] }] }),
  res({ name: 'demo-green', kind: 'Deployment', slotRole: 'preview', physicalSlot: 'green', desired: 1, readyReplicas: 0 }),
  res({ name: 'demo-green-1', kind: 'Pod', slotRole: 'preview', physicalSlot: 'green', phase: 'Pending', ready: false, reason: 'ContainerCreating' }),
  res({ name: 'task-1', kind: 'Pod', purpose: 'development-workspace', taskId: 'task-1', references: ['cs-demo/PersistentVolumeClaim/task-1-work'] }),
  res({ name: 'agent-1', kind: 'Pod', purpose: 'development-cli', taskId: 'agent-1', parentTaskId: 'task-1', references: ['cs-demo/PersistentVolumeClaim/task-1-work'] }),
  res({ name: 'task-1-work', kind: 'PersistentVolumeClaim', phase: 'Bound', facts: { capacity: '{"storage":"10Gi"}', requested: '{"storage":"10Gi"}' } }),
  res({ name: 'subtask-1', kind: 'Pod', purpose: 'business-subtask', phase: 'Pending', ready: false, abnormal: true, reason: 'Insufficient cpu', taskId: 'sub-1' }),
  res({ name: 'build-1', kind: 'Job', purpose: 'build', phase: 'Succeeded', releaseId: 'rel-green' }),
  res({ name: 'migrate-1', kind: 'Job', purpose: 'migration', phase: 'Running', releaseId: 'rel-green' }),
  res({ name: 'migrate-1-pod', kind: 'Pod', purpose: 'migration', owners: [{ kind: 'Job', name: 'migrate-1', uid: 'uid-migrate-1' }] }),
  res({ name: 'mystery', kind: 'Pod', purpose: 'unknown', reason: '用途证据不足' }),
];
const slots = [
  { name: 'prod' as const, active: true, tag: 'v0.1.4', commitSha: 'a'.repeat(40), releaseId: 'rel-blue' as never, replicas: 1, readyReplicas: 1, state: 'ready' as const, host: 'demo.cs.localhost' },
  { name: 'preview' as const, active: false, tag: 'v0.1.5', commitSha: 'b'.repeat(40), releaseId: 'rel-green' as never, replicas: 1, readyReplicas: 0, state: 'deploying' as const, host: 'preview.demo.cs.localhost' },
];
const dataResources = [
  { id: 'd-prod', projectId: projectId as never, kind: 'postgres' as const, env: 'production' as const, plan: 'db-small', state: 'ready' as const, envVar: 'CS_DATABASE_URL', createdAt: now },
  { id: 'd-dev', projectId: projectId as never, kind: 'postgres' as const, env: 'development' as const, plan: 'db-small', state: 'ready' as const, envVar: 'CS_DATABASE_URL', createdAt: now },
];
const input = { project: { id: projectId, name: '演示数字人', kind: 'DigitalWorker', namespace: 'cs-demo' }, resources, slots, devSession: { taskId: 'task-1' as never, state: 'running' as const, branch: 'main', previewHost: 'dev.demo.cs.localhost' }, dataResources, snapshot: { id: 'snap', observedAt: now, complete: true } };
const edge = (topology: ReturnType<typeof buildProjectTopology>, from: string, to: string) => topology.edges.find((e) => e.from === from && e.to === to);

describe('project topology assembly', () => {
  test('bands appear only when their objects exist, live slot first; every edge points at a drawn node', () => {
    const topology = buildProjectTopology(input, t);
    expect(topology.bands.map((b) => b.id)).toEqual(['slot:prod', 'slot:preview', 'dev', 'business', 'jobs', 'other']);
    expect(topology.bands[0]!.title).toBe('线上槽 prod · blue'); expect(topology.bands[1]!.note).toBe('v0.1.5 部署中');
    const ids = new Set(topology.nodes.map((n) => n.id));
    for (const e of topology.edges) { expect(ids.has(e.from)).toBe(true); expect(ids.has(e.to)).toBe(true); }
    expect(topology.lanes).toEqual(['入口', '工作负载', 'Pod', '数据与存储']);
    expect(buildProjectTopology({ ...input, slots: [], devSession: undefined, resources: [], dataResources: [] }, t).bands).toEqual([]);
  });
  test('routes, ownership, child, mounts and database edges come from slots, owner chains, parent tasks, volume references and injected variables', () => {
    const topology = buildProjectTopology(input, t);
    expect(edge(topology, 'route:prod', 'uid-demo-blue')).toMatchObject({ kind: 'routes', label: '线上流量', evidence: 'observed' });
    expect(edge(topology, 'uid-demo-blue', 'uid-demo-blue-1')).toMatchObject({ kind: 'owns' });
    expect(edge(topology, 'uid-demo-blue-1', 'db:production')).toMatchObject({ kind: 'uses', label: 'CS_DATABASE_URL' });
    expect(edge(topology, 'uid-task-1', 'uid-agent-1')).toMatchObject({ kind: 'child' });
    expect(edge(topology, 'uid-task-1', 'uid-task-1-work')).toMatchObject({ kind: 'mounts' }); expect(edge(topology, 'uid-agent-1', 'uid-task-1-work')).toMatchObject({ kind: 'mounts' });
    expect(edge(topology, 'uid-task-1', 'db:development')).toMatchObject({ kind: 'uses' });
    expect(edge(topology, 'route:dev', 'uid-task-1')).toMatchObject({ kind: 'routes' });
    expect(edge(topology, 'uid-migrate-1', 'uid-migrate-1-pod')).toMatchObject({ kind: 'owns' }); expect(edge(topology, 'uid-migrate-1-pod', 'db:production')).toMatchObject({ kind: 'uses', label: '迁移' });
    expect(topology.edges.every((e) => e.evidence === 'observed')).toBe(true);
  });
  test('status follows the RFC-010 wording: Running≠Ready, reasons stay verbatim, unknown purpose is never guessed into a band', () => {
    const topology = buildProjectTopology(input, t), byId = (id: string) => topology.nodes.find((n) => n.id === id)!;
    expect(byId('uid-demo-green-1')).toMatchObject({ status: 'pending', statusText: 'ContainerCreating', band: 'slot:preview' });
    expect(byId('uid-subtask-1')).toMatchObject({ status: 'pending', statusText: 'Insufficient cpu', abnormal: true, band: 'business' });
    expect(byId('uid-demo-green')).toMatchObject({ status: 'pending', statusText: '副本 0／1 · 更新中' });
    expect(byId('uid-mystery')).toMatchObject({ status: 'unknown', band: 'other', statusText: '待核对' });
    expect(byId('uid-build-1')).toMatchObject({ kind: 'job', status: 'succeeded', lane: 1 });
    expect(byId('route:prod')).toMatchObject({ kind: 'route', title: 'demo.cs.localhost', meta: ['指向 blue'] });
    expect(byId('uid-demo-blue-1').meta).toEqual(['重启 1', '存活 1 小时 40 分']);
    expect(byId('uid-demo-blue-1').facts).toContainEqual(['镜像', 'demo:v0.1.4']);
    expect(byId('uid-task-1-work')).toMatchObject({ kind: 'volume', status: 'ready', statusText: 'Bound', meta: ['capacity 10Gi', 'requested 10Gi'] });
    expect(JSON.stringify(topology)).not.toContain('availableActions');
  });
  test('band summary yields one card per band with the worst status and attention counts', () => {
    const summary = bandSummaryTopology(buildProjectTopology(input, t), t);
    expect(summary.nodes).toHaveLength(6); expect(summary.lanes).toHaveLength(6); expect(summary.edges).toEqual([]);
    const business = summary.nodes.find((n) => n.id === 'band:business')!;
    expect(business).toMatchObject({ status: 'pending', abnormal: true, statusText: '1 个需要关注' });
    expect(summary.nodes.find((n) => n.id === 'band:slot:prod')).toMatchObject({ status: 'ready', counts: [['Pod', '1 · 1 就绪'], ['状态', '4 就绪'], ['节点', '4']] });
  });
});

describe('projects layer and system layer', () => {
  const project = (i: number, abnormal = 0): ClusterProjectCounts => ({ id: `p-${i}`, name: `项目 ${i}`, workloads: 2, pods: 2 + abnormal, readyPods: 2, abnormal, devSessions: 0 });
  const many = [...Array.from({ length: 3 }, (_, i) => project(i, 1)), ...Array.from({ length: 67 }, (_, i) => project(10 + i))];
  const snapshot = { id: 'snap', observedAt: now, complete: true };
  test('projects needing attention come first; beyond 60 the healthy ones fold to 12 plus a "more" card until expanded', () => {
    const folded = buildProjectsLayer({ projects: many, columns: 4, expanded: false, snapshot }, t);
    expect(folded.bands.map((b) => b.id)).toEqual(['attention', 'calm']); expect(folded.bands[1]!.title).toBe('正常 · 67 个项目，显示前 12 个');
    expect(folded.nodes).toHaveLength(3 + FOLD_SHOWN + 1); expect(folded.nodes.at(-1)).toMatchObject({ id: MORE_NODE_ID, title: '还有 55 个正常项目' });
    expect(folded.nodes[0]).toMatchObject({ band: 'attention', abnormal: true, statusText: '1 个需要关注', lane: 0, row: 0 });
    expect(folded.nodes[4]!.lane).toBe(1); expect(folded.nodes[7]!.row).toBe(1);
    expect(buildProjectsLayer({ projects: many, columns: 4, expanded: true, snapshot }, t).nodes).toHaveLength(70);
    expect(buildProjectsLayer({ projects: many.slice(0, 5), columns: 4, expanded: false, snapshot }, t).nodes).toHaveLength(5);
  });
  test('missing counts are shown as unknown, never as zero', () => {
    const layer = buildProjectsLayer({ projects: [{ id: 'p', name: '缺席' }], columns: 2, expanded: false, snapshot: { ...snapshot, complete: false, incompleteReason: 'Pod 来源失败' } }, t);
    expect(layer.nodes[0]).toMatchObject({ status: 'unknown', statusText: '待核对' }); expect(layer.nodes[0]!.counts![1]![1]).toBe('—（部分来源失败）');
    expect(layer.complete).toBe(false); expect(layer.incompleteReason).toBe('Pod 来源失败');
  });
  test('system layer takes component state from the inventory, aggregates callers from the summary and marks every edge static', () => {
    const summary = { snapshotId: 'snap', startedAt: now, finishedAt: now, complete: true, sources: [], total: 0, workloads: 0, pods: 0, runningPods: 0, readyPods: 0, standalonePods: 0, services: 0, pvcs: 0, abnormal: 0, kinds: {}, phases: {}, purposes: { 'digital-worker-service': 14, 'api-proxy': 4, 'development-workspace': 1, 'development-cli': 3 }, projects: [{ id: 'p', name: '演示' }] } satisfies ClusterSummary;
    const observed = [res({ name: 'cs-api', kind: 'Deployment', namespace: 'crewstation-system', ownership: { scope: 'system', component: 'cs-api' }, purpose: 'platform-service', desired: 1, readyReplicas: 1 }), res({ name: 'postgres', kind: 'StatefulSet', namespace: 'crewstation-system', ownership: { scope: 'system', component: 'postgres' }, purpose: 'platform-infrastructure', desired: 1, readyReplicas: 1, restarts: 3 })];
    const system = buildSystemTopology({ resources: observed, summary, snapshot }, t), byId = (id: string) => system.nodes.find((n) => n.id === id)!;
    expect(byId('cs-api')).toMatchObject({ status: 'ready', statusText: '副本 1／1', lane: 2, row: 1, resourceId: 'r-cs-api' });
    expect(byId('postgres')).toMatchObject({ kind: 'database', status: 'ready', meta: ['StatefulSet', '重启 3'] });
    expect(byId('cs-events')).toMatchObject({ status: 'unknown', statusText: '盘点中未观测到' });
    expect(byId('slots')).toMatchObject({ statusText: '18 个 Pod', counts: [['数字人服务', '14'], ['API／事件接入', '4']] });
    expect(byId('sessions')).toMatchObject({ status: 'running', statusText: '4 个 Pod' });
    expect(system.edges).toHaveLength(STATIC_EDGES.length); expect(system.edges.every((e) => e.evidence === 'static')).toBe(true);
    expect(system.lanes).toEqual(['调用方', '网关与身份', '平台服务', '基础组件', '外部系统']);
    const ids = new Set(system.nodes.map((n) => n.id)); for (const e of system.edges) { expect(ids.has(e.from)).toBe(true); expect(ids.has(e.to)).toBe(true); }
    expect(buildSystemTopology({ resources: [], summary: { ...summary, complete: false }, snapshot: { ...snapshot, complete: false } }, t).nodes.find((n) => n.id === 'slots')).toMatchObject({ status: 'unknown', statusText: '— 个 Pod' });
  });
});

// RFC-025 设计 §10：给了资源台账记录时，开发会话与业务任务两带只照记录画——阶段与原因来自记录，已结束的不画，
// 盘点里的同一 Pod 只补详情（容器、日志入口、需要关注），不再按用途单独成节点、也不落进「待核对」。
describe('record-based task bands', () => {
  const at = (minutes: number) => new Date(Date.parse('2026-09-22T11:00:00.000Z') + minutes * 60_000).toISOString();
  const pod = (name: string, phase: string, extra: Record<string, unknown> = {}) => ({ kind: 'Pod', namespace: 'cs-demo', name, uid: `uid-${name}`, phase, ready: phase === 'Running', ...extra });
  const workspace = resourceRecord({ id: 'ws-1', purpose: 'development-workspace', display: { profile: 'coding-medium', branch: 'feature/x' }, createdAt: at(10), children: [pod('task-1', 'Running', { node: 'node-a', restarts: 2 })] });
  const failedWorkspace = resourceRecord({ id: 'ws-0', purpose: 'development-workspace', phase: 'failed', reason: { code: 'checkout-failed', message: '检出失败' }, createdAt: at(1), children: [pod('task-0', 'absent')] });
  const cliReady = resourceRecord({ id: 'cli-1', kind: 'agent-execution', purpose: 'development-cli', parentId: 'ws-1', display: { terminal: 'term-1', profile: 'OpenCode 默认' }, children: [pod('agent-1', 'Running')] });
  const cliStopping = resourceRecord({ id: 'cli-2', kind: 'agent-execution', purpose: 'development-cli', parentId: 'ws-1', phase: 'stopping', reason: { code: 'execution-ended', message: '执行已结束' }, children: [pod('agent-2', 'Running')] });
  const cliStopped = resourceRecord({ id: 'cli-3', kind: 'agent-execution', purpose: 'development-cli', parentId: 'ws-1', phase: 'stopped', children: [] });
  const volume = resourceRecord({ id: 'vol-1', kind: 'volume', parentId: 'ws-1', children: [{ kind: 'PersistentVolumeClaim', namespace: 'cs-demo', name: 'task-1-work', uid: 'uid-task-1-work', phase: 'Bound', ready: true }] });
  const subtask = resourceRecord({ id: 'sub-1', kind: 'agent-execution', purpose: 'business-subtask', phase: 'starting', reason: { code: 'waiting-container', message: 'Insufficient cpu' }, children: [pod('subtask-1', 'Pending')] });
  const records = [workspace, failedWorkspace, cliReady, cliStopping, cliStopped, volume, subtask];
  // 记录沿用任务环境的 ID：开发会话的 taskId 就是工作区记录的 ID。
  const session = { ...input.devSession, taskId: 'ws-1' as never };
  const topology = () => buildProjectTopology({ ...input, devSession: session, records }, t), byId = (id: string) => topology().nodes.find((n) => n.id === id);

  test('nodes come from records; stopped ones are not drawn and the inventory task pods are not duplicated or left as unknown', () => {
    const ids = topology().nodes.map((n) => n.id);
    for (const id of ['ws-1', 'ws-0', 'cli-1', 'cli-2', 'vol-1', 'sub-1', 'route:dev', 'db:development']) expect(ids).toContain(id);
    expect(ids).not.toContain('cli-3');
    for (const id of ['uid-task-1', 'uid-agent-1', 'uid-subtask-1', 'uid-task-1-work']) expect(ids).not.toContain(id);
    expect(topology().bands.map((b) => b.id)).toEqual(['slot:prod', 'slot:preview', 'dev', 'business', 'jobs', 'other']);
    expect(topology().nodes.filter((n) => n.band === 'other').map((n) => n.id)).toEqual(['uid-mystery']);
    expect(topology().bands.find((b) => b.id === 'dev')?.note).toBe('分支 feature/x · 2 个 Agent');
  });
  test('status and reason are the record phase in the standard words; the running workspace carries the preview route and the development database', () => {
    // 存活按盘点里同一 Pod 的创建时刻（11:00 → 12:40），不按记录进台账的时刻；盘点里没有这个 Pod 时不写存活。
    expect(byId('ws-1')).toMatchObject({ status: 'ready', statusText: '运行中', title: 'task-1', meta: ['重启 2', '存活 1 小时 40 分'], resourceId: 'r-task-1' });
    expect(byId('cli-2')?.meta).toEqual(['重启 0']);
    expect(byId('ws-0')).toMatchObject({ status: 'failed', statusText: '失败 · 检出失败', abnormal: true });
    expect(byId('cli-2')).toMatchObject({ status: 'terminating', statusText: '结束中 · 执行已结束' });
    expect(byId('sub-1')).toMatchObject({ status: 'pending', statusText: '启动中 · Insufficient cpu', abnormal: true, band: 'business', resourceId: 'r-subtask-1' });
    expect(byId('vol-1')).toMatchObject({ kind: 'volume', status: 'ready', statusText: '运行中', meta: ['capacity 10Gi', 'requested 10Gi'] });
    expect(byId('route:dev')).toMatchObject({ status: 'ready', statusText: '运行中' });
    expect(edge(topology(), 'route:dev', 'ws-1')).toMatchObject({ kind: 'routes' });
    expect(edge(topology(), 'ws-1', 'cli-1')).toMatchObject({ kind: 'child' }); expect(edge(topology(), 'ws-1', 'cli-2')).toMatchObject({ kind: 'child' });
    expect(edge(topology(), 'ws-1', 'vol-1')).toMatchObject({ kind: 'mounts' }); expect(edge(topology(), 'cli-1', 'vol-1')).toMatchObject({ kind: 'mounts' });
    expect(edge(topology(), 'ws-1', 'db:development')).toMatchObject({ kind: 'uses' }); expect(edge(topology(), 'ws-0', 'db:development')).toBeUndefined();
    expect(byId('cli-1')?.facts).toContainEqual(['终端', 'term-1']);
  });
  test('an execution whose workspace is no longer drawn is still shown; no records means no task bands', () => {
    const orphan = buildProjectTopology({ ...input, records: [cliReady] }, t);
    expect(orphan.nodes.find((n) => n.id === 'cli-1')?.band).toBe('dev'); expect(orphan.bands.find((b) => b.id === 'dev')?.note).toBe('没有运行中的会话');
    const none = buildProjectTopology({ ...input, records: [cliStopped] }, t);
    expect(none.bands.map((b) => b.id)).toEqual(['slot:prod', 'slot:preview', 'jobs', 'other']);
  });
});
