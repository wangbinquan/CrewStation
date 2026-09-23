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
    await page.eval(`[...document.querySelectorAll('aside[aria-label="工具面板"] button')].find((node) => node.textContent === '可使用资源').click()`); await settle(page);
    expect(await page.eval<string>('location.search')).toContain('view=reference');
    expect(page.takeErrors()).toEqual([]);
  }, 60_000);

  test('WS-07：预览、代码与变更占满工具面板（在旁与放大），不内嵌卡片，顶端操作条贴住面板正文顶边，内容在自己内部滚动', async () => {
    const page = session!.admin, id = session!.project!.id;
    await viewport(page, 1440);
    // 2026-09-23 实机：面板正文 651px，预览只占 266px（iframe 停在 200px 下限）、编辑器 241px；打开文件后编辑器按全文撑高，连保存按钮一起在面板里滚走。
    // 2026-09-23 作者裁定：三者直接铺进页签，不再内缩成带边框的嵌套卡片，按钮在最上面不随内容滚动。
    for (const query of ['view=preview', 'view=preview&panel=full', 'view=code&file=crewstation.yaml', 'view=changes']) {
      await open(page, `/projects/${id}/dev-session?${query}`);
      await page.waitUntil(`document.querySelector('aside[aria-label="工具面板"]')?.dataset.mode !== 'closed'`);
      if (query.includes('file=')) await page.waitUntil(`!!document.querySelector('aside[aria-label="工具面板"] .cm-editor')`).catch(() => undefined);
      const fit = await page.eval<{ gap: number; overflow: number; top: number; border: number }>(`(() => {
        const body = document.querySelector('aside[aria-label="工具面板"] > div > [role="tabpanel"]');
        const content = [...body.children].find((node) => !node.hidden).firstElementChild, toolbar = content.querySelector('header');
        return { gap: Math.round(body.getBoundingClientRect().bottom - content.getBoundingClientRect().bottom), overflow: body.scrollHeight - body.clientHeight,
          top: Math.round(toolbar.getBoundingClientRect().top - body.getBoundingClientRect().top), border: parseFloat(getComputedStyle(content).borderLeftWidth) };
      })()`);
      // 内容铺到面板正文底边；正文自己不出现滚动，长文件在编辑器里滚；操作条贴住顶边、外层没有卡片边框。
      expect([query, fit.gap <= 1, fit.overflow <= 1, fit.top <= 1, fit.border]).toEqual([query, true, true, true, 0]);
    }
    expect(page.takeErrors()).toEqual([]);
  }, 60_000);

  test('WS-07：开发页撑到窗口底边，状态条贴着内容区底边、整页不滚动（1280×720／1440×900／1920×1080）', async () => {
    const page = session!.admin, id = session!.project!.id;
    // 2026-09-23 作者裁定：主区原按 calc(100dvh - 210px) 定高，状态条下方空 47–67px。
    for (const [width, height] of [[1280, 720], [1440, 900], [1920, 1080]] as const) {
      await viewport(page, width, height); await open(page, `/projects/${id}/dev-session?view=preview`);
      await page.waitUntil(`!!document.querySelector('aside[aria-label="工具面板"]')?.closest('section')?.querySelector(':scope > footer')`);
      const fit = await page.eval<{ gap: number; scroll: number }>(`(() => {
        const footer = document.querySelector('aside[aria-label="工具面板"]').closest('section').querySelector(':scope > footer');
        const pad = parseFloat(getComputedStyle(document.querySelector('main')).paddingBottom);
        return { gap: Math.round(innerHeight - pad - footer.getBoundingClientRect().bottom), scroll: document.documentElement.scrollHeight - innerHeight };
      })()`);
      expect([width, Math.abs(fit.gap) <= 1, fit.scroll <= 1]).toEqual([width, true, true]);
    }
    expect(page.takeErrors()).toEqual([]);
  }, 60_000);

  test('WS-07：文档式面板内容短时最后一张卡拉到面板底边（数据访问、可使用资源、会话与环境，1440×900 在旁）', async () => {
    const page = session!.admin, id = session!.project!.id;
    await viewport(page, 1440);
    // 2026-09-23 作者裁定：变更卡原止于 641px、面板正文到 783px，下方一大块留白。
    for (const view of ['data', 'reference', 'session']) {
      await open(page, `/projects/${id}/dev-session?view=${view}`);
      await page.waitUntil(`document.querySelector('aside[aria-label="工具面板"]')?.dataset.mode === 'side'`);
      const reach = await page.eval<number>(`(() => {
        const body = document.querySelector('aside[aria-label="工具面板"] > div > [role="tabpanel"]'); body.scrollTop = 0;
        const pane = [...body.children].find((node) => !node.hidden), sections = [...pane.querySelectorAll('section')];
        const bordered = (node) => parseFloat(getComputedStyle(node).borderBottomWidth) > 0 && node.getBoundingClientRect().height > 0;
        const cards = sections.filter((node) => bordered(node) && !sections.some((other) => other !== node && other.contains(node) && bordered(other)));
        // 可使用资源（2026-09-23 起）是两行列表而不是卡片：量长满的主题正文。
        const blocks = cards.length > 0 ? cards : [...pane.querySelectorAll('[role="tabpanel"]')].filter((node) => !node.hidden).slice(-1);
        return Math.round(body.getBoundingClientRect().bottom - Math.max(...blocks.map((node) => node.getBoundingClientRect().bottom)));
      })()`);
      // 最后一张卡离面板正文底边只剩内边距（8px）；内容比一屏长时为负，超出部分由面板正文滚动。
      expect([view, reach <= 12]).toEqual([view, true]);
    }
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

  // 2026-09-23 修订 RFC-020 D3：健康与形态重新分成两个页签，部署与运行形态在最前；合并期间的 tab=status 由路由改写。
  test('WS-15／WS-17／WS-16：运行与诊断六页签且旧页签改写；项目设置五组；开发资源旧地址落到参考面板', async () => {
    const page = session!.admin, id = session!.project!.id;
    await viewport(page, 1280); await open(page, `/projects/${id}/operations?tab=status`);
    expect(await page.eval<string>('location.search')).toContain('tab=topology');
    expect(await texts(page, '[role="tablist"][aria-label="运行与诊断"] [role="tab"]')).toEqual(['部署与运行形态', '健康状态', '日志', '告警与通知', '事件投递', '调用链回放']);
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
