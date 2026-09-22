import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import type { ClusterResource } from '@crewstation/contracts';
import { renderApp } from './renderApp';
import { clusterFixture } from './clusterManagementFixture';
import { summaryFixture } from './projectSummaryFixture';

// RFC-019 三处入口：运行与诊断的形态页签（成员只读盘点）、概览的横带汇总卡、集群管理的拓扑页签三层。
const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; sessionStorage.clear(); });
const projectId = '01a0bf5d-8f4b-7e1e-8dde-c9c2ae13ed34', serviceId = '01a0bf5d-8f4b-760b-86b6-0bb9f08a9eaa', time = new Date().toISOString();
const project = { id: projectId, serviceId, name: '团队知识助理', slug: 'team-knowledge', kind: 'DigitalWorker', state: 'active', namespace: 'cs-team-knowledge', ownerUserId: '01a0bf5d-8f4b-7f8b-8136-e631380738b0', createdAt: time };
const resource = (over: Partial<ClusterResource> & { name: string; kind: string }): ClusterResource => ({ resourceId: `r-${over.name}`, apiVersion: 'v1', namespace: 'cs-team-knowledge', uid: `uid-${over.name}`, resourceVersion: '1', revision: '1', observedAt: time, createdAt: time, view: over.kind === 'Pod' ? 'pods' : 'workloads', ownership: { scope: 'project', projectId, projectName: '团队知识助理', slug: 'team-knowledge', projectKind: 'DigitalWorker', archived: false }, purpose: 'digital-worker-service', phase: 'Running', ready: true, abnormal: false, reason: '', topLevel: over.kind !== 'Pod', standalone: false, restarts: 0, labels: {}, owners: [], references: [], containers: [], facts: {}, availableActions: [], ...over });
const inventory = { snapshotId: 'snap-1', observedAt: time, complete: true, sources: [], truncated: false, items: [
  resource({ name: 'team-knowledge-blue', kind: 'Deployment', slotRole: 'prod', physicalSlot: 'blue', desired: 1, readyReplicas: 1 }),
  resource({ name: 'team-knowledge-blue-1', kind: 'Pod', slotRole: 'prod', physicalSlot: 'blue', node: 'node-a', containers: [{ name: 'app', init: false, image: 'knowledge:v1', ready: true, restarts: 0, state: 'running', requests: {}, limits: {}, ports: [] }] }),
  resource({ name: 'subtask-9', kind: 'Pod', purpose: 'business-subtask', phase: 'Pending', ready: false, abnormal: true, reason: 'Insufficient cpu', taskId: 'sub-9' }),
] };
const nodes = () => [...document.querySelectorAll('[role="button"][data-node-id]')].map((n) => n.getAttribute('data-node-id'));
const clickNode = async (id: string) => { await act(async () => { document.querySelector(`[data-node-id="${id}"]`)!.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); await page!.settle(); };

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
    return Response.json(body, { status });
  }) as typeof fetch;
  return calls;
}

test('operations tab assembles the member inventory with slots and data into the diagram; detail is read-only and leads to logs', async () => {
  const calls = memberFixture(); page = await renderApp(`/projects/${projectId}/operations?tab=topology`);
  expect(calls.some((path) => path === `/v1/projects/${projectId}/cluster-resources`)).toBe(true);
  expect(page.text()).toContain('快照完整'); expect(page.text()).toContain('线上槽 prod · blue'); expect(page.text()).toContain('业务任务');
  expect(nodes().sort()).toEqual(['db:production', 'route:prod', 'uid-subtask-9', 'uid-team-knowledge-blue', 'uid-team-knowledge-blue-1'].sort());
  expect(document.querySelector('[data-node-id="uid-subtask-9"]')?.getAttribute('aria-label')).toContain('Insufficient cpu');
  await clickNode('uid-team-knowledge-blue-1');
  expect(page.text()).toContain('knowledge:v1'); expect(page.text()).toContain('管理动作（重启、扩缩、删除）仍在集群管理的资源详情里');
  expect(page.text()).not.toContain('调整副本');
  await page.click('查看日志'); expect(page.search()).toMatchObject({ tab: 'logs', source: 'slot', slot: 'prod' });
});

test('a refused member sees the refusal from the inventory route, not an empty diagram', async () => {
  // 测试员进不了运行与诊断页（路由层已拦），这里模拟的是权限被撤后接口 403 的成员。
  memberFixture(true); page = await renderApp(`/projects/${projectId}/operations?tab=topology`);
  expect(page.text()).toContain('角色 tester 不能执行 develop'); expect(nodes()).toEqual([]);
});

test('the overview shows one summary card per band and links to the full topology', async () => {
  const f = summaryFixture(), inner = globalThis.fetch;
  f.item.slots = { status: 'ready', checkedAt: time, value: [{ name: 'prod', active: true, tag: 'v1.0.0', commitSha: 'a'.repeat(40), replicas: 1, readyReplicas: 1, state: 'ready', host: 'formal.test' }] };
  globalThis.fetch = (async (raw, init) => String(raw).endsWith('/cluster-resources') ? Response.json({ ...inventory, items: inventory.items.map((item) => ({ ...item, ownership: { ...item.ownership, projectId: f.item.project.id } })) }) : inner(raw, init)) as typeof fetch;
  page = await renderApp(`/projects/${f.item.project.id}`);
  expect(page.text()).toContain('部署与运行形态'); expect(page.text()).toContain('工作负载 1 · Pod 2，就绪 1，运行 0'); expect(page.text()).toContain('1 个需要关注');
  expect(nodes()).toEqual(['band:slot:prod', 'band:business']);
  expect(document.querySelector('a[href*="tab=topology"]')?.textContent).toBe('查看完整形态 →');
  await clickNode('band:business'); expect(page.search()).toMatchObject({ tab: 'topology' });
});

test('cluster topology tab walks system → projects → pod layer and reuses the resource detail', async () => {
  const f = clusterFixture(); page = await renderApp('/admin/cluster?tab=topology');
  expect(page.text()).toContain('crewstation-system 命名空间'); expect(page.text()).toContain('虚线为静态架构标注，不是实测');
  expect(nodes()).toContain('cs-api'); expect(nodes()).toContain('users');
  await clickNode('cs-api'); expect(page.text()).toContain('uid-cs-api');
  await page.click('项目层 · 1'); expect(page.search()).toMatchObject({ layer: 'projects' });
  expect(page.text()).toContain('正常 · 1 个项目'); expect(nodes()).toEqual([`project:${f.projectId}`]);
  await clickNode(`project:${f.projectId}`); await page.click('展开该项目的 Pod 层');
  expect(page.search()).toMatchObject({ layer: 'project', projectId: f.projectId });
  expect(page.text()).toContain('项目层 › 集群验收'); expect(nodes()).toContain('uid-original'); expect(nodes()).toContain('route:preview');
  await clickNode('uid-original'); expect(page.text()).toContain('工作卷仍被引用');
  await page.click('返回项目层'); expect(page.search()).toMatchObject({ layer: 'projects' });
});
