import type { Page } from './cdp';
import { afterAll, describe, expect, test } from 'bun:test';
import { e2eAvailable, open, settle } from './consoleSession';
import { openAdminSession } from './session';

/**
 * RFC-020 项目工作台信息架构：左栏五项生命周期顺序、概览一屏、开发页终端旁的工具面板、运行与诊断五页签、
 * 发布页时间线、项目设置五组、旧地址重定向。只量结构与形态，不断言会变的业务数据。
 */
const session = await e2eAvailable() ? await openAdminSession() : undefined;
afterAll(async () => { await session?.close(); }, 30_000);

async function viewport(page: Page, width: number, height = 900) {
  await page.cmd('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
}
const overflow = (page: Page) => page.eval<number>('document.documentElement.scrollWidth - innerWidth');
const texts = (page: Page, selector: string) => page.eval<string[]>(`[...document.querySelectorAll(${JSON.stringify(selector)})].map((node) => node.textContent.trim())`);
async function key(page: Page, name: string, code: number) {
  await page.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: name, windowsVirtualKeyCode: code });
  await page.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: name, windowsVirtualKeyCode: code });
}

describe.skipIf(!session?.project)('项目工作台信息架构（RFC-020）', () => {
  test('WS-01／WS-02：左栏五项按生命周期排列，概览在 1440×900 下主区一屏', async () => {
    const page = session!.admin, id = session!.project!.id;
    await viewport(page, 1440); await open(page, `/projects/${id}`);
    expect(await texts(page, 'ul[aria-label="项目页面"] a')).toEqual(['概览', '开发', '发布与上线', '运行与诊断', '项目设置']);
    expect(await page.eval<number>('document.documentElement.scrollHeight')).toBeLessThanOrEqual(901);
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    const text = await page.text();
    expect(text).toContain('正式版本'); expect(text).toContain('待验证版本'); expect(text).not.toContain('快捷入口');
    expect(page.takeErrors()).toEqual([]);
  }, 45_000);

  test.each([1440, 1280, 1024, 390])('WS-07／WS-08／WS-18：%dpx 开发页工具面板收起、在旁、放大三态无横向溢出', async (width) => {
    const page = session!.admin, id = session!.project!.id;
    await viewport(page, width); await open(page, `/projects/${id}/dev-session`);
    const panel = 'aside[aria-label="工具面板"]';
    await page.waitUntil(`!!document.querySelector(${JSON.stringify(panel)})`);
    const closedMode = await page.eval<string | null>(`document.querySelector(${JSON.stringify(panel)})?.dataset.mode ?? null`);
    expect(closedMode !== null && ['closed', 'side', 'full'].includes(closedMode)).toBe(true);
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    await open(page, `/projects/${id}/dev-session?view=code`);
    await page.waitUntil(`document.querySelector(${JSON.stringify(panel)})?.dataset.mode !== 'closed'`);
    // 内容区（视口减 208px 左栏与内边距）窄于 800px 只有放大形态：1024 视口就是这种情况；1280 起在旁并有可拖的分隔线。
    const mode = await page.eval<string>(`document.querySelector(${JSON.stringify(panel)}).dataset.mode`);
    if (width >= 1280) { expect(mode).toBe('side'); expect(await page.eval<boolean>(`!!document.querySelector('[role="separator"][aria-label="调整工具面板宽度"]:not([hidden])')`)).toBe(true); }
    else expect(mode).toBe('full');
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    await open(page, `/projects/${id}/dev-session?view=code&panel=full`);
    await page.waitUntil(`document.querySelector(${JSON.stringify(panel)})?.dataset.mode === 'full'`);
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    expect(page.takeErrors()).toEqual([]);
  }, 60_000);

  test('WS-18：面板页签方向键可达；收起后右缘页签栏仍能打开工具', async () => {
    const page = session!.admin, id = session!.project!.id;
    await viewport(page, 1440); await open(page, `/projects/${id}/dev-session?view=preview`);
    const tabs = '[role="tablist"][aria-label="工具面板"] [role="tab"]';
    await page.waitUntil(`document.querySelectorAll(${JSON.stringify(tabs)}).length >= 5`);
    await page.eval(`document.querySelector('${'[role="tablist"][aria-label="工具面板"] [role="tab"][aria-selected="true"]'}').focus()`);
    await key(page, 'ArrowRight', 39); await settle(page);
    expect(await page.eval<string>('location.search')).toContain('view=code');
    await page.eval(`[...document.querySelectorAll('button')].find((node) => node.textContent === '收起').click()`); await settle(page);
    expect(await page.eval<string>('location.search')).toContain('view=cli');
    expect(await page.eval<string>(`document.querySelector('aside[aria-label="工具面板"]').dataset.mode`)).toBe('closed');
    await page.eval(`[...document.querySelectorAll('aside[aria-label="工具面板"] button')].find((node) => node.textContent === '参考').click()`); await settle(page);
    expect(await page.eval<string>('location.search')).toContain('view=reference');
    expect(page.takeErrors()).toEqual([]);
  }, 60_000);

  test('WS-14：发布页有合并的发布记录时间线，待验证卡上是上线／回退或负责人说明', async () => {
    const page = session!.admin, id = session!.project!.id;
    await viewport(page, 1440); await open(page, `/projects/${id}/release`);
    await page.waitUntil(`!!document.querySelector('ul[aria-label="发布记录"]') || document.body.innerText.includes('尚无发布记录')`);
    const text = await page.text();
    expect(text).not.toContain('切流记录'); expect(text).toContain('发布记录');
    const actions = await texts(page, 'section[aria-label="实际部署版本"] button');
    expect(actions.some((label) => label.startsWith('上线 ') || label.startsWith('回退到 ')) || text.includes('由项目负责人上线') || text.includes('尚未部署')).toBe(true);
    expect(page.takeErrors()).toEqual([]);
  }, 45_000);

  test('WS-15／WS-17／WS-16：运行与诊断五页签且旧页签改写；项目设置五组；开发资源旧地址落到参考面板', async () => {
    const page = session!.admin, id = session!.project!.id;
    await viewport(page, 1280); await open(page, `/projects/${id}/operations?tab=health`);
    expect(await page.eval<string>('location.search')).toContain('tab=status');
    expect(await texts(page, '[role="tablist"][aria-label="运行与诊断"] [role="tab"]')).toEqual(['状态', '日志', '告警与通知', '事件投递', '调用链回放']);
    await open(page, `/projects/${id}/settings`);
    const groups = await texts(page, 'nav[aria-label="设置分组"] button');
    // 分组按钮带一行说明（RFC-009），只比对标题。
    expect(groups).toHaveLength(5); for (const group of ['环境变量', '应用展示', '成员与角色', '项目信息', '高级']) expect(groups.some((label) => label.startsWith(group))).toBe(true);
    await open(page, `/projects/${id}/resources?section=events`);
    expect(await page.eval<string>('location.pathname')).toBe(`/projects/${id}/dev-session`);
    expect(await page.eval<string>('location.search')).toContain('view=reference');
    expect(await page.eval<string>('location.search')).toContain('topic=events');
    expect(await page.text()).toContain('最近投递');
    expect(page.takeErrors()).toEqual([]);
  }, 60_000);
});
