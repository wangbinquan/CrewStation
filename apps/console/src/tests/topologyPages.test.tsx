import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import type { ClusterResource, ResourceRecord } from '@crewstation/contracts';
import { ProjectIdSchema } from '@crewstation/contracts';
import { renderApp } from './renderApp';
import { clusterFixture } from './clusterManagementFixture';
import { summaryFixture } from './projectSummaryFixture';
import { FakeEventSource, resourceRecord, resourceView } from './resourceRecordFixture';

// RFC-019 三处入口：运行与诊断的形态页签（成员只读盘点）、概览的横带汇总卡、集群管理的拓扑页签三层。
const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; sessionStorage.clear(); delete (globalThis as { EventSource?: unknown }).EventSource; FakeEventSource.reset(); });
const projectId = '01a0bf5d-8f4b-7e1e-8dde-c9c2ae13ed34', serviceId = '01a0bf5d-8f4b-760b-86b6-0bb9f08a9eaa', time = new Date().toISOString();
const project = { id: projectId, serviceId, name: '团队知识助理', slug: 'team-knowledge', kind: 'DigitalWorker', state: 'active', namespace: 'cs-team-knowledge', ownerUserId: '01a0bf5d-8f4b-7f8b-8136-e631380738b0', createdAt: time };
const resource = (over: Partial<ClusterResource> & { name: string; kind: string }): ClusterResource => ({ resourceId: `r-${over.name}`, apiVersion: 'v1', namespace: 'cs-team-knowledge', uid: `uid-${over.name}`, resourceVersion: '1', revision: '1', observedAt: time, createdAt: time, view: over.kind === 'Pod' ? 'pods' : 'workloads', ownership: { scope: 'project', projectId, projectName: '团队知识助理', slug: 'team-knowledge', projectKind: 'DigitalWorker', archived: false }, purpose: 'digital-worker-service', phase: 'Running', ready: true, abnormal: false, reason: '', topLevel: over.kind !== 'Pod', standalone: false, restarts: 0, labels: {}, owners: [], references: [], containers: [], facts: {}, availableActions: [], ...over });
const inventory = { snapshotId: 'snap-1', observedAt: time, complete: true, sources: [], truncated: false, items: [
  resource({ name: 'team-knowledge-blue', kind: 'Deployment', slotRole: 'prod', physicalSlot: 'blue', desired: 1, readyReplicas: 1 }),
  resource({ name: 'team-knowledge-blue-1', kind: 'Pod', slotRole: 'prod', physicalSlot: 'blue', node: 'node-a', containers: [{ name: 'app', init: false, image: 'knowledge:v1', ready: true, restarts: 0, state: 'running', requests: {}, limits: {}, ports: [] }] }),
  resource({ name: 'subtask-9', kind: 'Pod', purpose: 'business-subtask', phase: 'Pending', ready: false, abnormal: true, reason: 'Insufficient cpu', taskId: 'sub-9' }),
] };
// RFC-025：业务子任务的状态来自资源台账；盘点里同一个 Pod（按 UID 对上）只补容器与日志入口。
const subtaskId = '01a0bf5d-8f4b-7e1e-8dde-c9c2ae13ef09';
const subtask = resourceRecord({ id: subtaskId, kind: 'agent-execution', purpose: 'business-subtask', phase: 'starting', reason: { code: 'waiting-container', message: '0/1 nodes are available: 1 Insufficient cpu.' },
  children: [{ kind: 'Pod', namespace: 'cs-team-knowledge', name: 'subtask-9', uid: 'uid-subtask-9', phase: 'Pending', ready: false }] });
