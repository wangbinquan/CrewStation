import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { renderApp } from './renderApp';
import { centerPath, centerProject } from './resourceCenterFixture';
import { resourceDeploymentFixture } from './resourceDeploymentFixture';

const originalFetch = globalThis.fetch; let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });
const dialog = () => [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].at(-1)!;
async function escape() { await act(async () => dialog().dispatchEvent(new Event('cancel', { cancelable: true }))); await page!.settle(); }
async function openObject(id: string) {
  const trigger = document.querySelector<HTMLElement>(`[data-node-id="${id}"]`)!;
  expect(trigger).not.toBeNull();
  await act(async () => { trigger.focus(); trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }); await page!.settle();
  return trigger;
}

test('both project and administrator routes use real deployment reads and keep permission lists in shared dialogs', async () => {
  for (const role of ['owner', 'admin'] as const) {
    const f = resourceDeploymentFixture(role); page = await renderApp(role === 'owner' ? centerPath : `/admin/projects/${centerProject}/resources`);
    expect(document.querySelector('svg[aria-label="部署架构与资源"]')).not.toBeNull();
    expect(document.querySelector('[data-node-id="deployment:dependency:api-unused"]')).toBeNull();
    const trigger = await openObject('deployment:slot-prod'), outer = dialog();
    expect(outer.textContent).toContain('资源与权限'); await page.click('加载更多');
    const row = [...outer.querySelectorAll('tbody tr')].find((r) => r.textContent?.includes('node-078'))!, button = row.querySelector<HTMLButtonElement>('button')!;
    outer.scrollTop = 550;
    await act(async () => { button.focus(); button.click(); }); await page.settle();
    expect(document.querySelectorAll('dialog[open]')).toHaveLength(2); expect(dialog().textContent).toContain('node-078'); expect(dialog().closest('tr')).toBeNull();
    await escape(); expect(dialog()).toBe(outer); expect(outer.scrollTop).toBe(550); expect(document.activeElement).toBe(button);
    expect([...outer.querySelectorAll('tr')].some((r) => r.textContent?.includes('node-078'))).toBe(true);
    await page.click('运行对象 · 3'); expect(outer.textContent).toContain('pod-prod-2');
    await page.click('关系'); expect(outer.textContent).toContain('deploy-prod → pod-prod-1');
    await escape(); expect(document.activeElement).toBe(trigger); expect(f.writes).toHaveLength(0);
    page.unmount(); page = undefined;
  }
});

test('four views preserve the selected URL; task permissions reuse the existing quota request and draft flow', async () => {
  const f = resourceDeploymentFixture(); page = await renderApp(centerPath);
  await page.click('开发工作区'); expect(page.search()['perspective']).toBe('development');
  expect(document.querySelector('[data-node-id="deployment:workspace-business"]')).toBeNull();
  await openObject('deployment:workspace-development');
  const row = [...dialog().querySelectorAll('tr')].find((r) => r.textContent?.includes('执行并发额度'))!;
  await act(async () => row.querySelector<HTMLButtonElement>('button')!.click()); await page.settle();
  await page.click('申请调整配额'); expect(dialog().textContent).toContain('当前配置值');
  await escape(); expect(document.querySelectorAll('dialog[open]')).toHaveLength(2);
  await escape(); await escape(); await page.click('业务任务'); expect(document.querySelector('[data-node-id="deployment:workspace-business"]')).not.toBeNull();
  await page.click('构建与迁移'); expect(page.text()).toContain('当前视角或筛选下没有运行对象');
  expect(f.writes).toHaveLength(0);
});

test('failed, refused and partial sources are visible; they are never rendered as an empty successful inventory', async () => {
  for (const status of [500, 403]) {
    const f = resourceDeploymentFixture(); f.errors.inventory = status;
    page = await renderApp(centerPath); expect(page.text()).toContain('inventory unavailable'); expect(document.querySelector('svg[aria-label="部署架构与资源"]')).toBeNull();
    expect(page.text()).not.toContain('当前视角或筛选下没有运行对象');
    await page.click('项目资源目录'); expect(page.text()).toContain('执行并发额度'); expect(f.writes).toHaveLength(0);
    page.unmount(); page = undefined;
  }
  const f = resourceDeploymentFixture(); f.errors.slots = 500;
  page = await renderApp(centerPath); expect(page.text()).toContain('slots unavailable'); expect(page.text()).toContain('来源尚不完整');
  expect(document.querySelector('[data-node-id="deployment:slot-prod"]')).toBeNull();
});

test('narrow views keep deployment objects aggregated and developers cannot mutate linked resources', async () => {
  const originalMatchMedia = window.matchMedia;
  window.matchMedia = (query) => ({ matches: /max-width/.test(query), media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => true });
  try {
    const f = resourceDeploymentFixture('developer'); page = await renderApp(`${centerPath}?perspective=development`);
    expect(document.querySelector('svg[aria-label="部署架构与资源"]')).toBeNull();
    const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.startsWith('workspace-development'))!;
    await act(async () => { button.focus(); button.click(); }); await page.settle();
    const row = [...dialog().querySelectorAll('tr')].find((r) => r.textContent?.includes('执行并发额度'))!;
    await act(async () => row.querySelector<HTMLButtonElement>('button')!.click()); await page.settle();
    expect(dialog().textContent).toContain('有效额度'); expect(dialog().textContent).not.toContain('申请调整配额');
    await escape(); await escape(); expect(document.activeElement).toBe(button); expect(f.writes).toHaveLength(0);
  } finally { window.matchMedia = originalMatchMedia; }
});
