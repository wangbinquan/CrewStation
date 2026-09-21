import { afterAll, describe, expect, test } from 'bun:test';
import { ClusterCapacitySchema, ClusterNodesPageSchema, ClusterUsagePageSchema, ClusterHistorySchema } from '../../packages/contracts';
import { apiGet, e2eAvailable, open } from './consoleSession';
import { openAdminSession } from './session';

const available = await e2eAvailable(), session = available ? await openAdminSession() : undefined;
afterAll(async () => { await session?.close(); }, 30_000);
describe.skipIf(!session)('deployed cluster resource observability', () => {
  test('live node, pod and storage observations include system services and real history', async () => {
    const page = session!.admin;
    await open(page, '/admin/cluster');
    await page.waitUntil(`fetch('/v1/admin/cluster/capacity').then(r => r.json()).then(d => d.nodes > 0 && d.metrics?.cpu?.state === 'fresh')`, 60_000, 1000);
    const capacity = ClusterCapacitySchema.parse(await apiGet(page, '/v1/admin/cluster/capacity'));
    expect(capacity.nodes).toBeGreaterThan(0); expect(capacity.capacity.cpu).toBeDefined(); expect(capacity.demand.requests.cpu).toBeDefined();
    expect(capacity.coverage.cpu?.complete).toBe(true); expect(capacity.system.pods).toBeGreaterThan(0);
    const nodes = ClusterNodesPageSchema.parse(await apiGet(page, '/v1/admin/cluster/nodes'));
    expect(nodes.items[0]?.version).toMatch(/^v/); expect(nodes.items[0]?.name).toBeTruthy();
    const catalog = await apiGet<{ items: { resourceId: string }[] }>(page, '/v1/admin/cluster/resources?scope=system&kind=Pod&limit=100');
    const usage = ClusterUsagePageSchema.parse(await apiGet(page, `/v1/admin/cluster/usage?scope=system&resourceIds=${catalog.items.map((r) => r.resourceId).join(',')}`));
    expect(usage.items.some((p) => p.kind === 'Pod' && p.node && p.containers.some((c) => c.type === 'application' && c.requests.memory))).toBe(true);
    expect(usage.items.some((p) => p.name.startsWith('prometheus') || p.name.startsWith('data-prometheus'))).toBe(true);
    const from = new Date(Date.now() - 3600_000).toISOString(), to = new Date().toISOString();
    const history = ClusterHistorySchema.parse(await apiGet(page, `/v1/admin/cluster/history?scope=cluster&metrics=cpu&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`));
    expect(history.state).toBe('fresh'); expect(history.series[0]?.points.length).toBeGreaterThan(0);
    expect(page.takeErrors()).toEqual([]);
  }, 90_000);
  test.each([1280, 390, 320])('node and history views remain usable at %i pixels', async (width) => {
    const page = session!.admin;
    await page.cmd('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    for (const tab of ['pods', 'storage', 'nodes', 'history']) {
      await open(page, `/admin/cluster?tab=${tab}`);
      await page.waitUntil(`!!document.querySelector('[role="tab"][aria-selected="true"]')`);
      const overflow = await page.eval<number>('document.documentElement.scrollWidth - innerWidth');
      expect(overflow).toBeLessThanOrEqual(1);
      expect(await page.text()).not.toContain('仅平台管理员可见');
      expect(page.takeErrors()).toEqual([]);
    }
  }, 60_000);
});
