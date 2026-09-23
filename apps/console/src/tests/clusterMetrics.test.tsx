import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { renderApp } from './renderApp';
import { clusterMetricsFixture } from './clusterMetricsFixture';
import { amount, percent, resourceAmount } from '../features/cluster/components/MetricValue';
const originalFetch = globalThis.fetch; let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; sessionStorage.clear(); });
async function tab(name: string) { await act(async () => { const element = [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find((e) => e.textContent === name)!; element.click(); }); await page!.settle(); }
/** 管理总览另有待办两张卡：本文件只关心集群状态条，其余接口按「没有」（404）回，待办卡显示为空。 */
function onlyClusterReads() {
  const fixture = globalThis.fetch;
  globalThis.fetch = (async (raw, init) => {
    const url = new URL(String(raw), 'http://localhost');
    return url.pathname.startsWith('/v1/admin/cluster') || url.pathname.startsWith('/v1/me') ? fixture(raw, init) : Response.json({ error: 'not_found', message: '无' }, { status: 404 });
  }) as typeof fetch;
}
async function select(label: string, value: string) { const element = [...document.querySelectorAll('label')].find((l) => l.firstChild?.textContent === label)?.querySelector('select'); expect(element).toBeDefined(); await act(async () => { element!.value = value; element!.dispatchEvent(new Event('change', { bubbles: true })); }); await page!.settle(); }
test('the admin overview opens on the whole-cluster status strip whose counts link into the inventory; Pods show containers, requests, actual usage and node', async () => {
  const f = clusterMetricsFixture(); onlyClusterReads(); page = await renderApp('/admin');
  // 2026-09-23 作者裁定：状态条从集群管理挪到管理总览最上面，排在待处理事项之前；容量是整个集群的，不带项目筛选。
  const strip = [...document.querySelectorAll('main h2')].find((h) => h.textContent === '集群状态')!.closest('section')!;
  const todo = document.querySelector('main section[aria-labelledby="admin-todo-title"]')!;
  expect(strip.compareDocumentPosition(todo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  for (const text of ['集群容量 · 整个集群', '已观测 1/2', '活跃 Pod 5', 'CrewStation 受管资源', '容量明细、受管分项与来源状态']) expect(strip.textContent).toContain(text);
  expect(f.calls.find((u) => u.pathname.endsWith('/capacity'))?.search).toBe(''); expect(f.calls.find((u) => u.pathname.endsWith('/summary'))?.searchParams.has('projectId')).toBe(false);
  // 计数格是链接：进集群管理「资源清单」的对应视图，带上该格的筛选。
  expect([...strip.querySelectorAll('a')].map((a) => a.textContent?.replace(/\d.*$/, ''))).toEqual(['工作负载', 'Pod 总数', 'Service', '工作卷 PVC', '异常 Pod']);
  await page.click(`异常 Pod${f.summary.abnormal}`); expect(page.path()).toBe('/admin/cluster'); expect(page.search()).toMatchObject({ tab: 'pods', status: 'abnormal' });
  expect(page.text()).not.toContain('集群容量 · 整个集群');
  await page.navigate(`/admin/cluster?tab=pods&projectId=${f.projectId}`);
  expect(page.text()).toContain('worker-node-a'); expect(page.text()).toContain('CPU 申请／实际');
  await page.click('cluster-demo-green'); expect(page.text()).toContain('QoS: Burstable'); expect(page.text()).toContain('此 Pod 共享节点网络');
  await tab('容器'); for (const text of ['应用容器', '初始化容器', '常驻 sidecar', '临时调试容器', 'cpu: 250m', 'memory: 128Mi', 'worker:v1', '未设置']) expect(page.text()).toContain(text);
  await tab('趋势'); expect(document.querySelector('input[type="range"]')).not.toBeNull(); await select('容器', 'main'); expect(f.calls.at(-1)?.searchParams.get('scope')).toBe('container');
});
test('PVC rows distinguish request/bound/used, show non-quota ratios over 100 percent and visible stale errors', async () => {
  const f = clusterMetricsFixture(); f.staleStorage(); page = await renderApp('/admin/cluster?tab=storage');
  for (const text of ['workspace-volume', '存储申请', '已绑定声明容量', '实际存储占用', '200%', '非硬配额', '数据已过期', 'Probe unavailable', 'configuration', 'ReadWriteOnce']) expect(page.text()).toContain(text);
  await page.click('workspace-volume'); expect(page.text()).toContain('pv-work'); expect(page.text()).toContain('local-path-probe');
});
test('node detail gives extended capacity, filesystem aliases, interfaces and per-device disk IO trends', async () => {
  const f = clusterMetricsFixture(); page = await renderApp('/admin/cluster?tab=nodes'); await page.click('worker-node-a');
  for (const text of ['example.com/gpu', '已禁止调度', 'DiskPressure', 'inode 总数', 'eth0', '/dev/vda', '磁盘读取', '整盘、分区和映射设备']) expect(page.text()).toContain(text);
  await page.click('/dev/vda'); expect(f.calls.at(-1)?.searchParams.get('device')).toBe('/dev/vda'); await page.click('eth0'); expect(f.calls.at(-1)?.searchParams.get('interface')).toBe('eth0');
});
test('history supports all ranges, custom constraints, ended resources, gaps and query failure', async () => {
  const f = clusterMetricsFixture(); page = await renderApp('/admin/cluster?tab=history');
  await select('时间范围', '7d'); const request = f.calls.filter((u) => u.pathname.endsWith('/history')).at(-1)!;
  expect(Date.parse(request.searchParams.get('to')!) - Date.parse(request.searchParams.get('from')!)).toBe(604800000);
  expect(page.text()).toContain('实际数据起点'); expect(page.text()).toContain('每桶 15 秒');
  const slider = document.querySelector<HTMLInputElement>('input[type="range"]')!; await act(async () => { slider.value = '1'; slider.dispatchEvent(new Event('change', { bubbles: true })); slider.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(document.querySelectorAll('svg path').length).toBeGreaterThan(2);
  await select('资源', f.pvc.resourceId); expect(page.text()).toContain('old-pvc-uid'); expect(page.text()).toContain('已结束／删除');
  await select('时间范围', 'custom'); expect(document.querySelectorAll('input[type="datetime-local"]')).toHaveLength(2);
  f.historyFailure(); await select('时间范围', '6h'); expect(page.text()).toContain('历史查询失败'); expect(page.text()).toContain('HTTP 503');
  // 查询失败只落在趋势卡里，页签与视图切换照旧在。
  expect([...document.querySelectorAll('[role="tab"]')].map((n) => n.textContent)).toEqual(['拓扑', '资源清单']); expect(document.querySelector('[role="group"][aria-label="资源清单"]')).not.toBeNull();
});
// 2026-09-23 裁定：页面自动局部刷新，不提供刷新按钮——趋势的「请求刷新」去掉，预设时间窗每分钟自己前移（回到前台立即补一次）。
test('preset history windows move forward on their own and keep the charts in place; custom windows stay fixed', async () => {
  const f = clusterMetricsFixture(); page = await renderApp('/admin/cluster?tab=history');
  expect([...document.querySelectorAll('button')].map((node) => node.textContent)).not.toContain('请求刷新');
  const reads = () => f.calls.filter((u) => u.pathname.endsWith('/history')), end = () => Date.parse(reads().at(-1)!.searchParams.get('to')!);
  const count = reads().length, before = end(), charts = document.querySelectorAll('svg path').length;
  expect(charts).toBeGreaterThan(2);
  // 扣住前移后的回执：在途期间上一份曲线留在原处，不闪回「载入中」。
  const fixture = globalThis.fetch, waiting: URL[] = []; let release = () => {}; const held = new Promise<void>((resolve) => { release = resolve; });
  globalThis.fetch = (async (raw, init) => { const url = new URL(String(raw), 'http://localhost'); if (url.pathname.endsWith('/history')) { waiting.push(url); await held; } return fixture(raw, init); }) as typeof fetch;
  await new Promise((resolve) => setTimeout(resolve, 5));
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); }); await page.settle();
  expect(waiting).toHaveLength(1); expect(Date.parse(waiting[0]!.searchParams.get('to')!)).toBeGreaterThan(before);
  expect(document.querySelectorAll('svg path').length).toBe(charts); expect(page.text()).not.toContain('载入中');
  await act(async () => release()); await page.settle();
  expect(reads().length).toBe(count + 1); expect(end()).toBeGreaterThan(before); expect(document.querySelectorAll('svg path').length).toBe(charts);
  await select('时间范围', 'custom'); const fixed = reads().length;
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); }); await page.settle();
  expect(reads().length).toBe(fixed);
});
test('resource formatters preserve real zero, unavailable values and overcommit', () => {
  expect(amount(undefined)).toBe('—'); expect(amount('not numeric')).toBe('—'); expect(amount('0', 'cores')).toBe('0 CPU'); expect(amount('1024', 'bytes/s')).toBe('1 KiB/s'); expect(amount('2', 'ops/s')).toBe('2/s');
  expect(percent('2', '1')).toBe('200%'); expect(percent('1', '0')).toBe('—'); expect(resourceAmount('2', 'example.com/gpu')).toBe('2'); expect(resourceAmount('1024', 'hugepages-2Mi')).toBe('1 KiB');
});
test('history project filter selects its actual series and hides unrelated live-resource filters', async () => {
  const f = clusterMetricsFixture(); page = await renderApp('/admin/cluster?tab=history');
  await select('项目', f.projectId);
  const request = f.calls.filter((u) => u.pathname.endsWith('/history')).at(-1)!;
  expect(request.searchParams.get('scope')).toBe('project'); expect(request.searchParams.get('projectId')).toBe(f.projectId);
  const labels = [...document.querySelectorAll('label')].map((l) => l.firstChild?.textContent);
  expect(labels).not.toContain('资源类型'); expect(labels).not.toContain('用途');
});
