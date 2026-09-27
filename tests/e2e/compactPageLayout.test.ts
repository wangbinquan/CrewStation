import { afterAll, describe, expect, test } from 'bun:test';
import { e2eAvailable, open } from './consoleSession';
import { openAdminSession } from './session';

const available = await e2eAvailable(), session = available ? await openAdminSession() : undefined;
afterAll(async () => { await session?.close(); }, 30_000);

describe.skipIf(!session)('页面标题和集群清单的有效空间', () => {
  test.each(['pods', 'storage'])('%s：汇总不能挤掉表格，短窗口仍能操作双向滚动条', async (tab) => {
    const page = session!.admin;
    try {
      for (const [width, height] of [[1440, 900], [1280, 800], [1366, 768], [1280, 720]]) {
        await page.cmd('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
        await open(page, `/admin/cluster?tab=${tab}`);
        await page.waitUntil(`!!document.querySelector('[data-cluster-resource]') && !/载入中/.test(document.querySelector('main').innerText)`, 60_000);
        const layout = await page.eval<{ height: number; bottom: number; header: number; overflow: number; reachable: boolean; sticky: number }>(`(() => {
          const table = document.querySelector('[data-cluster-resource]').closest('table'), region = table.parentElement.parentElement;
          const main = document.querySelector('main'), rect = region.getBoundingClientRect();
          region.scrollTop = 120; region.scrollLeft = region.scrollWidth;
          const hit = document.elementFromPoint(rect.right - 8, rect.bottom - 8);
          return { height: region.clientHeight, bottom: rect.bottom, header: document.querySelector('main h1').closest('header').getBoundingClientRect().height,
            overflow: Math.max(0, main.scrollHeight - main.clientHeight), reachable: hit === region || region.contains(hit),
            sticky: Math.abs(table.querySelector('th').getBoundingClientRect().top - rect.top) };
        })()`);
        // 2026-09-27 实机：900px 高窗口里七行汇总占 273px，Pod 表格仅 145px，只能看到一行。
        expect(layout.height).toBeGreaterThanOrEqual(height! * 0.5);
        expect(layout.header).toBeLessThanOrEqual(40);
        expect(layout.bottom).toBeLessThanOrEqual(height!);
        expect(layout.overflow).toBeLessThanOrEqual(1);
        expect(layout.reachable).toBe(true);
        expect(layout.sticky).toBeLessThanOrEqual(1);
      }
      expect(page.takeErrors()).toEqual([]);
    } finally { await page.cmd('Emulation.clearDeviceMetricsOverride'); }
  }, 180_000);

  test('范围汇总可用键盘展开和收起，打开资源详情后滚动条仍在可见区域', async () => {
    const page = session!.admin;
    try {
      await page.cmd('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
      await open(page, '/admin/cluster?tab=pods');
      await page.waitUntil(`!!document.querySelector('main details > summary') && !!document.querySelector('[data-cluster-resource]')`, 60_000);
      for (const expanded of [true, false]) {
        await page.eval(`document.querySelector('main details > summary').focus()`);
        await page.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
        await page.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
        expect(await page.eval<boolean>(`document.querySelector('main details').open`)).toBe(expanded);
        expect(await page.eval<number>(`document.querySelector('main table').parentElement.parentElement.clientHeight`)).toBeGreaterThanOrEqual(240);
      }
      await page.eval(`document.querySelector('[data-cluster-resource]').click()`);
      await page.waitUntil(`!!document.querySelector('[data-cluster-actions]')`, 30_000);
      const bounds = await page.eval<{ height: number; bottom: number }>(`(() => { const r = document.querySelector('main table').parentElement.parentElement.getBoundingClientRect(); return { height: r.height, bottom: r.bottom }; })()`);
      expect(bounds.height).toBeGreaterThanOrEqual(300); expect(bounds.bottom).toBeLessThanOrEqual(720);
      expect(page.takeErrors()).toEqual([]);
    } finally { await page.cmd('Emulation.clearDeviceMetricsOverride'); }
  }, 90_000);

  test('公共页面标题保持紧凑，标题、说明和操作在中英文及窄屏均不裁切', async () => {
    const page = session!.admin;
    try {
      for (const width of [1280, 390, 320]) {
        await page.cmd('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false });
        for (const path of ['/admin', '/admin/projects', '/admin/authentication', '/admin/compute', '/admin/requests', '/projects']) {
          await open(page, path);
          for (const locale of ['zh-CN', 'en-US']) {
            await page.eval(`document.querySelector('button[lang="${locale}"]').click()`);
            const layout = await page.eval<{ height: number; clipped: boolean; overflow: number }>(`(() => {
              const header = document.querySelector('main h1').closest('header'), r = header.getBoundingClientRect();
              const clipped = [...header.querySelectorAll('h1,p,button,a')].some(n => { const b = n.getBoundingClientRect(); return b.left < r.left - 1 || b.right > r.right + 1 || b.bottom > r.bottom + 1; });
              return { height: r.height, clipped, overflow: document.documentElement.scrollWidth - innerWidth };
            })()`);
            if (width === 1280) expect(layout.height).toBeLessThanOrEqual(64);
            expect(layout.clipped).toBe(false); expect(layout.overflow).toBeLessThanOrEqual(1);
          }
        }
      }
      expect(page.takeErrors()).toEqual([]);
    } finally {
      await page.eval(`document.querySelector('button[lang="zh-CN"]')?.click()`);
      await page.cmd('Emulation.clearDeviceMetricsOverride');
    }
  }, 180_000);
});
