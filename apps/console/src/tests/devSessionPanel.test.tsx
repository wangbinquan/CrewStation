import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import type { WorkspaceLayout } from '@crewstation/contracts';
import { initialWorkspaceLayout } from '../features/dev-session/model/layout/workspaceLayout';
import { activityProjectId } from './agentActivityFixture';
import { editorWorkspaceFixture } from './editorWorkspaceFixture';
import { renderApp } from './renderApp';

let page: Awaited<ReturnType<typeof renderApp>> | undefined, fixture: ReturnType<typeof editorWorkspaceFixture> | undefined;
const originalObserver = globalThis.ResizeObserver;
afterEach(async () => { page?.unmount(); page = undefined; await new Promise((resolve) => setTimeout(resolve, 0)); fixture?.restore(); fixture = undefined; globalThis.ResizeObserver = originalObserver; });
const path = `/projects/${activityProjectId}/dev-session`;
const panel = () => document.querySelector<HTMLElement>('aside[aria-label="工具面板"]')!;
const panelTab = () => document.querySelector('[aria-label="工具面板"] [role="tab"][aria-selected="true"]')?.textContent;
const workspaceHidden = () => document.querySelector('[role="tablist"][aria-label="个人工作区"]')?.closest('[hidden]') !== null;
/** 记录个人布局的保存内容，并可指定服务端返回的初始布局。 */
function layoutFixture(saved?: WorkspaceLayout) {
  const f = editorWorkspaceFixture(), base = globalThis.fetch, saves: WorkspaceLayout[] = [];
  globalThis.fetch = (async (raw, init) => {
    if (String(raw).endsWith('/workspace-layout')) {
      if (init?.method === 'PUT') saves.push(JSON.parse(String(init.body)).layout as WorkspaceLayout);
      else if (saved) return Response.json({ revision: 1, layout: saved, updatedAt: '2026-09-20T00:00:00.000Z' });
    }
    return base(raw, init);
  }) as typeof fetch;
  fixture = f; return { f, saves };
}

test('无参数进入按个人布局打开面板并把形态写回地址；放大、还原、收起与右缘页签栏都走地址', async () => {
  const { saves } = layoutFixture({ ...initialWorkspaceLayout('工作区 1'), tool: { name: 'changes', mode: 'side', ratio: 0.4 } });
  page = await renderApp(path);
  // 此前地址栏是 /dev-session，页面却打开上次留下的「变更」；RFC-020 design §5.2 要求地址与页面一致。
  expect(page.search()).toEqual({ view: 'changes' }); expect(panel().dataset.mode).toBe('side'); expect(panelTab()).toBe('变更');
  expect(page.text()).toContain('比较暂不可用');
  await page.click('放大'); expect(page.search()).toEqual({ view: 'changes', panel: 'full' }); expect(panel().dataset.mode).toBe('full'); expect(workspaceHidden()).toBe(true);
  await page.click('还原'); expect(page.search()).toEqual({ view: 'changes' }); expect(workspaceHidden()).toBe(false);
  await page.click('收起'); expect(page.search()).toEqual({ view: 'cli' }); expect(panel().dataset.mode).toBe('closed');
  expect([...panel().querySelectorAll('button')].filter((node) => !node.closest('[hidden]')).map((node) => node.textContent)).toEqual(['预览', '代码', '变更', '数据访问', '参考', '会话与环境']);
  await page.click('预览'); expect(page.search()).toEqual({ view: 'preview' }); expect(panelTab()).toBe('预览'); expect(page.text()).toContain('开发预览');
  page.unmount(); page = undefined; await new Promise((resolve) => setTimeout(resolve, 0));
  // 面板状态进个人布局，并回填旧字段：预览在旁即 previewAlongside，比例沿用。
  expect(saves.at(-1)).toMatchObject({ tool: { name: 'preview', mode: 'side', ratio: 0.4 }, view: 'cli', previewAlongside: true, previewRatio: 0.4 });
});

