import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { renderApp } from './renderApp';
import { centerPath, centerSnapshot, resourceCenterFixture, resourceNodeFixture } from './resourceCenterFixture';
import { resourceTopology, resourceSelectionId } from '../features/project-resources/model/topology';
import { resourceDomain, normalizeResourceDomain } from '../features/project-resources/model/domains';
import { matches, parseCenterSearch } from '../features/project-resources/model/workspace';
import { messages } from '../features/project-resources/i18n/zh-CN';
import { translate } from '../shared/lib/i18n';
import { layoutTopology, FULL_METRICS } from '../shared/ui/topology/topologyLayout';

const t = (key: string, values?: Record<string, string | number>) => translate(messages, key, values);
const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });
const domainTypes = {
  project: ['project', 'execution-quota', 'observability', 'repository', 'configuration', 'secret'],
  namespace: ['namespace', 'Namespace', 'namespace-quota', 'ResourceQuota'],
  services: ['service', 'Service', 'Pod', 'Deployment', 'Job', 'service-plan', 'service-slot', 'release', 'compute-profile', 'task-profile', 'runtime-image', 'dev-workspace'],
  storage: ['database', 'PostgresDatabase', 'PostgresRole', 'object-space', 'object-plan', 'data-binding', 'volume', 'PersistentVolumeClaim'],
  network: ['route', 'IngressRoute', 'NetworkPolicy', 'network-policy-set', 'gateway-limit', 'Middleware'],
  platform: ['api-operation', 'event-subscription', 'mcp'],
};

test('technical types and resource counts never expand the topology beyond a project root and five resource domains', () => {
  let height: number | undefined;
  for (const copies of [1, 20]) {
    const snapshot = centerSnapshot();
    snapshot.nodes = Object.entries(domainTypes).flatMap(([domain, types]) => types.flatMap((resourceType) => Array.from({ length: copies }, (_, i) => resourceNodeFixture(`${domain}:${resourceType}:${i}`, { resourceType, kind: resourceType === 'project' ? 'project' : 'resource', category: domain === 'platform' ? 'integration' : 'execution' }))));
    snapshot.edges = [];
    const graph = resourceTopology(snapshot, t), layout = layoutTopology(graph.topology, FULL_METRICS);
    // 按技术类型合并仍产生几十个节点；项目根与五类资源入口必须固定，命名空间不得归入配置。
    expect(graph.topology.nodes.map((node) => node.id).sort()).toEqual(Object.keys(domainTypes).map((domain) => `group:${domain}`).sort());
    for (const [domain, types] of Object.entries(domainTypes)) expect(graph.groups.get(`group:${domain}`)).toHaveLength(types.length * copies);
    expect(layout.height).toBeLessThan(400); if (height !== undefined) expect(layout.height).toBe(height); height = layout.height;
    expect(resourceSelectionId(graph, 'group:execution:PersistentVolumeClaim:development:owned')).toBe('group:storage');
    expect(resourceSelectionId(graph, 'namespace:namespace:0')).toBe('namespace:namespace:0');
  }
});

test('domain permissions filter technical types and restore that filter after exact resource detail closes', async () => {
  const fixture = resourceCenterFixture();
  fixture.state.snapshot.nodes.push(resourceNodeFixture('image', { resourceType: 'runtime-image', name: 'Python 工作镜像', access: 'requestable' }));
  page = await renderApp(`${centerPath}?node=group%3Aservices`);
  const group = document.querySelector<HTMLDialogElement>('dialog[open]'); expect(Boolean(group)).toBe(true);
  const select = group!.querySelector<HTMLSelectElement>('select[aria-label="筛选资源类型"]'); expect(Boolean(select)).toBe(true);
  await act(async () => { select!.value = 'runtime-image'; select!.dispatchEvent(new Event('change', { bubbles: true })); }); await page.settle();
  expect(group!.querySelectorAll('tbody tr')).toHaveLength(1); expect(group!.querySelector('tbody')!.textContent).toContain('Python 工作镜像');
  const details = group!.querySelector<HTMLButtonElement>('tbody button')!;
  await act(async () => { details.focus(); details.click(); }); await page.settle();
  expect(document.querySelectorAll('dialog[open]')).toHaveLength(2);
  await act(async () => [...document.querySelectorAll('dialog[open]')].at(-1)!.dispatchEvent(new Event('cancel', { cancelable: true }))); await page.settle();
  expect(select!.value).toBe('runtime-image'); expect(group!.querySelectorAll('tbody tr')).toHaveLength(1); expect(document.activeElement === details).toBe(true); expect(fixture.writes).toHaveLength(0);
});

test('new resource types stay inside existing domains and legacy category filters resolve consistently', () => {
  for (const [category, domain] of Object.entries({ foundation: 'project', service: 'services', execution: 'services', data: 'storage', integration: 'platform' } as const)) {
    const node = resourceNodeFixture(`future:${category}`, { resourceType: 'future-kind', category: category as 'foundation' });
    expect(resourceDomain(node)).toBe(domain); expect(normalizeResourceDomain(category)).toBe(domain);
    expect(parseCenterSearch({ category }).category).toBe(domain); expect(matches(node, { category: domain })).toBe(true);
  }
  expect(resourceDomain(resourceNodeFixture('unknown', { resourceType: 'future-kind', category: 'future-category' as 'foundation' }))).toBe('project');
  const volume = resourceNodeFixture('volume', { category: 'execution', resourceType: 'PersistentVolumeClaim' });
  expect(matches(volume, { category: 'storage' })).toBe(true); expect(matches(volume, { category: 'services' })).toBe(false);
  const graph = resourceTopology(centerSnapshot(), t);
  expect(resourceSelectionId(graph, 'group:execution:compute-profile')).toBe('group:services');
  expect(resourceSelectionId(graph, 'group:does-not-exist')).toBe('group:does-not-exist');
  expect(resourceSelectionId(graph, undefined)).toBeUndefined();
  expect(resourceSelectionId(graph, 'group:configuration')).toBe('group:project');
  for (const value of ['__proto__', 'constructor', 'toString']) {
    expect(normalizeResourceDomain(value) === undefined).toBe(true);
    expect(resourceDomain(resourceNodeFixture(value, { resourceType: value }))).toBe('services');
  }
});

test('namespace constraints stay with the isolation boundary while project settings and generated service secrets keep their own responsibility', () => {
  const snapshot = centerSnapshot();
  snapshot.nodes.push(resourceNodeFixture('namespace', { resourceType: 'Namespace', category: 'foundation' }), resourceNodeFixture('namespace-limit', { resourceType: 'ResourceQuota', category: 'foundation' }), resourceNodeFixture('variable', { resourceType: 'secret', category: 'foundation' }), resourceNodeFixture('generated-credential', { resourceType: 'Secret', category: 'service' }));
  snapshot.edges.push({ id: 'namespace-use', sourceId: 'node-000', targetId: 'namespace-limit', relation: 'consumes-quota', state: 'configured', label: '命名空间约束' });
  const graph = resourceTopology(snapshot, t);
  expect(graph.groups.get('group:namespace')!.map((node) => node.id)).toEqual(['namespace', 'namespace-limit']);
  expect(graph.groups.get('group:project')!.map((node) => node.id)).toEqual(['execution-limit', 'variable']);
  expect(graph.aliases.get('generated-credential')).toBe('group:services');
  expect(graph.topology.edges).toContainEqual(expect.objectContaining({ from: 'group:services', to: 'group:namespace', kind: 'uses', evidence: 'configured' }));
  expect(graph.topology.nodes.find((node) => node.id === 'group:namespace')!.semantic).toBe('security');
});
