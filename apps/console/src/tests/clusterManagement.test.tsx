import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { focusManager } from '@tanstack/react-query';
import { dialogConfirmButton, openDialog, typeConfirmWord } from './confirmDialogDriver';
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
test('cluster route enforces admin guard, opens on the topology with only the two tabs, keeps the inventory one tab away with server totals, partial sources and snapshot pagination', async () => {
  const f = clusterFixture({ partial: true }); page = await renderApp('/admin/cluster', '/admin');
  // 2026-09-23 裁定：「拓扑｜资源清单」两个顶层页签，缺省拓扑；清单类型、筛选条与表格都在「资源清单」里。
  // 同日再裁定：状态条（集群容量、受管资源计数、采集状态）挪到管理总览最上面，这里只剩拓扑与资源清单；来源缺失由拓扑的警示条说明。
  expect(page.text()).toContain('集群管理'); expect(page.text()).toContain('部分来源失败');
  for (const moved of ['集群容量 · 整个集群', 'CrewStation 受管资源', '运行 30 · 就绪 29', '部分来源缺失或过期', '容量明细、受管分项与来源状态']) expect(page.text()).not.toContain(moved);
  expect([...document.querySelectorAll('[role="tab"]')].map((n) => n.textContent)).toEqual(['拓扑', '资源清单']);
  expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('拓扑');
  expect(page.text()).not.toContain('符合筛选的资源'); expect(page.text()).not.toContain('筛选清单');
  await tab('资源清单'); expect(page.search()).toMatchObject({ tab: 'workloads' });
  const views = () => [...document.querySelectorAll<HTMLElement>('[role="group"][aria-label="资源清单"] button')];
  expect(views().map((n) => n.textContent)).toEqual(['工作负载', 'Pod', '网络', '存储与配置', '待回收的工作卷', '命名空间', '节点', '最近 7 天趋势', '操作记录']);
  await act(async () => { views().find((n) => n.textContent === 'Pod')!.click(); }); await page.settle();
  expect(page.search()).toMatchObject({ tab: 'pods' }); expect(views().find((n) => n.getAttribute('aria-pressed') === 'true')?.textContent).toBe('Pod');
  expect(page.text()).toContain('筛选清单'); expect(page.text()).toContain('符合筛选的资源：205');
  await act(async () => { views().find((n) => n.textContent === '工作负载')!.click(); }); await page.settle(); expect(page.search()).toMatchObject({ tab: 'workloads' });
  await page.click('下一页');
  expect(page.search()).toMatchObject({ snapshotId: 'snapshot-1', cursor: 'cursor-2' }); expect(f.calls.at(-1)?.query.get('cursor')).toBe('cursor-2');
  await page.back(); expect(page.search().cursor).toBeUndefined(); await page.click('cluster-demo-green');
  expect(page.search().resourceId).toBe('resource-uid'); expect(page.text()).toContain('uid-original'); expect(page.text()).toContain('工作卷仍被引用');
  await page.click('关闭详情'); expect(document.activeElement?.textContent).toBe('cluster-demo-green');
  // 顶层切回拓扑再切回清单：回到上次看的那类清单，筛选条只在清单里出现；操作记录只留项目筛选。
  await tab('拓扑'); expect(page.search()).toMatchObject({ tab: 'topology' }); expect(page.text()).not.toContain('筛选清单');
  await tab('资源清单'); expect(page.search()).toMatchObject({ tab: 'workloads' }); expect(page.text()).toContain('筛选清单');
  await act(async () => { views().find((n) => n.textContent === '操作记录')!.click(); }); await page.settle();
  expect([...document.querySelectorAll('label')].map((l) => l.firstChild?.textContent)).toEqual(['项目', '目标资源 UID', '操作阶段']);
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
// 2026-09-23 作者裁定页内展开的表单改弹窗：调整副本在弹窗里；取消只关窗、目标副本数留着，再打开恢复；「清空」回到当前副本数。
test('调整副本在弹窗里：取消只关窗、目标副本数留着再打开恢复；清空回到当前副本数；改了数目要重新检查', async () => {
  const f = clusterFixture(); page = await renderApp('/admin/cluster?resourceId=resource-uid'); await page.click('调整副本');
  const replicas = () => document.querySelector<HTMLInputElement>('dialog[open] input[inputmode="numeric"]')!;
  const initial = replicas().value; await input('dialog[open] input[inputmode="numeric"]', '2'); await page.click('检查影响');
  expect(document.querySelector('dialog[open]')?.getAttribute('role')).toBe('alertdialog'); expect(page.text()).toContain('确认执行');
  await input('dialog[open] input[inputmode="numeric"]', '3'); expect(document.querySelector('dialog[open]')?.getAttribute('role')).toBe('dialog');
  await page.click('取消'); expect(document.querySelectorAll('dialog').length).toBe(0);
  await page.click('调整副本'); expect(replicas().value).toBe('3');
  await page.click('清空'); expect(replicas().value).toBe(initial); expect(document.querySelectorAll('dialog[open]').length).toBe(1);
  expect(f.calls.filter((c) => c.path.endsWith('/operations') && c.method === 'POST')).toHaveLength(0);
});
test('删除／结束不可撤销：点下去就弹窗并自动检查影响，输入 delete 才受理，受理后弹窗关闭、结果在页内', async () => {
  const f = clusterFixture();
  f.row.availableActions = f.row.availableActions.map((a) => a.action === 'delete' ? { ...a, enabled: true, reason: '', impactSummary: ['按 UID 删除无活动引用的受管资源，无法撤销'] } : a);
  page = await renderApp('/admin/cluster?resourceId=resource-uid'); await page.click('删除／结束');
  const inspections = () => f.calls.filter((c) => c.path.endsWith('/inspect-operation')), writes = () => f.calls.filter((c) => c.path.endsWith('/operations') && c.method === 'POST');
  expect(inspections().map((c) => c.body)).toEqual([{ action: 'delete' }]);
  const dialog = openDialog();
  for (const part of ['确认删除／结束“cluster-demo-green”？', '按 UID 删除无活动引用的受管资源，无法撤销', 'UID: uid-original', 'Pod · pod-original', '本次确认有效至', '输入 delete 以确认']) expect(dialog.textContent).toContain(part);
  expect(dialogConfirmButton().disabled).toBe(true); await typeConfirmWord('Delete'); expect(dialogConfirmButton().disabled).toBe(false); expect(writes()).toHaveLength(0);
  await page.click('确认执行');
  expect(writes().map((c) => c.body.params)).toEqual([{ action: 'delete' }]);
  expect(document.querySelectorAll('dialog').length).toBe(0); expect(page.text()).toContain('operation-stable');
});
test('删除的影响检查还在路上就取消、改做重启：旧的检查结果不会挂到重启上', async () => {
  const f = clusterFixture();
  f.row.availableActions = f.row.availableActions.map((a) => a.action === 'delete' ? { ...a, enabled: true, reason: '' } : a);
  page = await renderApp('/admin/cluster?resourceId=resource-uid');
  const release = f.hold('/inspect-operation'); await page.click('删除／结束');
  expect(openDialog().textContent).toContain('正在检查…'); expect(dialogConfirmButton().disabled).toBe(true);
  await typeConfirmWord('delete'); expect(dialogConfirmButton().disabled).toBe(true);
  await page.click('取消'); expect(document.querySelectorAll('dialog').length).toBe(0);
  await page.click('重启'); await act(async () => { release(); }); await page.settle();
  expect(document.querySelectorAll('[role="alertdialog"]').length).toBe(0); expect(page.text()).toContain('检查影响');
  expect(f.calls.filter((c) => c.path.endsWith('/operations') && c.method === 'POST')).toHaveLength(0);
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
// 2026-09-23 裁定：页面自动局部刷新，不提供刷新按钮——「请求刷新」「读取最新快照」都去掉，快照过期自动回到最新快照的第一页。
test('expired snapshot in the URL resets to the latest snapshot on its own: the expired cursor is dropped, no error and no refresh button', async () => {
  const f = clusterFixture(); page = await renderApp('/admin/cluster?snapshotId=expired&cursor=old');
  expect(page.search().snapshotId).toBeUndefined(); expect(page.search().cursor).toBeUndefined();
  expect(document.querySelectorAll('[data-node-id]').length).toBeGreaterThan(0); expect(page.text()).not.toContain('快照已过期');
  const labels = [...document.querySelectorAll('button')].map((node) => node.textContent);
  expect(labels).not.toContain('读取最新快照'); expect(labels).not.toContain('请求刷新');
  expect(f.calls.some((c) => c.path.endsWith('/refresh'))).toBe(false);
});
test('a list whose snapshot expires underneath it waits for the next snapshot instead of showing the expiry', async () => {
  const f = clusterFixture(); page = await renderApp('/admin/cluster?tab=workloads'); expect(page.text()).toContain('符合筛选的资源：205');
  // 后台换了快照、旧快照过了保留期；清单先按旧快照重读得到 410，摘要的回执还在路上。
  f.expire('snapshot-1'); f.newSnapshot('snapshot-2'); const release = f.hold('/summary');
  await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); }); await page.settle();
  const lastList = () => f.calls.filter((c) => c.path.endsWith('/resources')).at(-1);
  expect(lastList()?.query.get('snapshotId')).toBe('snapshot-1');
  expect(page.text()).not.toContain('快照已过期'); expect([...document.querySelectorAll('button')].map((node) => node.textContent)).not.toContain('读取最新快照');
  await act(async () => release()); await page.settle();
  expect(lastList()?.query.get('snapshotId')).toBe('snapshot-2');
  expect(page.text()).toContain('符合筛选的资源：205'); expect(page.text()).not.toContain('快照已过期');
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

// 2026-09-23 作者裁定：资源清单宽屏长满一屏，详情在清单右侧自成一栏、各自滚动；清单卡里只有表格区滚动，表头吸顶，翻页钮留在卡底。
test('资源清单的详情在清单右侧自成一栏；清单卡里只有表格区滚动、表头吸顶、翻页钮在卡底；关掉详情回到单栏', async () => {
  clusterFixture(); page = await renderApp('/admin/cluster?tab=workloads&resourceId=resource-uid');
  const detail = document.querySelector('section[aria-label="资源详情"]')!, aside = detail.parentElement!, split = aside.parentElement!;
  const list = split.firstElementChild!, row = document.querySelector('[data-cluster-resource="resource-uid"]')!;
  expect([split.className, list.className, aside.className, split.children.length]).toEqual(['split hasDetail', 'list', 'aside', 2]);
  expect(list.contains(row)).toBe(true); expect(list.contains(detail)).toBe(false);
  // 表格自己不成滚动区（否则表头只对它自己吸顶），外面一层表格区上下左右滚动，表头贴住它的顶边。
  const table = row.closest('table')!, region = table.parentElement!.parentElement!, card = region.closest('section')!;
  expect([table.parentElement!.className, region.className]).toEqual(['sticky', 'rows']); expect(card.className.split(' ')).toContain('listCard');
  const next = [...card.querySelectorAll('button')].find((b) => b.textContent === '下一页')!;
  expect(region.contains(next)).toBe(false); expect(region.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // 整块的高度量到窗口底边，样式只在宽屏用它。
  const inventory = split.parentElement!; expect(inventory.className).toBe('inventory'); expect(inventory.style.getPropertyValue('--viewport-fill')).toMatch(/^\d+px$/);
  // 详情栏自己滚：换一个资源换一个栏，新详情从顶上看起。
  aside.scrollTop = 120; await page.navigate('/admin/cluster?tab=workloads&resourceId=system-api');
  const other = document.querySelector('section[aria-label="资源详情"]')!.parentElement!;
  expect(other.textContent).toContain('cs-api'); expect(other === aside).toBe(false); expect(other.scrollTop).toBe(0);
  await page.click('关闭详情');
  expect(document.querySelector('section[aria-label="资源详情"]')).toBeNull(); expect([split.className, split.children.length]).toEqual(['split', 1]);
});