test('旧布局（只有 view）与上次留下的放大形态：无参数进入只恢复在旁，终端不被盖住，迁移结果保存回个人布局', async () => {
  const { saves } = layoutFixture({ ...initialWorkspaceLayout('工作区 1'), view: 'code' });
  page = await renderApp(path);
  // 旧布局的 view=code 等价于放大的代码，但进页面只恢复在旁：放大是一次性的阅读形态（2026-09-23 实机）。
  expect(page.search()).toEqual({ view: 'code' }); expect(panel().dataset.mode).toBe('side'); expect(panelTab()).toBe('代码'); expect(workspaceHidden()).toBe(false);
  page.unmount(); page = undefined; await new Promise((resolve) => setTimeout(resolve, 0));
  expect(saves.at(-1)).toMatchObject({ tool: { name: 'code', mode: 'side', ratio: 0.45 }, view: 'cli' });
  page = await renderApp(path);
  expect(page.search()).toEqual({ view: 'code' }); expect(panel().dataset.mode).toBe('side');
});

test('内容区窄于 800px 时面板只有放大形态：不改地址，恢复宽度后回到在旁', async () => {
  const observers: Array<(entries: Array<{ contentRect: { width: number } }>) => void> = [];
  globalThis.ResizeObserver = class { constructor(callback: (entries: Array<{ contentRect: { width: number } }>) => void) { observers.push(callback); } observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  layoutFixture(); page = await renderApp(`${path}?view=code`);
  expect(panel().dataset.mode).toBe('side'); expect(observers.length).toBeGreaterThan(0);
  await act(async () => { for (const notify of observers) notify([{ contentRect: { width: 600 } }]); }); await page.settle();
  expect(panel().dataset.mode).toBe('full'); expect(page.text()).toContain('窗口较窄'); expect(page.search()).toEqual({ view: 'code' });
  expect([...document.querySelectorAll('button')].some((node) => node.textContent === '还原')).toBe(false);
  // 迟滞：出现滚动条让内容区少十几像素时不能在阈值附近来回切——810 仍放大，840 起才回到在旁。
  await act(async () => { for (const notify of observers) notify([{ contentRect: { width: 810 } }]); }); await page.settle();
  expect(panel().dataset.mode).toBe('full');
  await act(async () => { for (const notify of observers) notify([{ contentRect: { width: 850 } }]); }); await page.settle();
  expect(panel().dataset.mode).toBe('side'); expect(page.text()).not.toContain('窗口较窄');
  await act(async () => { for (const notify of observers) notify([{ contentRect: { width: 810 } }]); }); await page.settle();
  expect(panel().dataset.mode).toBe('side');
});

test('分隔线用方向键调宽度，限制在 30%–60% 并保存到个人布局', async () => {
  const { saves } = layoutFixture(); page = await renderApp(`${path}?view=code`);
  const separator = document.querySelector<HTMLElement>('[role="separator"][aria-label="调整工具面板宽度"]')!;
  expect(separator.getAttribute('aria-valuenow')).toBe('45');
  const press = async (key: string, times = 1) => { for (let i = 0; i < times; i++) await act(async () => { separator.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); }); await page!.settle(); };
  await press('ArrowLeft'); expect(separator.getAttribute('aria-valuenow')).toBe('48');
  await press('ArrowLeft', 10); expect(separator.getAttribute('aria-valuenow')).toBe('60');
  await press('ArrowRight', 20); expect(separator.getAttribute('aria-valuenow')).toBe('30');
  page.unmount(); page = undefined; await new Promise((resolve) => setTimeout(resolve, 0));
  expect(saves.at(-1)?.tool).toMatchObject({ name: 'code', mode: 'side' }); expect(saves.at(-1)?.tool?.ratio).toBeCloseTo(0.3);
});

test('页头连接状态芯片打开会话面板；底部版本条的「查看变更」打开变更面板', async () => {
  layoutFixture(); page = await renderApp(path);
  expect(panel().dataset.mode).toBe('closed');
  await act(async () => { document.querySelector<HTMLButtonElement>('button[title="查看会话与环境"]')!.click(); }); await page.settle();
  expect(page.search()).toEqual({ view: 'session' }); expect(panelTab()).toBe('会话与环境'); expect(page.text()).toContain('最近日志');
  await page.click('查看变更'); expect(page.search()).toEqual({ view: 'changes' }); expect(panelTab()).toBe('变更');
});
