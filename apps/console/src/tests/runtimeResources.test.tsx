// RFC-034: actual routed resource pages preserve sample states, project scope and independent failures.
import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { renderApp } from './renderApp';
import { clusterMetricsFixture } from './clusterMetricsFixture';
import { runtimeStatisticsFixture } from './runtimeStatisticsFixture';
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
const originalFetch = globalThis.fetch;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });
function fixture() {
  const f = clusterMetricsFixture(), fallback = globalThis.fetch, reads: URL[] = [], state = { failed: false, stale: false, incomplete: false, generation: 1 };
  globalThis.fetch = (async (raw, init) => {
    const url = new URL(String(raw), 'http://localhost'); reads.push(url);
    if (url.pathname.endsWith('/cluster-usage')) {
      if (state.failed) return Response.json({ error: 'unavailable', message: 'Resource source unavailable', details: {} }, { status: 503 });
      const next = url.searchParams.has('cursor');
      return Response.json({ observationId: 'frozen-snapshot-' + state.generation, complete: !state.incomplete, state: state.incomplete ? 'error' : 'fresh', observedAt: f.capacity.observedAt, projectId: f.projectId, total: 2, ...(next ? {} : { nextCursor: 1 }), summary: f.capacity.managed,
        items: state.incomplete ? [] : [next ? { ...f.pvc, metrics: { volumeUsed: { ...f.pvc.metrics.volumeUsed!, state: state.stale ? 'stale' : 'fresh' } } } : { ...f.pod, uid: f.pod.uid + '-' + state.generation }] });
    }
    if (url.pathname === '/v1/admin/cluster/resources' && url.searchParams.get('scope') === 'system') return Response.json({ snapshotId: 'platform-' + state.generation, complete: !state.incomplete, total: state.incomplete ? 0 : 2, ...(url.searchParams.has('cursor') ? {} : { nextCursor: 'next' }), items: state.incomplete ? [] : [{ ...f.row, kind: 'Pod', view: 'pods', uid: 'platform-uid-' + state.generation, ownership: { scope: 'system', component: 'cs-api' } }] });
    if (url.pathname.endsWith('/cluster-history')) return Response.json({ requestedFrom: url.searchParams.get('from'), requestedTo: url.searchParams.get('to'), stepSeconds: 60, source: 'prometheus', state: 'fresh', series: [{ metric: 'cpu', unit: 'cores', points: [{ at: f.capacity.observedAt, average: null, peak: null, coverage: 0, complete: false }] }] });
    if (url.pathname.endsWith('/health')) return Response.json({ items: [{ slot: 'prod', state: 'healthy', readyReplicas: 1, replicas: 1, restarts: 0, lastTransitionAt: '2026-09-20T00:00:00.000Z' }] });
    if (url.pathname.endsWith('/alerts')) return Response.json({ items: [{ id: 'alert-1', projectId: f.projectId, type: 'health-failing', state: 'resolved', detail: 'Recovered service check', firedAt: '2026-09-20T00:00:00.000Z', resolvedAt: '2026-09-20T00:01:00.000Z' }] });
    return fallback(raw, init);
  }) as typeof fetch;
  return { ...f, reads, state };
}
test('project resources keep snapshot pagination, original UID, stale values and independent history gaps', async () => {
  const f = fixture(); page = await renderApp(`/projects/${f.projectId}/observability?tab=resources`);
  expect(page.text()).toContain('项目资源用量'); expect(page.text()).toContain('UID ' + f.pod.uid); expect(page.text()).toContain('采样不完整');
  f.state.stale = true; await page.click('下一页资源'); expect(page.text()).toContain('UID ' + f.pvc.uid);
  expect(document.querySelector('[data-state="stale"]')).not.toBeNull();
  const request = f.reads.filter((u) => u.pathname.endsWith('/cluster-usage')).at(-1)!; expect(request.searchParams.get('observationId')).toBe('frozen-snapshot-1'); expect(request.searchParams.get('cursor')).toBe('1');
  expect(f.reads.some((u) => u.pathname === '/v1/admin/cluster/usage' || u.pathname === '/v1/admin/cluster/history' || u.pathname === '/v1/admin/cluster/capacity')).toBe(false);
  f.state.failed = true; await page.reread(); expect(page.text()).toContain('Resource source unavailable'); expect(page.text()).not.toContain('UID ' + f.pvc.uid); expect(page.text()).toContain('资源采样历史');
});
test('system capacity keeps scope and incomplete coverage; oversized history is explained without an invalid query', async () => {
  const f = fixture(), to = new Date().toISOString(), from = new Date(Date.now() - 30 * 86400000).toISOString();
  page = await renderApp('/admin/observability?tab=resources&from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to));
  expect(page.text()).toContain('集群当前容量'); expect(page.text()).toContain('全部受管资源'); expect(page.text()).toContain('平台资源'); expect(page.text()).toContain('node-b: 403'); expect(page.text()).toContain('最多七天');
  expect(f.reads.some((u) => u.pathname.endsWith('/history'))).toBe(false);
  await page.click('近 24 小时'); expect(f.reads.some((u) => u.pathname.endsWith('/history') && u.searchParams.get('scope') === 'cluster')).toBe(true); expect(page.text()).not.toContain('最多七天');
});
test('service health keeps change time distinct from missing sample time and displays recovery', async () => {
  const f = fixture(); page = await renderApp(`/projects/${f.projectId}/observability?tab=health`);
  expect(page.text()).toContain('正式槽'); expect(page.text()).toContain('采样时间未知'); expect(page.text()).toContain('本次读取时间'); expect(page.text()).toContain('状态变化时间'); expect(page.text()).toContain('Recovered service check'); expect(page.text()).toContain('已恢复');
  expect(f.reads.some((u) => u.pathname.endsWith('/observability/statistics'))).toBe(false);
});
test('statistics failure does not hide independent operational tabs', async () => {
  const f = runtimeStatisticsFixture(); f.state.error = true; page = await renderApp('/admin/observability?' + f.query);
  expect(page.text()).toContain('Ledger temporarily unavailable');
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) => b.textContent === '资源与容量')!.click()); await page.settle();
  expect(page.search().tab).toBe('resources'); expect(page.text()).not.toContain('Ledger temporarily unavailable');
});

