import type { Page } from './cdp';
import { afterAll, describe, expect, test } from 'bun:test';
import { e2eAvailable, open, settle } from './consoleSession';
import { openAdminSession } from './session';

/**
 * 运行与诊断 → 调用链（2026-09-23 作者裁定，修订 RFC-020 §4.5）：左边列出本应用全部调用链，右边是选中那条的分层回放；
 * 窄屏列表在上、详情在下。只量结构、接口作用域与形态，不断言会变的业务数据。
 */
const session = await e2eAvailable() ? await openAdminSession() : undefined;
afterAll(async () => { await session?.close(); }, 30_000);

async function viewport(page: Page, width: number) {
  await page.cmd('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
}
const LIST = '[aria-label="本应用的调用链"]';

describe.skipIf(!session?.project)('调用链（运行与诊断）', () => {
  test.each([1280, 390])('%dpx：列表与接口一致，选中一条后详情分层显示；宽屏并排、窄屏上下，无横向溢出', async (width) => {
    const page = session!.admin, id = session!.project!.id;
    await viewport(page, width); await open(page, `/projects/${id}/operations?tab=trace`);
    await page.waitUntil(`document.body.innerText.includes('按 trace_id 打开') && (!!document.querySelector(${JSON.stringify(LIST)}) || document.body.innerText.includes('还没有调用链'))`);
    const api = await page.eval<{ status: number; items: number }>(`fetch('/v1/projects/${id}/traces?limit=50').then(async (r) => ({ status: r.status, items: r.ok ? (await r.json()).items.length : -1 }))`);
    expect(api.status).toBe(200);
    const rows = await page.eval<number>(`document.querySelectorAll(${JSON.stringify(`${LIST} li`)}).length`);
    expect(rows).toBe(api.items);
    if (rows > 0) {
      await page.eval(`document.querySelector(${JSON.stringify(`${LIST} li button`)}).click()`); await settle(page);
      await page.waitUntil(`location.search.includes('traceId=') && document.body.innerText.includes('trace_id') && !document.body.innerText.includes('在左侧选一条调用链')`);
      const layout = await page.eval<{ listRight: number; listBottom: number; detailLeft: number; detailTop: number }>(`(() => {
        const list = document.querySelector(${JSON.stringify(LIST)}).closest('section').getBoundingClientRect();
        const detail = [...document.querySelectorAll('section')].find((node) => node.querySelector('h2')?.textContent === '调用链详情').getBoundingClientRect();
        return { listRight: list.right, listBottom: list.bottom, detailLeft: detail.left, detailTop: detail.top };
      })()`);
      if (width >= 1024) expect(layout.detailLeft).toBeGreaterThanOrEqual(layout.listRight);
      else {
        expect(layout.detailTop).toBeGreaterThanOrEqual(layout.listBottom);
        // 2026-09-23 实机：窄屏点选后详情仍在列表下方两千多像素处——路由导航复位滚动，冲掉了滚向详情的动作。
        // 详情很短时页面滚到底也到不了顶部（实测停在 659px，整块可见），所以只要求它的顶部进入可视区、至少露出 60px。
        await page.waitUntil(`(() => { const d = [...document.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent === '调用链详情'); const top = d.getBoundingClientRect().top; return top > -5 && top < innerHeight - 60; })()`, 5000);
      }
    } else expect(await page.text()).toContain('每一个都会产生一条调用链');
    expect(await page.eval<number>('document.documentElement.scrollWidth - innerWidth')).toBeLessThanOrEqual(1);
    expect(page.takeErrors()).toEqual([]);
  }, 60_000);

  test('本项目里没有的 trace_id：接口 404，页面写明可能属于别的项目', async () => {
    const page = session!.admin, id = session!.project!.id, missing = '0'.repeat(32);
    await viewport(page, 1280); await open(page, `/projects/${id}/operations?tab=trace&traceId=${missing}`);
    await page.waitUntil(`document.body.innerText.includes('本项目里没有这条调用链')`);
    expect(await page.eval<number>(`fetch('/v1/projects/${id}/traces/${missing}').then((r) => r.status)`)).toBe(404);
    expect(await page.text()).toContain('每个应用只看得到自己的那一部分');
    expect(page.takeErrors()).toEqual([]);
  }, 45_000);
});
