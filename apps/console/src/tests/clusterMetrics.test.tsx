import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { renderApp } from './renderApp';
import { clusterMetricsFixture } from './clusterMetricsFixture';
import { amount, percent, resourceAmount } from '../features/cluster/components/MetricValue';
const originalFetch = globalThis.fetch; let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; sessionStorage.clear(); });
async function tab(name: string) { await act(async () => { const element = [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find((e) => e.textContent === name)!; element.click(); }); await page!.settle(); }
async function select(label: string, value: string) { const element = [...document.querySelectorAll('label')].find((l) => l.firstChild?.textContent === label)?.querySelector('select'); expect(element).toBeDefined(); await act(async () => { element!.value = value; element!.dispatchEvent(new Event('change', { bubbles: true })); }); await page!.settle(); }
test('global totals stay visible above project filters; Pods show containers, requests, actual usage and node', async () => {
  const f = clusterMetricsFixture(); page = await renderApp(`/admin/cluster?tab=pods&projectId=${f.projectId}`);
  expect(page.text()).toContain('集群容量 · 整个集群'); expect(page.text()).toContain('已观测 1/2'); expect(page.text()).toContain('活跃 Pod 5'); expect(page.text()).toContain('worker-node-a'); expect(page.text()).toContain('CPU 申请／实际');
  expect(f.calls.find((u) => u.pathname.endsWith('/capacity'))?.search).toBe('');
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
  f.historyFailure(); await select('时间范围', '6h'); expect(page.text()).toContain('历史查询失败'); expect(page.text()).toContain('HTTP 503'); expect(page.text()).toContain('集群容量 · 整个集群');
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
