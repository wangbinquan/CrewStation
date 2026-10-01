import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { renderApp } from './renderApp';
import { centerPath, centerProject, centerSnapshot, resourceCenterFixture, resourceNodeFixture } from './resourceCenterFixture';
import { resourceTopology, filterResourceTopology } from '../features/project-resources/model/topology';
import { messages } from '../features/project-resources/i18n/zh-CN';
import { translate } from '../shared/lib/i18n';
import { layoutTopology, FULL_METRICS } from '../shared/ui/topology/topologyLayout';

const t = (key: string, values?: Record<string, string | number>) => translate(messages, key, values);
const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });
const dialog = () => [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].at(-1)!;
async function escape() { await act(async () => dialog().dispatchEvent(new Event('cancel', { cancelable: true }))); await page!.settle(); }
async function openGroup() {
  const trigger = document.querySelector<SVGSVGElement>('[data-node-id="group:services"]');
  expect(Boolean(trigger)).toBe(true);
  await act(async () => { trigger!.focus(); trigger!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  await page!.settle();
  return trigger!;
}

test('a domain has one stable card even for a single member or hundreds of members', () => {
  let height: number | undefined;
  for (const count of [1, 2, 4, 400]) {
    const snapshot = centerSnapshot();
    snapshot.nodes = [resourceNodeFixture('project', { kind: 'project', category: 'foundation', resourceType: 'project' }), ...Array.from({ length: count }, (_, i) => resourceNodeFixture(`profile-${i}`, { environment: i % 2 ? 'development' : 'production', access: i % 2 ? 'requestable' : 'owned' }))];
    snapshot.edges = [];
    const graph = resourceTopology(snapshot, t), layout = layoutTopology(graph.topology, FULL_METRICS);
    // 原数量阈值和环境／权限拆分令同类节点随成员规模增加，首屏不再可读。
    expect(graph.topology.nodes.map((n) => n.id).sort()).toEqual(['group:configuration', 'group:services']);
    expect(graph.groups.get('group:services')).toHaveLength(count);
    expect(graph.displayed.get('group:services')!.metrics).toEqual([]);
    if (height !== undefined) expect(layout.height).toBe(height);
    height = layout.height;
  }
});

test('mixed permissions and environments retain member identities and directed evidence without inheriting the first permission', () => {
  const snapshot = centerSnapshot(), root = resourceNodeFixture('project', { kind: 'project', category: 'foundation', resourceType: 'project' });
  snapshot.nodes = [root, resourceNodeFixture('owned', { environment: 'production', pendingRequestIds: ['request-1'] }), resourceNodeFixture('available', { kind: 'catalog', environment: 'development', access: 'requestable' }), resourceNodeFixture('pending', { kind: 'request', resourceId: 'request-1', access: 'pending', pendingRequestIds: ['request-1'], state: 'pending' }), resourceNodeFixture('private', { access: 'unavailable' })];
  snapshot.edges = ['owned', 'available'].map((id) => ({ id, sourceId: root.id, targetId: id, relation: 'grants' as const, state: 'configured' as const, label: '授权' }));
  snapshot.edges.push({ id: 'observation', sourceId: root.id, targetId: 'owned', relation: 'grants', state: 'observed', label: '授权' });
  const before = JSON.stringify(snapshot), graph = resourceTopology(snapshot, t), card = graph.topology.nodes.find((n) => n.id === 'group:services')!;
  expect(graph.groups.get(card.id)!.map((n) => n.id)).toEqual(['owned', 'available', 'pending', 'private']);
  expect(card.statusText).toBe('权限列表'); expect(card.status).toBe('pending'); expect(card.lane).toBe(1);
  expect(card.counts).toEqual([['已有能力', '1'], ['可以申请', '1'], ['未完成变更', '1']]);
  expect(graph.topology.edges).toHaveLength(2);
  expect(graph.topology.edges.map((e) => [e.from, e.to, e.evidence])).toEqual([['group:configuration', card.id, 'configured'], ['group:configuration', card.id, 'observed']]);
  expect(JSON.stringify(snapshot)).toBe(before);
  const filtered = filterResourceTopology(graph, new Set(['available']));
  expect(filtered.nodes.some((n) => n.id === card.id)).toBe(true);
});

test('ledger, observations and services share domain cards while retaining independent quota scopes and original identities', () => {
  const snapshot = centerSnapshot();
  snapshot.nodes = [resourceNodeFixture('grant', { category: 'data', resourceType: 'database', metrics: [{ key: 'storage', label: '空间', unit: 'GiB', scopeId: 'database:grant', limit: 8, used: 2, reserved: 0, requestedLimit: null, limitKind: 'value', observedAt: snapshot.observedAt }] }), resourceNodeFixture('observed', { category: 'data', resourceType: 'PostgresDatabase', kind: 'resource', source: 'observed', environment: 'production' }), resourceNodeFixture('business-service', { category: 'service', resourceType: 'service' }), resourceNodeFixture('k8s-service', { category: 'service', resourceType: 'Service', kind: 'resource' })];
  snapshot.edges = [{ id: 'internal', sourceId: 'grant', targetId: 'observed', relation: 'owns', state: 'observed', label: '数据库实体' }];
  const graph = resourceTopology(snapshot, t);
  expect(graph.topology.nodes.map((n) => n.id).sort()).toEqual(['group:services', 'group:storage']);
  expect(graph.groups.get('group:storage')!.map((n) => n.id)).toEqual(['grant', 'observed']);
  expect(graph.groups.get('group:storage')![0]!.metrics[0]).toMatchObject({ scopeId: 'database:grant', limit: 8 });
  expect(graph.displayed.get('group:storage')!.metrics).toEqual([]); expect(graph.topology.edges).toEqual([]);
  expect(snapshot.edges).toHaveLength(1);
});

test('group permissions are searchable and paginated; member close preserves the last row, context and SVG focus', async () => {
  const f = resourceCenterFixture(); page = await renderApp(centerPath);
  const trigger = await openGroup(), group = dialog();
  expect(group.textContent).toContain('资源权限'); expect(group.textContent).toContain('仅查看');
  const search = group.querySelector<HTMLInputElement>('input[aria-label="搜索权限列表"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'node-0'); search.dispatchEvent(new Event('input', { bubbles: true })); search.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true })); }); await page.settle();
  await page.click('加载更多');
  const row = [...group.querySelectorAll('tr')].find((r) => r.textContent?.includes('node-078'))!, details = row.querySelector<HTMLButtonElement>('button')!;
  group.scrollTop = 650;
  await act(async () => { details.focus(); details.click(); }); await page.settle();
  expect(document.querySelectorAll('dialog[open]')).toHaveLength(2); expect(dialog().textContent).toContain('node-078'); expect(dialog().closest('tr') === null).toBe(true);
  await escape();
  expect(dialog() === group).toBe(true); expect(search.value).toBe('node-0'); expect(group.scrollTop).toBe(650); expect(document.activeElement === details).toBe(true);
  expect([...group.querySelectorAll('tr')].some((r) => r.textContent?.includes('node-078'))).toBe(true);
  await escape(); expect(document.querySelectorAll('dialog[open]')).toHaveLength(0); expect(document.activeElement === trigger).toBe(true); expect(f.writes).toHaveLength(0);
});

test('administrator group lists keep permissions and original actions separate across environments', async () => {
  const f = resourceCenterFixture('admin'), action = f.state.snapshot.nodes[0]!.actions[0]!;
  f.state.snapshot.nodes = [resourceNodeFixture('profile-owned', { name: '生产已授权档位', environment: 'production', actions: [{ ...action, target: { resourceType: 'compute-profile', resourceId: 'profile-owned', action: 'revoke' } }] }), resourceNodeFixture('profile-open', { name: '开发可申请档位', environment: 'development', access: 'requestable', kind: 'catalog', actions: [{ ...action, target: { resourceType: 'compute-profile', resourceId: 'profile-open', action: 'grant' } }] })];
  f.state.snapshot.edges = [];
  page = await renderApp(`/admin/projects/${centerProject}/resources`); await openGroup();
  expect(dialog().textContent).toContain('资源权限'); expect(dialog().textContent).toContain('生产'); expect(dialog().textContent).toContain('开发'); expect(dialog().textContent).toContain('直接分配'); expect(dialog().textContent).toContain('撤销授权');
  const filter = dialog().querySelector<HTMLSelectElement>('select[aria-label="筛选资源权限"]')!;
  await act(async () => { filter.value = 'requestable'; filter.dispatchEvent(new Event('change', { bubbles: true })); }); await page.settle();
  expect([...dialog().querySelectorAll('tbody tr')].map((r) => r.textContent?.includes('开发可申请档位'))).toEqual([true]);
  const row = dialog().querySelector('tbody tr')!, details = row.querySelector<HTMLButtonElement>('button')!;
  await act(async () => details.click()); await page.settle();
  expect(dialog().textContent).toContain('开发可申请档位'); expect([...dialog().querySelectorAll('button')].some((b) => b.textContent === '直接分配')).toBe(true);
  expect(f.writes).toHaveLength(0);
});

test('archived group permission lists show read-only access even when a cached descriptor is enabled', async () => {
  const f = resourceCenterFixture('admin'); f.state.snapshot.archived = true;
  page = await renderApp(`/admin/projects/${centerProject}/resources?node=group%3Aexecution%3Aexecution-quota`);
  const group = dialog();
  expect(group.textContent).toContain('资源权限'); expect(group.textContent).toContain('仅查看');
  expect(group.querySelector('tbody')!.textContent).not.toContain('调整配额');
  await act(async () => group.querySelector<HTMLButtonElement>('tbody button')!.click()); await page.settle();
  expect([...dialog().querySelectorAll('button')].find((b) => b.textContent === '调整配额')!.disabled).toBe(true);
  expect(f.writes).toHaveLength(0);
});

test('narrow topology keeps grouped permissions instead of expanding every resource into the fallback list', async () => {
  const originalMatchMedia = window.matchMedia;
  window.matchMedia = (query) => ({ matches: query === '(max-width: 640px)', media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => true });
  try {
    const f = resourceCenterFixture('developer'); page = await renderApp(centerPath);
    const stage = document.querySelector('[role="tabpanel"]')!;
    // 窄屏不能把已聚合类型重新展开成几十行，须复用同一组及其权限入口。
    expect(stage.querySelector('table') === null).toBe(true); expect(stage.querySelectorAll('button')).toHaveLength(2);
    await page.click('服务与算力');
    expect(dialog().textContent).toContain('资源权限'); expect(dialog().textContent).toContain('仅查看');
    expect(f.writes).toHaveLength(0);
  } finally { window.matchMedia = originalMatchMedia; }
});

test('old group bookmarks open the new permission list while old member bookmarks retain exact detail', async () => {
  resourceCenterFixture(); page = await renderApp(`${centerPath}?node=group%3Aexecution%3Acompute-profile%3Aproject%3Aowned`);
  expect(document.querySelectorAll('dialog[open]')).toHaveLength(1); expect(dialog().textContent).toContain('资源权限'); expect(dialog().textContent).toContain('node-000');
  page.unmount(); page = undefined;
  resourceCenterFixture(); page = await renderApp(`${centerPath}?node=node-078`);
  expect(document.querySelectorAll('dialog[open]')).toHaveLength(1); expect(dialog().textContent).toContain('node-078'); expect(dialog().textContent).toContain('资源标识');
});