test('returning to the first page resumes current observations without a manual refresh action', async () => {
  const f = fixture(); page = await renderApp(`/projects/${f.projectId}/observability?tab=resources`, undefined, undefined, { retainQueryCache: true });
  expect(page.text()).not.toContain('读取最新快照'); expect(page.text()).not.toContain('首页资源');
  await page.click('下一页资源'); expect(page.text()).toContain('分页期间固定快照'); f.state.generation = 2;
  await page.click('首页资源'); expect(page.text()).toContain('UID ' + f.pod.uid + '-2');
  const last = f.reads.filter((u) => u.pathname.endsWith('/cluster-usage')).at(-1)!; expect(last.searchParams.has('cursor')).toBe(false); expect(last.searchParams.has('observationId')).toBe(false);
  page.unmount(); page = await renderApp('/admin/observability?tab=health', undefined, undefined, { retainQueryCache: true }); await page.click('下一页资源'); f.state.generation = 3;
  await page.click('首页资源'); expect(page.text()).toContain('platform-uid-3');
  const platform = f.reads.filter((u) => u.pathname === '/v1/admin/cluster/resources').at(-1)!; expect(platform.searchParams.has('cursor')).toBe(false); expect(platform.searchParams.has('snapshotId')).toBe(false);
});
test('an incomplete empty project collection is unknown, not a complete zero-resource state', async () => {
  const f = fixture(); f.state.incomplete = true; page = await renderApp(`/projects/${f.projectId}/observability?tab=resources`);
  expect(page.text()).toContain('项目资源来源不完整'); expect(page.text()).not.toContain('当前快照没有资源'); expect(page.text()).not.toContain('项目资源用量');
  page.unmount(); page = await renderApp('/admin/observability?tab=health');
  expect(page.text()).toContain('资源来源不完整，当前列表不能代表全部组件。'); expect(page.text()).not.toContain('当前快照没有资源');
});
test('arrow-key navigation retains the same tab elements across statistics and operations in both directions', async () => {
  const f = runtimeStatisticsFixture(); page = await renderApp('/admin/observability?tab=performance&' + f.query);
  const tab = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) => b.textContent === text)!;
  const original = tab('性能与质量'); original.focus();
  for (const [key, label] of [['ArrowRight', '资源与容量'], ['ArrowRight', '平台健康'], ['ArrowLeft', '资源与容量'], ['ArrowLeft', '性能与质量']]) {
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))); await page.settle();
    expect(document.activeElement).toBe(tab(label!));
  }
  expect(document.activeElement).toBe(original);
});
