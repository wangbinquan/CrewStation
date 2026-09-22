import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { focusManager } from '@tanstack/react-query';
import { renderApp } from './renderApp';
import { clusterFixture } from './clusterManagementFixture';
const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; sessionStorage.clear(); });
const tab = async (name: string) => { await act(async () => { ([...document.querySelectorAll('[role="tab"]')].find((n) => n.textContent === name) as HTMLElement).click(); }); await page!.settle(); };
const input = async (selector: string, value: string) => {
  const node = document.querySelector<HTMLInputElement>(selector)!;
  await act(async () => { node.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true })); }); await page!.settle();
};
test('cluster route enforces admin guard, exposes resource and observability tabs, server totals, partial sources and snapshot pagination', async () => {
  const f = clusterFixture({ partial: true }); page = await renderApp('/admin/cluster', '/admin');
  expect(page.text()).toContain('集群管理'); expect(page.text()).toContain('符合筛选的资源：205'); expect(page.text()).toContain('部分来源缺失或过期');
  expect([...document.querySelectorAll('[role="tab"]')].map((n) => n.textContent)).toEqual(['拓扑', '工作负载', 'Pod', '网络', '存储与配置', '节点', '最近 7 天趋势', '命名空间', '操作记录']);
  expect(page.text()).toContain('运行 30 · 就绪 29'); await page.click('下一页');
  expect(page.search()).toMatchObject({ snapshotId: 'snapshot-1', cursor: 'cursor-2' }); expect(f.calls.at(-1)?.query.get('cursor')).toBe('cursor-2');
  await page.back(); expect(page.search().cursor).toBeUndefined(); await page.click('cluster-demo-green');
  expect(page.search().resourceId).toBe('resource-uid'); expect(page.text()).toContain('uid-original'); expect(page.text()).toContain('工作卷仍被引用');
  await page.click('关闭详情'); expect(document.activeElement?.textContent).toBe('cluster-demo-green');
  page.unmount(); page = undefined; clusterFixture({ admin: false }); page = await renderApp('/admin/cluster'); expect(page.text()).toContain('仅平台管理员可见'); expect(page.text()).not.toContain('符合筛选');
});
test('scale validates every bound, inspects without writing, confirms once and exposes operation/HTTP/trace', async () => {
  const f = clusterFixture(); page = await renderApp('/admin/cluster?resourceId=resource-uid'); await page.click('调整副本');
  expect(page.text()).toContain('1–3'); await input('input[inputmode="numeric"]', '0'); expect(document.querySelector('[aria-invalid="true"]')).not.toBeNull();
  await page.click('检查影响'); expect(f.calls.filter((c) => c.path.endsWith('/inspect-operation'))).toHaveLength(0);
  await input('input[inputmode="numeric"]', '2'); await page.click('检查影响'); expect(document.querySelector('[role="alertdialog"]')).not.toBeNull(); expect(f.calls.filter((c) => c.path.endsWith('/operations') && c.method === 'POST')).toHaveLength(0);
  expect(page.text()).toContain('pod-original'); await page.click('确认执行');
  const write = f.calls.find((c) => c.path.endsWith('/operations') && c.method === 'POST')!; expect(write.body.params).toEqual({ action: 'scale', replicas: 2 });
  expect(page.text()).toContain('operation-stable'); expect(page.text()).toContain('trace-original'); expect(page.text()).toContain('202'); expect(page.text()).toContain('1.2 s'); expect(page.search().operationId).toBe('operation-stable');
});
test('lost acceptance response recovers by the same key after reopening and needs-attention has a recheck action', async () => {
  const f = clusterFixture({ loseReceipt: true }); page = await renderApp('/admin/cluster?resourceId=resource-uid'); await page.click('重启'); await page.click('检查影响'); await page.click('确认执行'); await page.settle();
  const writes = () => f.calls.filter((c) => c.path.endsWith('/operations') && c.method === 'POST'); expect(writes()).toHaveLength(1);
  const key = writes()[0]!.body.idempotencyKey; expect(f.calls.some((c) => c.query.get('idempotencyKey') === key)).toBe(true);
  page.unmount(); page = await renderApp('/admin/cluster?resourceId=resource-uid'); await page.settle(); expect(page.text()).toContain('operation-stable'); expect(writes()).toHaveLength(1);
  f.attention(); await page.navigate('/admin/cluster?tab=operations&operationId=operation-stable'); expect(page.text()).toContain('继续核对'); await page.click('继续核对');
  expect(f.calls.some((c) => c.path.endsWith('/reconcile') && c.method === 'POST')).toBe(true); expect(writes()).toHaveLength(1);
  await page.navigate('/admin/cluster?tab=operations&operationPhase=needs-attention&operationUid=uid-original');
  expect(page.text()).toContain('操作阶段'); expect(page.search()).toMatchObject({ operationPhase: 'needs-attention', operationUid: 'uid-original' });
  expect(f.calls.some((c) => c.path.endsWith('/operations') && c.query.get('phase') === 'needs-attention' && c.query.get('uid') === 'uid-original')).toBe(true);
});
test('namespace filter is URL state; events/containers/logs use selected UID, previous logs are explicit', async () => {
  const f = clusterFixture(); f.row.kind = 'Pod'; f.row.view = 'pods'; f.row.purpose = 'development-cli';
  page = await renderApp('/admin/cluster?tab=pods&resourceId=resource-uid'); await tab('容器'); expect(page.text()).toContain('worker:v1');
  await tab('事件'); expect(page.text()).toContain('原 UID 事件'); await tab('日志'); expect(page.text()).toContain('runtime output');
  await act(async () => { (document.querySelector('input[type="checkbox"]') as HTMLInputElement).click(); }); await page.settle(); expect([...f.calls].reverse().find((c) => c.path.endsWith('/logs'))?.query.get('previous')).toBe('true');
  await page.click('关闭详情'); const namespace = [...document.querySelectorAll('label')].find((l) => l.textContent === '命名空间')!.querySelector('input')!; namespace.id = 'cluster-namespace';
  await input('#cluster-namespace', 'cs-specific'); expect(page.search().namespace).toBe('cs-specific');
});
test('expired snapshot offers a real refresh path and does not silently retain the expired cursor', async () => {
  clusterFixture(); page = await renderApp('/admin/cluster?snapshotId=expired&cursor=old'); expect(page.text()).toContain('快照已过期'); await page.click('读取最新快照'); expect(page.search().snapshotId).toBeUndefined(); expect(page.search().cursor).toBeUndefined();
});

test('采集换快照时列表与详情原地替换，不卸载、不闪回载入中', async () => {
  const f = clusterFixture(); page = await renderApp('/admin/cluster?resourceId=resource-uid');
  expect(page.text()).toContain('符合筛选的资源：205'); expect(page.text()).toContain('uid-original');
  const row = () => document.querySelector('[data-cluster-resource="resource-uid"]'), before = row();
  const release = f.hold('/resources', '/resource-uid'); f.newSnapshot('snapshot-2');
  await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); }); await page.settle();
  expect(f.calls.some((c) => c.path.endsWith('/resources') && c.query.get('snapshotId') === 'snapshot-2')).toBe(true);
  // 新快照的回执还没到：表格与详情留在页面上，不塌成一行，滚动容器的高度不变。
  expect(page.text()).toContain('符合筛选的资源：205'); expect(page.text()).toContain('uid-original');
  expect(page.text()).not.toContain('载入中'); expect(row()).toBe(before);
  await act(async () => release()); await page.settle();
  expect(page.text()).toContain('符合筛选的资源：205'); expect(row()).toBe(before);
});
