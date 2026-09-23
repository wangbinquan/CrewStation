import { afterAll, describe, expect, test } from 'bun:test';
import type { Page } from './cdp';
import { e2eAvailable, open, settle } from './consoleSession';
import { openAdminSession } from './session';

/**
 * 2026-09-23 作者裁定：宽屏（≥801px）外壳正好一屏高，顶栏与左栏不动，只有内容区（main）滚动、滚动条在内容区右侧；
 * 窄屏（≤800px，左栏变成内容上方的横条）仍是整页滚动。改前内容一长就是整个文档在滚，左栏与顶栏跟着滚走（1440×900 下网关页多出 4089px）。
 * 页面长短随环境数据而变，这里往内容区末尾临时放一块 3000px 的占位（只在本页 DOM 里，不写任何数据）制造「超过一屏」，量的是外壳本身。
 */
const session = await e2eAvailable() ? await openAdminSession() : undefined;
afterAll(async () => { await session?.close(); }, 30_000);

async function viewport(page: Page, width: number, height: number) {
  await page.cmd('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
}

interface Scrolled { doc: number; scrollY: number; mainScroll: number; mainOverflow: string; barTop: number; navBefore: number | null; navAfter: number | null }

/** 放占位，再同时让内容区与窗口各滚 1000px：宽屏只该内容区动，窄屏只该窗口动。 */
const scrollBoth = (page: Page) => page.eval<Scrolled>(`(() => {
  const main = document.querySelector('main'), nav = document.querySelector('nav[aria-label="主导航"]'), bar = main.parentElement.querySelector(':scope > header');
  const navBefore = nav ? Math.round(nav.getBoundingClientRect().top) : null;
  const spacer = document.createElement('div'); spacer.style.height = '3000px'; main.firstElementChild.append(spacer);
  main.scrollTop = 1000; window.scrollTo(0, 1000);
  return { doc: document.documentElement.scrollHeight - innerHeight, scrollY: Math.round(scrollY), mainScroll: Math.round(main.scrollTop), mainOverflow: getComputedStyle(main).overflowY,
    barTop: Math.round(bar.getBoundingClientRect().top), navBefore, navAfter: nav ? Math.round(nav.getBoundingClientRect().top) : null };
})()`);

/** 管理空间（有左栏）、项目开发列表（没有左栏）与项目页（租户左栏，环境里有项目时）。 */
function pages(): string[] {
  return ['/admin', '/projects', ...(session?.project ? [`/projects/${session.project.id}/release`] : [])];
}

describe.skipIf(!session)('外壳滚动：宽屏只有内容区滚动，窄屏整页滚动', () => {
  test.each([[1440, 900], [1280, 720]])('%i×%i：文档不滚，内容区自己滚，顶栏与左栏不动', async (width, height) => {
    const page = session!.admin;
    await viewport(page, width, height);
    for (const path of pages()) {
      await open(page, path);
      const at = await scrollBoth(page);
      expect([path, at.doc <= 1, at.scrollY, at.mainScroll, at.mainOverflow, at.barTop, at.navAfter]).toEqual([path, true, 0, 1000, 'auto', 0, at.navBefore]);
    }
    expect(page.takeErrors()).toEqual([]);
  }, 90_000);

  test('宽屏左栏比窗口高时自己滚，不带动内容区；切页时内容区回到顶部', async () => {
    const page = session!.admin;
    // 管理左栏约 711px：1280×600 下顶栏以下只有 548px。
    await viewport(page, 1280, 600); await open(page, '/admin');
    const nav = await page.eval<{ overflow: number; mainBefore: number; mainAfter: number; doc: number }>(`(() => {
      const nav = document.querySelector('nav[aria-label="主导航"]'), main = document.querySelector('main');
      const spacer = document.createElement('div'); spacer.style.height = '3000px'; main.firstElementChild.append(spacer);
      main.scrollTop = 600; const mainBefore = Math.round(main.scrollTop); nav.scrollTop = 100;
      return { overflow: nav.scrollHeight - nav.clientHeight, mainBefore, mainAfter: Math.round(main.scrollTop), doc: document.documentElement.scrollHeight - innerHeight };
    })()`);
    expect(nav.overflow).toBeGreaterThan(0); expect(nav.mainAfter).toBe(nav.mainBefore); expect(nav.doc).toBeLessThanOrEqual(1);
    // 点左栏换页：路由把内容区滚回顶部（改前只复位窗口，宽屏会停在上一页的位置）。
    await page.eval(`[...document.querySelectorAll('nav[aria-label="主导航"] a')].find((a) => a.textContent.trim() === '网关').click()`);
    await page.waitUntil(`location.pathname === '/admin/gateway'`); await settle(page);
    expect(await page.eval<number>(`Math.round(document.querySelector('main').scrollTop)`)).toBe(0);
    expect(page.takeErrors()).toEqual([]);
  }, 60_000);

  test('390×844：窄屏保持整页滚动，内容区不自成滚动区，顶栏随内容滚走', async () => {
    const page = session!.admin;
    await viewport(page, 390, 844);
    try {
      for (const path of pages()) {
        await open(page, path);
        const at = await scrollBoth(page);
        expect([path, at.doc > 2000, at.scrollY, at.mainScroll, at.mainOverflow, at.barTop]).toEqual([path, true, 1000, 0, 'visible', -1000]);
      }
      expect(page.takeErrors()).toEqual([]);
    } finally { await page.cmd('Emulation.clearDeviceMetricsOverride'); }
  }, 90_000);
});