let records: ResourceRecord[] = [subtask];
const nodes = () => [...document.querySelectorAll('[role="button"][data-node-id]')].map((n) => n.getAttribute('data-node-id'));
const byText = (selector: string, text: string) => [...document.querySelectorAll(selector)].find((n) => n.textContent?.trim() === text) ?? null;
// 详情栏的操作按钮在事实与表格之前：详情很长时不必滚到底才够得着。
const precedes = (a: Element | null, b: Element | null) => !!a && !!b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
const clickNode = async (id: string) => { await act(async () => { document.querySelector(`[data-node-id="${id}"]`)!.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); await page!.settle(); };

test('集群项目拓扑使用全平台台账并随推送结束 CLI，不混入其他项目记录', async () => {
  const f = clusterFixture();
  const workspace = resourceRecord({ id: subtaskId, projectId: ProjectIdSchema.parse(f.projectId), purpose: 'development-workspace' });
  const cli = resourceRecord({ id: '01a0bf5d-8f4b-7e1e-8dde-c9c2ae13ef10', projectId: ProjectIdSchema.parse(f.projectId), kind: 'agent-execution', parentId: workspace.id, purpose: 'development-cli' });
  const foreign = resourceRecord({ id: '01a0bf5d-8f4b-7e1e-8dde-c9c2ae13ef11', projectId: ProjectIdSchema.parse('01a0bf5d-8f4b-7e1e-8dde-c9c2ae13ef12') });
  f.records.push(workspace, cli, foreign);
  (globalThis as { EventSource?: unknown }).EventSource = FakeEventSource;
  page = await renderApp(`/admin/cluster?tab=topology&layer=project&projectId=${f.projectId}&scope=project`);
  expect(nodes()).toContain(cli.id); expect(nodes()).not.toContain(foreign.id);
  expect(FakeEventSource.opened.map((source) => source.url)).toEqual(['/v1/admin/resources/stream?cursor=1']);
  await act(async () => { FakeEventSource.opened[0]!.emit({ type: 'upsert', record: { ...cli, phase: 'stopping', version: 2 }, counts: {}, cursor: 2 }); });
  await page.settle();
  expect(document.querySelector(`[data-node-id="${cli.id}"]`)?.getAttribute('aria-label')).toContain('结束中');
  await act(async () => { FakeEventSource.opened[0]!.emit({ type: 'upsert', record: { ...cli, phase: 'stopped', version: 3 }, counts: {}, cursor: 3 }); });
  await page.settle();
  expect(nodes()).not.toContain(cli.id); expect(nodes()).toContain(workspace.id);
  expect(f.calls.filter((call) => call.path === '/v1/admin/resources')).toHaveLength(1);
});

function memberFixture(refused = false) {
  const role = 'owner';
  const calls: string[] = [];
  globalThis.fetch = (async (raw) => {
    const url = new URL(String(raw), 'http://localhost'); calls.push(url.pathname); let status = 200, body: unknown = { items: [] };
    if (url.pathname === '/v1/me') body = { id: 'user', name: '小林', platformRole: 'developer', isAdmin: false, memberships: [{ projectId, role }] };
    else if (url.pathname === `/v1/projects/${projectId}`) body = project;
    else if (url.pathname === `/v1/workbench/project-summaries/${projectId}`) body = { project, role, development: { status: 'ready', value: null, checkedAt: time }, slots: { status: 'ready', value: [], checkedAt: time }, health: { status: 'unknown', reason: 'not-provided', checkedAt: time }, releases: { status: 'ready', value: [], checkedAt: time }, switches: { status: 'ready', value: [], checkedAt: time }, checkedAt: time };
    else if (url.pathname.endsWith('/cluster-resources')) { if (refused) { status = 403; body = { error: 'forbidden', message: '角色 tester 不能执行 develop' }; } else body = inventory; }
    else if (url.pathname.endsWith('/slots')) body = { items: [{ name: 'prod', active: true, tag: 'v1.0.0', commitSha: 'a'.repeat(40), replicas: 1, readyReplicas: 1, state: 'ready', host: 'knowledge.cs.localhost' }] };
    else if (url.pathname.endsWith('/dev-session')) { status = 404; body = { error: 'not_found', message: '没有开发会话' }; }
    else if (url.pathname.endsWith('/data/resources')) body = { items: [{ id: 'd1', projectId, kind: 'postgres', env: 'production', plan: 'db-small', state: 'ready', envVar: 'CS_DATABASE_URL', createdAt: time }] };
    else if (url.pathname === `/v1/projects/${projectId}/resources`) body = resourceView(records);
    return Response.json(body, { status });
  }) as typeof fetch;
  return calls;
}

test('operations tab assembles the member inventory with slots and data into the diagram; detail is read-only and leads to logs', async () => {
  const calls = memberFixture(); page = await renderApp(`/projects/${projectId}/operations?tab=topology`);
  expect(calls.some((path) => path === `/v1/projects/${projectId}/cluster-resources`)).toBe(true);
  expect(page.text()).toContain('观测于'); expect(page.text()).toContain('线上槽 prod · blue'); expect(page.text()).toContain('业务任务');
  expect(calls).toContain(`/v1/projects/${projectId}/resources`);
  expect(nodes().sort()).toEqual(['db:production', 'route:prod', subtaskId, 'uid-team-knowledge-blue', 'uid-team-knowledge-blue-1'].sort());
  expect(document.querySelector(`[data-node-id="${subtaskId}"]`)?.getAttribute('aria-label')).toContain('启动中 · 0/1 nodes are available: 1 Insufficient cpu.');
  await clickNode('uid-team-knowledge-blue-1');
  expect(page.text()).toContain('knowledge:v1'); expect(page.text()).toContain('管理动作（重启、扩缩、删除）仍在集群管理的资源详情里');
  expect(page.text()).not.toContain('调整副本');
  expect(precedes(byText('button', '查看日志'), document.querySelector('dl'))).toBe(true);
  await page.click('查看日志'); expect(page.search()).toMatchObject({ tab: 'logs', source: 'slot', slot: 'prod' });
});

// RFC-025 RC-02：关掉的 CLI 由推送流带来「结束中」「已结束」，图上随之变化，不必等 15 秒一次的盘点。
test('the diagram follows the resource stream: a closing CLI turns to stopping and disappears once stopped, without re-reading', async () => {
  const workspaceId = '01a0bf5d-8f4b-7e1e-8dde-c9c2ae13ef01', cliId = '01a0bf5d-8f4b-7e1e-8dde-c9c2ae13ef02';
  const workspace = resourceRecord({ id: workspaceId, purpose: 'development-workspace', display: { branch: 'main' }, children: [{ kind: 'Pod', namespace: 'cs-team-knowledge', name: 'task-ws', uid: 'uid-task-ws', phase: 'Running', ready: true }] });
  const cli = resourceRecord({ id: cliId, kind: 'agent-execution', purpose: 'development-cli', parentId: workspaceId, display: { terminal: 'term-1' }, children: [{ kind: 'Pod', namespace: 'cs-team-knowledge', name: 'task-cli', uid: 'uid-task-cli', phase: 'Running', ready: true }] });
  records = [workspace, cli];
  (globalThis as { EventSource?: unknown }).EventSource = FakeEventSource;
  const calls = memberFixture(); page = await renderApp(`/projects/${projectId}/operations?tab=topology`);
  try {
    expect(nodes()).toContain(cliId); expect(FakeEventSource.opened.map((source) => source.url)).toEqual([`/v1/projects/${projectId}/resources/stream?cursor=1`]);
    await act(async () => { FakeEventSource.opened[0]!.emit({ type: 'upsert', record: { ...cli, phase: 'stopping', version: 2, reason: { code: 'execution-ended', message: '执行已结束' } }, counts: {}, cursor: 2 }); });
    await page.settle();
    expect(document.querySelector(`[data-node-id="${cliId}"]`)?.getAttribute('aria-label')).toContain('结束中 · 执行已结束');
    await act(async () => { FakeEventSource.opened[0]!.emit({ type: 'upsert', record: { ...cli, phase: 'stopped', version: 3, children: [] }, counts: {}, cursor: 3 }); });
    await page.settle();
    expect(nodes()).not.toContain(cliId); expect(nodes()).toContain(workspaceId);
    expect(calls.filter((path) => path === `/v1/projects/${projectId}/resources`)).toHaveLength(1);
  } finally { records = [subtask]; }
});

test('the health tab reads the service-slot records: both slots from the snapshot, crash looping arrives through the stream without re-reading', async () => {
  const at = '2026-09-24T01:00:00.000Z';
  const deployment = (name: string, replicas: number, readyReplicas: number) => ({ kind: 'Deployment', namespace: 'cs-team-knowledge', name, phase: replicas ? 'Available' : 'absent', ready: replicas === readyReplicas && replicas > 0, ...(replicas ? { replicas, readyReplicas } : {}) });
  const prod = resourceRecord({ id: '01a0bf5d-8f4b-7e1e-8dde-c9c2ae13ef21', kind: 'service-slot', owner: { module: 'release', ref: `${serviceId}/blue` }, phaseSince: at, display: { physical: 'blue', role: 'prod' },
    children: [deployment('team-knowledge-blue', 1, 1), { kind: 'Pod', namespace: 'cs-team-knowledge', name: 'team-knowledge-blue-5d8f7c-a1', phase: 'Running', ready: true, restarts: 0 }] });
  const preview = resourceRecord({ id: '01a0bf5d-8f4b-7e1e-8dde-c9c2ae13ef22', kind: 'service-slot', owner: { module: 'release', ref: `${serviceId}/green` }, phase: 'stopped', phaseSince: at, reason: { code: 'offline-manual', message: '已由成员手动下线' },
    display: { physical: 'green', role: 'preview' }, children: [deployment('team-knowledge-green', 0, 0)] });
  records = [prod, preview];
  (globalThis as { EventSource?: unknown }).EventSource = FakeEventSource;
  const calls = memberFixture(); page = await renderApp(`/projects/${projectId}/operations?tab=health`);
  const card = (label: string) => [...document.querySelectorAll('dl')].map((facts) => facts.parentElement!).find((slot) => slot.textContent?.includes(label))?.textContent ?? '';
  try {
    expect(card('正式版本（prod）')).toContain('健康'); expect(card('正式版本（prod）')).toContain('1 / 1');
    expect(card('待验证版本（preview）')).toContain('未知'); expect(card('待验证版本（preview）')).toContain('0 / 0');
    await act(async () => { FakeEventSource.opened[0]!.emit({ type: 'upsert', record: { ...prod, phase: 'degraded', version: 2, conditions: [{ type: 'CrashLooping', status: 'true', reason: 'restarting', since: at }],
      children: [deployment('team-knowledge-blue', 1, 1), { kind: 'Pod', namespace: 'cs-team-knowledge', name: 'team-knowledge-blue-5d8f7c-a1', phase: 'Running', ready: true, restarts: 3 }] }, counts: {}, cursor: 2 }); });
    await page.settle();
    expect(card('正式版本（prod）')).toContain('反复重启'); expect(card('正式版本（prod）')).toContain('3');
    expect(calls.some((path) => path.endsWith('/health'))).toBe(false);
    expect(calls.filter((path) => path === `/v1/projects/${projectId}/resources`)).toHaveLength(1);
  } finally { records = [subtask]; }
});

test('a refused member sees the refusal from the inventory route, not an empty diagram', async () => {
  // 测试员进不了运行与诊断页（路由层已拦），这里模拟的是权限被撤后接口 403 的成员。
  memberFixture(true); page = await renderApp(`/projects/${projectId}/operations?tab=topology`);
  expect(page.text()).toContain('角色 tester 不能执行 develop'); expect(nodes()).toEqual([]);
});

test('the overview shows one summary card per band and links to the full topology', async () => {
  const f = summaryFixture(), inner = globalThis.fetch;
  f.item.slots = { status: 'ready', checkedAt: time, value: [{ name: 'prod', active: true, tag: 'v1.0.0', commitSha: 'a'.repeat(40), replicas: 1, readyReplicas: 1, state: 'ready', host: 'formal.test' }] };
  f.records = [subtask];
  globalThis.fetch = (async (raw, init) => String(raw).endsWith('/cluster-resources') ? Response.json({ ...inventory, items: inventory.items.map((item) => ({ ...item, ownership: { ...item.ownership, projectId: f.item.project.id } })) }) : inner(raw, init)) as typeof fetch;
  page = await renderApp(`/projects/${f.item.project.id}`);
  expect(page.text()).toContain('部署与运行形态'); expect(page.text()).toContain('工作负载 1 · Pod 2，就绪 1，运行 0'); expect(page.text()).toContain('1 个需要关注');
  expect(nodes()).toEqual(['band:slot:prod', 'band:business']);
  expect([...document.querySelectorAll('a[href*="tab=topology"]')].map((node) => node.textContent)).toContain('查看完整形态');
  await clickNode('band:business'); expect(page.search()).toMatchObject({ tab: 'topology' });
});

test('cluster topology tab walks system → projects → pod layer and reuses the resource detail', async () => {
  const f = clusterFixture(); page = await renderApp('/admin/cluster?tab=topology');
  expect(page.text()).toContain('crewstation-system 命名空间'); expect(page.text()).toContain('虚线为静态架构标注，不是实测');
  expect(nodes()).toContain('cs-api'); expect(nodes()).toContain('users');
  await clickNode('cs-api'); expect(page.text()).toContain('uid-cs-api');
  await page.click('项目层 · 1'); expect(page.search()).toMatchObject({ layer: 'projects' });
  expect(page.text()).toContain('正常 · 1 个项目'); expect(nodes()).toEqual([`project:${f.projectId}`]);
  await clickNode(`project:${f.projectId}`); expect(precedes(byText('button', '展开该项目的 Pod 层'), document.querySelector('dl'))).toBe(true);
  await page.click('展开该项目的 Pod 层');
  expect(page.search()).toMatchObject({ layer: 'project', projectId: f.projectId });
  expect(page.text()).toContain('项目层 › 集群验收'); expect(nodes()).toContain('uid-original'); expect(nodes()).toContain('route:preview');
  await clickNode('uid-original'); expect(page.text()).toContain('工作卷仍被引用');
  expect(precedes(byText('button', '重启'), document.querySelector('section[aria-label="资源详情"] [role="tablist"]'))).toBe(true);
  await page.click('返回项目层'); expect(page.search()).toMatchObject({ layer: 'projects' });
});
