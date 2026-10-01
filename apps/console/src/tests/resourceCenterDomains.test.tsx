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
  configuration: ['project', 'namespace', 'Namespace', 'namespace-quota', 'ResourceQuota', 'execution-quota', 'observability', 'repository', 'configuration', 'secret'],
  services: ['service', 'Service', 'Pod', 'Deployment', 'Job', 'service-plan', 'service-slot', 'release', 'compute-profile', 'task-profile', 'runtime-image', 'dev-workspace'],
  storage: ['database', 'PostgresDatabase', 'PostgresRole', 'object-space', 'object-plan', 'data-binding', 'volume', 'PersistentVolumeClaim'],
  network: ['route', 'IngressRoute', 'NetworkPolicy', 'network-policy-set', 'gateway-limit', 'Middleware'],
  platform: ['api-operation', 'event-subscription', 'mcp'],
};

test('technical types and resource counts never expand the topology beyond five project domains', () => {
  let height: number | undefined;
  for (const copies of [1, 20]) {
    const snapshot = centerSnapshot();
    snapshot.nodes = Object.entries(domainTypes).flatMap(([domain, types]) => types.flatMap((resourceType) => Array.from({ length: copies }, (_, i) => resourceNodeFixture(`${domain}:${resourceType}:${i}`, { resourceType, kind: resourceType === 'project' ? 'project' : 'resource', category: domain === 'platform' ? 'integration' : 'execution' }))));
    snapshot.edges = [];
    const graph = resourceTopology(snapshot, t), layout = layoutTopology(graph.topology, FULL_METRICS);
    // 按技术类型合并仍产生几十个节点；宏观入口必须按五个领域封顶。
    expect(graph.topology.nodes.map((node) => node.id).sort()).toEqual(Object.keys(domainTypes).map((domain) => `group:${domain}`).sort());
    for (const [domain, types] of Object.entries(domainTypes)) expect(graph.groups.get(`group:${domain}`)).toHaveLength(types.length * copies);
    expect(layout.height).toBeLessThan(400); if (height !== undefined) expect(layout.height).toBe(height); height = layout.height;
    expect(resourceSelectionId(graph, 'group:execution:PersistentVolumeClaim:development:owned')).toBe('group:storage');
    expect(resourceSelectionId(graph, 'configuration:namespace:0')).toBe('configuration:namespace:0');
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
  for (const [category, domain] of Object.entries({ foundation: 'configuration', service: 'services', execution: 'services', data: 'storage', integration: 'platform' } as const)) {
    const node = resourceNodeFixture(`future:${category}`, { resourceType: 'future-kind', category: category as 'foundation' });
    expect(resourceDomain(node)).toBe(domain); expect(normalizeResourceDomain(category)).toBe(domain);
    expect(parseCenterSearch({ category }).category).toBe(domain); expect(matches(node, { category: domain })).toBe(true);
  }
  expect(resourceDomain(resourceNodeFixture('unknown', { resourceType: 'future-kind', category: 'future-category' as 'foundation' }))).toBe('configuration');
  const volume = resourceNodeFixture('volume', { category: 'execution', resourceType: 'PersistentVolumeClaim' });
  expect(matches(volume, { category: 'storage' })).toBe(true); expect(matches(volume, { category: 'services' })).toBe(false);
  const graph = resourceTopology(centerSnapshot(), t);
  expect(resourceSelectionId(graph, 'group:execution:compute-profile')).toBe('group:services');
  expect(resourceSelectionId(graph, 'group:does-not-exist')).toBe('group:does-not-exist');
  expect(resourceSelectionId(graph, undefined)).toBeUndefined();
});
