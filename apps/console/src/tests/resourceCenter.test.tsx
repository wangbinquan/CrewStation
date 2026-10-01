import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { renderApp } from './renderApp';
import { centerPath, centerProject, resourceCenterFixture, resourceNodeFixture } from './resourceCenterFixture';
const originalFetch = globalThis.fetch; let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });
const dialog = () => [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].at(-1)!;
const field = (label: string) => [...dialog().querySelectorAll('label')].find((l) => l.textContent?.startsWith(label))!.querySelector<HTMLInputElement | HTMLTextAreaElement>('input,textarea')!;
async function input(label: string, value: string) { await act(async () => { const node = field(label); node.focus(); const prototype = node.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true })); }); await page!.settle(); }
async function escape() { await act(async () => dialog().dispatchEvent(new Event('cancel', { cancelable: true }))); await page!.settle(); }

test('category filter compacts the topology while preserving project and real ownership context', async () => {
  const f = resourceCenterFixture();
  f.state.snapshot.nodes.push(resourceNodeFixture('project', { kind: 'project', category: 'foundation' }), resourceNodeFixture('service', { kind: 'resource', category: 'service' }), resourceNodeFixture('database', { kind: 'resource', category: 'data', resourceType: 'database' }));
  f.state.snapshot.edges.push({ id: 'owner-service', sourceId: 'project', targetId: 'service', relation: 'owns', state: 'configured', label: '归属' }, { id: 'owner-database', sourceId: 'service', targetId: 'database', relation: 'owns', state: 'observed', label: '归属' });
  page = await renderApp(`${centerPath}?category=data`);
  const diagram = document.querySelector('svg[aria-label="项目资源中心"]')!;
  // 原筛选仅降低透明度，仍留下完整图的高度，导致匹配资源可能远离当前视口。
  expect([...diagram.querySelectorAll('[data-node-id]')].map((n) => n.getAttribute('data-node-id')).sort()).toEqual(['group:data:database', 'group:service:compute-profile', 'project']);
  expect(diagram.querySelectorAll('[data-evidence]')).toHaveLength(2);
  await page.click('放大拓扑');
  expect([...dialog().querySelectorAll('[data-node-id]')].map((n) => n.getAttribute('data-node-id')).sort()).toEqual(['group:data:database', 'group:service:compute-profile', 'project']);
  expect(f.writes).toHaveLength(0);
});

test('long list last row opens a unified modal; close retains filters, loaded rows, scroll and trigger focus', async () => {
  resourceCenterFixture(); page = await renderApp(`${centerPath}?view=list&access=owned`);
  await page.click('加载更多');
  const row = [...document.querySelectorAll('tr')].find((r) => r.textContent?.includes('node-078'))!, trigger = row.querySelector<HTMLButtonElement>('button')!;
  const stage = row.closest('div[role="tabpanel"]')!; stage.scrollTop = 900;
  await act(async () => { trigger.focus(); trigger.click(); }); await page.settle();
  expect(dialog().textContent).toContain('node-078'); expect(dialog().open).toBe(true); expect(dialog().closest('tr')).toBeNull();
  await escape(); expect(document.querySelectorAll('dialog[open]')).toHaveLength(0); expect(page.search()['access']).toBe('owned'); expect(stage.scrollTop).toBe(900); expect(document.activeElement).toBe(trigger);
  expect([...document.querySelectorAll('tr')].some((r) => r.textContent?.includes('node-078'))).toBe(true);
});
test('owner quota request preserves the draft and nested Escape closes only the confirmation; no write precedes confirmation', async () => {
  const f = resourceCenterFixture(); page = await renderApp(`${centerPath}?view=list`);
  await page.click('详情'); await page.click('申请调整配额'); await input('执行并发上限', '8'); await input('申请／调整理由', '更多开发并发任务');
  await page.click('核对后提交'); expect(document.querySelectorAll('dialog[open]')).toHaveLength(3); expect(f.writes).toHaveLength(0);
  await escape(); expect(document.querySelectorAll('dialog[open]')).toHaveLength(2); expect(field('执行并发上限').value).toBe('8');
  await escape(); await page.click('申请调整配额'); expect(field('执行并发上限').value).toBe('8'); expect(field('申请／调整理由').value).toBe('更多开发并发任务');
  await page.click('核对后提交'); await page.click('确认提交'); expect(f.writes).toHaveLength(1); expect(f.writes[0]!.body).toMatchObject({ values: { maxConcurrentTasks: 8 }, expectedRevision: 'revision-1' });
  expect(dialog().textContent).toContain('待审批'); expect(dialog().textContent).toContain('原申请值');
});
test('revision conflict keeps typed values, reloads current values and requires explicit review before retry', async () => {
  const f = resourceCenterFixture('admin'); f.state.conflict = true; page = await renderApp(`/admin/projects/${centerProject}/resources?view=list`);
  await page.click('详情'); await page.click('调整配额'); await input('执行并发上限', '8'); await input('申请／调整理由', '允许更多并发任务'); await page.click('核对后提交'); await page.click('确认提交');
  expect(field('执行并发上限').value).toBe('8'); expect(dialog().textContent).toContain('当前配置值'); expect(dialog().textContent).toContain('4');
  const submit = [...dialog().querySelectorAll('button')].find((b) => b.textContent === '核对后提交')!; expect(submit.disabled).toBe(true);
  await act(async () => field('已核对最新配置').click()); await page.settle(); expect(submit.disabled).toBe(false);
  f.state.conflict = false; await page.click('核对后提交'); await page.click('确认提交'); expect(f.writes.at(-1)!.body['expectedRevision']).toBe('revision-2');
});
test('developer can inspect quota and topology but has no request, direct or approval controls', async () => {
  const f = resourceCenterFixture('developer'); page = await renderApp(`${centerPath}?view=list`); await page.click('详情');
  expect(dialog().textContent).toContain('计量范围'); expect(dialog().textContent).toContain('有效额度');
  for (const label of ['申请调整配额', '调整配额', '批准', '继承与可选范围']) expect([...document.querySelectorAll('button')].some((b) => b.textContent === label)).toBe(false);
  expect(f.writes).toHaveLength(0); expect(f.reads.some((path) => path.endsWith('/inspect'))).toBe(false);
});
