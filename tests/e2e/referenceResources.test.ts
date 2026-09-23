import { afterAll, describe, expect, test } from 'bun:test';
import { e2eAvailable, open } from './consoleSession';
import { openAdminSession } from './session';

const session = await e2eAvailable() ? await openAdminSession() : undefined;
afterAll(async () => { await session?.close(); }, 30_000);

/**
 * 2026-09-23 作者反馈「可使用资源」页签看不懂、表格超出面板有横向滚动条、UUID 这类无效信息太多。
 * 这里在真实数据上量：四类页签、面板里除主题页签条外没有任何横向滚动、接口与事件两类里不出现资源 UUID。只读，不点试调与申请。
 */
describe.skipIf(!session?.project)('开发页「可使用资源」的真实布局', () => {
  test.each([[1440, 900], [1024, 768], [390, 844]] as const)('%dpx：四类都没有横向滚动，接口与事件里没有 UUID', async (width, height) => {
    const page = session!.admin, id = session!.project!.id;
    await page.cmd('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    for (const topic of ['api', 'events', 'guide', 'agent']) {
      await open(page, `/projects/${id}/dev-session?view=reference&topic=${topic}`);
      await page.waitUntil(`!!document.querySelector('[role="tablist"][aria-label="资源主题"]') && !document.querySelector('aside[aria-label="工具面板"]')?.innerText.includes('读取中')`, 20_000);
      const measured = await page.eval<{ tabs: string[]; scrollers: string[]; overflow: number; uuids: string[] }>(`(() => {
        const panel = document.querySelector('aside[aria-label="工具面板"]');
        const body = panel.querySelector('[role="tablist"][aria-label="资源主题"]').parentElement.parentElement;
        return {
          tabs: [...document.querySelectorAll('[role="tablist"][aria-label="资源主题"] [role="tab"]')].map((node) => node.textContent),
          // 主题页签条自己窄屏时可以横滚；其余任何元素都不许。
          scrollers: [...panel.querySelectorAll('*')].filter((node) => !node.closest('[role="tablist"]') && node.scrollWidth > node.clientWidth + 1 && ['auto', 'scroll'].includes(getComputedStyle(node).overflowX)).map((node) => node.tagName + '.' + node.className),
          overflow: document.documentElement.scrollWidth - innerWidth,
          uuids: body.innerText.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? [],
        };
      })()`);
      expect(measured.tabs).toEqual(['调用接口', '接收事件', '运行环境', 'Agent 工具']);
      expect([topic, ...measured.scrollers]).toEqual([topic]);
      expect(measured.overflow).toBeLessThanOrEqual(1);
      if (topic === 'api' || topic === 'events') expect([topic, ...measured.uuids]).toEqual([topic]);
      expect(page.takeErrors()).toEqual([]);
    }
  }, 120_000);
});
