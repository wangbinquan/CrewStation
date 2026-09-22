import { afterAll, describe, expect, test } from 'bun:test';
import type { Page } from './cdp';
import { e2eAvailable, open } from './consoleSession';
import { openAdminSession } from './session';

// 2026-09-23 裁定的集群管理页结构在部署的集群上成立：指标条＋「拓扑｜资源清单」两级页签，缺省拓扑；切清单视图时滚动位置不动。
const available = await e2eAvailable(), session = available ? await openAdminSession() : undefined;
afterAll(async () => { await session?.close(); }, 30_000);
const clickText = (page: Page, selector: string, text: string) => page.eval<boolean>(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find((n) => n.textContent === ${JSON.stringify(text)}); if (!b) throw new Error('no element ' + ${JSON.stringify(text)}); b.click(); return true; })()`);
const loaded = (page: Page) => page.waitUntil(`document.querySelector('main') && !/载入中/.test(document.querySelector('main').innerText) && !!document.querySelector('main [role="tab"][aria-selected="true"]')`, 60_000, 300);

describe.skipIf(!session)('deployed cluster management layout', () => {
  test.each([1440, 1280])('at %i px the page opens on the topology with the metrics strip and both tabs inside the first screen', async (width) => {
    const page = session!.admin;
    await page.cmd('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    try {
      await open(page, '/admin/cluster'); await loaded(page);
      await page.waitUntil(`document.querySelectorAll('[data-node-id]').length > 0`, 60_000, 500);
      const layout = await page.eval<{ selected: string; tabs: string[]; tabTop: number; diagramTop: number; overflow: number }>(`(() => {
        const tabs = [...document.querySelectorAll('main [role="tab"]')], selected = tabs.find((n) => n.getAttribute('aria-selected') === 'true'), svg = document.querySelector('svg[role="group"]');
        return { selected: selected.textContent, tabs: tabs.map((n) => n.textContent), tabTop: Math.round(selected.getBoundingClientRect().top + scrollY), diagramTop: Math.round(svg.getBoundingClientRect().top + scrollY), overflow: document.documentElement.scrollWidth - innerWidth };
      })()`);
      expect(layout.tabs).toEqual(['拓扑', '资源清单']); expect(layout.selected).toBe('拓扑');
      // 改版前页签条在 1440 宽下距页顶 979px、1280 宽下 1174px；现在指标条压成一条，页签与图都在首屏。
      expect(layout.tabTop).toBeLessThan(560); expect(layout.diagramTop).toBeLessThan(760); expect(layout.overflow).toBeLessThanOrEqual(1);
      expect(page.takeErrors()).toEqual([]);
    } finally { await page.cmd('Emulation.clearDeviceMetricsOverride'); }
  }, 120_000);

  test('switching inventory views keeps the scroll position: the panel holds its height until the new list arrives', async () => {
    const page = session!.admin;
    await open(page, '/admin/cluster?tab=workloads'); await loaded(page);
    await page.waitUntil(`document.body.innerText.includes('符合筛选的资源')`, 60_000, 300);
    expect(await page.eval<string>(`document.querySelector('main [role="tab"][aria-selected="true"]').textContent`)).toBe('资源清单');
    await page.eval(`document.querySelector('main [role="group"][aria-label="资源清单"]').scrollIntoView({ block: 'start' })`);
    const before = await page.eval<number>('Math.round(scrollY)');
    expect(before).toBeGreaterThan(100);
    await clickText(page, 'main [role="group"][aria-label="资源清单"] button', 'Pod');
    await page.waitUntil(`document.querySelector('main [role="group"][aria-label="资源清单"] button[aria-pressed="true"]').textContent === 'Pod' && !/载入中/.test(document.querySelector('main').innerText)`, 60_000, 200);
    const after = await page.eval<number>('Math.round(scrollY)');
    // 改版前这一步 scrollY 从 979 跳到 262：面板塌成一行，浏览器把滚动位置钳到新的最大值。
    expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
    expect(page.takeErrors()).toEqual([]);
  }, 120_000);
});
