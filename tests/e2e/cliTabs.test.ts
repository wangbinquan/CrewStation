import type { Page } from './cdp';
import { afterAll, describe, expect, test } from 'bun:test';
import { apiGet, e2eAvailable, open } from './consoleSession';
import { openAdminSession } from './session';

/**
 * 开发页 CLI 区（2026-09-23 裁定：Xshell 式标签组）：新开入口只在页头，CLI 区里只有标签组——没有工作区页签、布局菜单与工作区设置；
 * 有 CLI 时各组铺满 CLI 区、每组一条标签栏，没有 CLI 时中间是创建入口。只打开页面、只读：不新开、不结束、不拖动任何 CLI。
 */
const session = await e2eAvailable() ? await openAdminSession() : undefined;
const devSession = session?.project ? await apiGet<{ taskId?: string }>(session.admin, `/v1/projects/${session.project.id}/dev-session`).catch(() => undefined) : undefined;
afterAll(async () => { await session?.close(); }, 30_000);

async function viewport(page: Page, width: number, height = 900) {
  await page.cmd('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
}
const AREA = '[role="region"][aria-label="CLI 区"]';

describe.skipIf(!devSession?.taskId)('开发页 CLI 标签组（Xshell 式）', () => {
  // 2026-09-23 作者裁定：「＋ 创建开发Agent会话 ▾」拆成主按钮「创建开发Agent会话」与描边按钮「选择算力档位」。
  test.each([1440, 1024])('%dpx：页头有「创建开发Agent会话」与「选择算力档位」，CLI 区只有标签组且铺满，没有旧工具行，无横向溢出', async (width) => {
    const page = session!.admin, id = session!.project!.id;
    await viewport(page, width); await open(page, `/projects/${id}/dev-session?view=cli`);
    await page.waitUntil(`!!document.querySelector(${JSON.stringify(AREA)})`, 20_000);
    await page.waitUntil(`!/正在恢复个人布局/.test(document.querySelector('main')?.innerText ?? '')`, 20_000);
    expect(await page.eval<string[]>(`[...document.querySelectorAll('main header button')].map((node) => node.textContent.trim())`)).toContain('创建开发Agent会话');
    expect(await page.eval<string[]>(`[...document.querySelectorAll('main header summary, main header button')].map((node) => node.textContent.trim())`)).toContain('选择算力档位');
    const text = await page.eval<string>(`document.querySelector(${JSON.stringify(AREA)}).innerText`);
    for (const gone of ['＋ 工作区', '布局 ▾', '工作区设置', '收起窗口', '向前排列']) expect(text).not.toContain(gone);
    const shape = await page.eval<{ area: number[]; groups: number[][]; bars: number; tabs: number }>(`(() => {
      const box = (node) => { const r = node.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom].map(Math.round); };
      const groups = [...document.querySelectorAll('${AREA} [data-dock-group]')];
      return { area: box(document.querySelector(${JSON.stringify(AREA)})), groups: groups.map(box), bars: document.querySelectorAll('${AREA} [role="tablist"][aria-label="标签组"]').length, tabs: document.querySelectorAll('${AREA} [data-dock-tab]').length };
    })()`);
    if (shape.groups.length === 0) {
      expect(text).toContain('创建第一个开发Agent会话');
    } else {
      // 各组是按分屏树绝对定位的兄弟：合起来正好铺满 CLI 区，每组一条标签栏。
      const [left, top, right, bottom] = shape.area;
      expect(Math.abs(Math.min(...shape.groups.map((g) => g[0]!)) - left!)).toBeLessThanOrEqual(2);
      expect(Math.abs(Math.min(...shape.groups.map((g) => g[1]!)) - top!)).toBeLessThanOrEqual(2);
      expect(Math.abs(Math.max(...shape.groups.map((g) => g[2]!)) - right!)).toBeLessThanOrEqual(2);
      expect(Math.abs(Math.max(...shape.groups.map((g) => g[3]!)) - bottom!)).toBeLessThanOrEqual(2);
      expect(shape.bars).toBe(shape.groups.length); expect(shape.tabs).toBeGreaterThanOrEqual(shape.groups.length);
    }
    expect(await page.eval<number>('document.documentElement.scrollWidth - innerWidth')).toBeLessThanOrEqual(1);
    expect(page.takeErrors()).toEqual([]);
  }, 60_000);
});
