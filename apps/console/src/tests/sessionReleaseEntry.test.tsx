import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { activityProjectId } from './agentActivityFixture';
import { editorWorkspaceFixture } from './editorWorkspaceFixture';
import { renderApp } from './renderApp';
import { consoleStyles, sourceAt } from './sourceScan';

/**
 * 释放开发会话的入口（2026-09-23 作者裁定）：页头最后一个按钮「释放会话」打开「会话与环境」面板并直接展开确认；
 * 面板里「当前会话」卡在最上面、「最近日志」在最下面；卡片里的释放按钮在底部操作条靠左，灰色说明区只有一句后果。
 */
let page: Awaited<ReturnType<typeof renderApp>> | undefined, f: ReturnType<typeof editorWorkspaceFixture> | undefined;
afterEach(async () => { page?.unmount(); page = undefined; await new Promise((resolve) => setTimeout(resolve, 0)); f?.restore(); f = undefined; });
const path = `/projects/${activityProjectId}/dev-session`;
const otherUser = '01a0bf5d-8f4b-7000-8000-00000000c0de';
const panel = () => document.querySelector<HTMLElement>('aside[aria-label="工具面板"]')!;
/** 开发页的页头（不是卡片标题行）。 */
const pageHeader = () => document.querySelector<HTMLElement>('header.context')!;
const headerRelease = () => [...pageHeader().querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent === '释放会话');
const confirmation = () => document.querySelector<HTMLElement>('[role="alertdialog"]');
/** 会话面板里一项项内容：卡片取标题，链接取文字。 */
function sessionPaneItems(): HTMLElement[] {
  const shown = [...panel().querySelector('[role="tabpanel"]')!.children].filter((node) => !(node as HTMLElement).hidden);
  expect(shown).toHaveLength(1);
  return [...shown[0]!.firstElementChild!.children] as HTMLElement[];
}
const itemLabel = (node: Element) => node.matches('section') ? node.querySelector(':scope > header h2')?.textContent : node.textContent;

/** 记下每次释放前的工作区检查：页头每点一次都要重新检查，面板开关不能顺带再查。 */
function countChecks(): () => number {
  const base = globalThis.fetch; let count = 0;
  globalThis.fetch = (async (raw, init) => {
    if (String(raw).endsWith('/workspace-status')) count += 1;
    return base(raw, init);
  }) as typeof fetch;
  return () => count;
}

test('会话与环境：当前会话在最上面、最近日志在最下面；释放按钮在卡片底部操作条，灰色说明区不放按钮', async () => {
  f = editorWorkspaceFixture(); page = await renderApp(`${path}?view=session`);
  const items = sessionPaneItems();
  expect(items.map(itemLabel)).toEqual(['当前会话', '连接与恢复', '历史对话会话', '最近日志']);
  const card = items[0]!, release = [...card.querySelectorAll('button')].find((node) => node.textContent === '释放会话')!;
  expect(release.closest('.actions')?.parentElement).toBe(card);
  expect(card.querySelector('footer')?.textContent).toBe('结束开发并释放环境：确认后销毁容器与工作卷，未提交或未推送的代码会丢失。');
  expect(card.querySelector('footer button')).toBeNull();
  // 按钮曾放在限宽 420px、靠右对齐的一栏里，在宽面板上悬在中间（作者 2026-09-23：「为什么在中间而不是旁边」）。happy-dom 不排版，这里锁样式。
  const rule = new RegExp(String.raw`(?:^|\})\s*\.control\s*\{([^}]*)\}`).exec(sourceAt(consoleStyles(), 'dev-session/components/ReleaseControl.module.css').code)?.[1] ?? '';
  expect(rule).toMatch(/align-items\s*:\s*flex-start/); expect(rule).not.toMatch(/max-width|flex-end/);
});

test('页头「释放会话」排在最后，打开会话面板并直接展开确认；再点一次重新检查；收起再打开面板不会自己展开', async () => {
  f = editorWorkspaceFixture(); const checks = countChecks(); page = await renderApp(path);
  expect(panel().dataset.mode).toBe('closed');
  expect([...pageHeader().querySelectorAll('button, a')].at(-1)?.textContent).toBe('释放会话');
  await act(async () => headerRelease()!.click()); await page.settle();
  expect(page.search()).toEqual({ view: 'session' }); expect(checks()).toBe(1);
  expect(confirmation()?.textContent).toContain('释放这个开发会话？');
  expect(confirmation()?.closest('section')?.querySelector('h2')?.textContent).toBe('当前会话');
  expect(confirmation()?.contains(document.activeElement)).toBe(true);
  await act(async () => headerRelease()!.click()); await page.settle();
  expect(checks()).toBe(2); expect(confirmation()?.contains(document.activeElement)).toBe(true); expect(page.search()).toEqual({ view: 'session' });
  await page.click('取消'); expect(confirmation()).toBeNull();
  await page.click('收起'); await page.click('会话与环境');
  expect(page.search()).toEqual({ view: 'session' }); expect(confirmation()).toBeNull(); expect(checks()).toBe(2);
  expect(f.writes.some((write) => write.method === 'DELETE')).toBe(false);
});

test('面板开着别的工具时点页头：切到会话面板再展开确认，只检查一次，焦点在确认上', async () => {
  f = editorWorkspaceFixture(); const checks = countChecks(); page = await renderApp(`${path}?view=code`);
  expect(panel().dataset.mode).toBe('side'); expect(confirmation()).toBeNull();
  await act(async () => headerRelease()!.click()); await page.settle();
  expect(page.search()).toEqual({ view: 'session' }); expect(checks()).toBe(1);
  expect(confirmation()?.closest('[hidden]')).toBeNull(); expect(confirmation()?.contains(document.activeElement)).toBe(true);
  // 回到代码再回来：确认还在（面板没有收起，会话面板一直挂着），也不再检查一次。
  await page.click('代码'); await page.click('会话与环境');
  expect(confirmation()?.textContent).toContain('释放这个开发会话？'); expect(checks()).toBe(1);
});

test('既不是会话创建者也不是负责人：页头和卡片都没有释放入口，也没有释放说明', async () => {
  f = editorWorkspaceFixture(); const base = globalThis.fetch;
  globalThis.fetch = (async (raw, init) => {
    const response = await base(raw, init);
    if (new URL(String(raw), 'http://localhost').pathname !== '/v1/me') return response;
    return Response.json({ ...await response.json(), id: otherUser, name: '另一位开发者', memberships: [{ projectId: activityProjectId, role: 'developer' }] });
  }) as typeof fetch;
  page = await renderApp(`${path}?view=session`);
  expect(sessionPaneItems().map(itemLabel)[0]).toBe('当前会话');
  expect(headerRelease()).toBeUndefined();
  expect([...document.querySelectorAll('button')].some((node) => node.textContent === '释放会话')).toBe(false);
  expect(page.text()).not.toContain('结束开发并释放环境');
});
