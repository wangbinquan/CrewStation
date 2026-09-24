import { afterAll, describe, expect, test } from 'bun:test';
import type { Page } from './cdp';
import { e2eAvailable, open } from './consoleSession';
import { openAdminSession } from './session';

// 2026-09-23 裁定的集群管理页：只有「拓扑｜资源清单」两个页签，缺省拓扑；状态条（集群容量、受管资源计数、采集状态）在管理总览最上面。
// 宽屏（≥1100px）两个页签与项目「部署与运行形态」都长满一屏：图框、详情栏、表格区各自滚动，整页不出纵向滚动条。
// 外壳宽屏时可能是文档滚，也可能是定高的 main 自己滚（同日另一项裁定），两种多出来的高度都算整页溢出。
const available = await e2eAvailable(), session = available ? await openAdminSession() : undefined;
afterAll(async () => { await session?.close(); }, 30_000);
const clickText = (page: Page, selector: string, text: string) => page.eval<boolean>(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find((n) => n.textContent === ${JSON.stringify(text)}); if (!b) throw new Error('no element ' + ${JSON.stringify(text)}); b.click(); return true; })()`);
const loaded = (page: Page) => page.waitUntil(`document.querySelector('main') && !/载入中/.test(document.querySelector('main').innerText) && !!document.querySelector('main [role="tab"][aria-selected="true"]')`, 60_000, 300);
const viewport = (page: Page, width: number, height: number) => page.cmd('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
const overflow = (page: Page) => page.eval<number>(`(() => { const main = document.querySelector('main'); return Math.max(0, document.documentElement.scrollHeight - innerHeight) + Math.max(0, main.scrollHeight - main.clientHeight); })()`);
const scrolled = (page: Page) => page.eval<number>(`Math.round(scrollY + document.querySelector('main').scrollTop)`);
const detailLoaded = `!!document.querySelector('section[aria-label="资源详情"]') && !/载入中/.test(document.querySelector('section[aria-label="资源详情"]').innerText)`;
/** 形态图工作区的两栏：图框所在的左栏与紧挨着的详情栏（没打开详情时为 null），以及图例底边。 */
const workspace = (page: Page) => page.eval<{ mainRight: number; detailLeft: number | null; detailBottom: number | null; legendBottom: number }>(`(() => {
  const column = document.querySelector('svg[role="group"]').parentElement.parentElement.parentElement, detail = column.nextElementSibling;
  return { mainRight: Math.round(column.getBoundingClientRect().right), detailLeft: detail ? Math.round(detail.getBoundingClientRect().left) : null,
    detailBottom: detail ? Math.round(detail.getBoundingClientRect().bottom) : null, legendBottom: Math.round(document.querySelector('main [aria-label="图例"]').getBoundingClientRect().bottom) };
})()`);
const views = 'main [role="group"][aria-label="资源清单"]';

describe.skipIf(!session)('deployed cluster management layout', () => {
  test.each([[1440, 900], [1280, 800]])('at %i×%i the page opens on the topology with only two tabs and fills one screen, with the detail beside the diagram', async (width, height) => {
    const page = session!.admin;
    await viewport(page, width, height);
    try {
      await open(page, '/admin/cluster'); await loaded(page);
      await page.waitUntil(`document.querySelectorAll('[data-node-id]').length > 0`, 60_000, 500);
      expect(await page.eval<string[]>(`[...document.querySelectorAll('main [role="tab"]')].map((n) => n.textContent)`)).toEqual(['拓扑', '资源清单']);
      expect(await page.eval<string>(`document.querySelector('main [role="tab"][aria-selected="true"]').textContent`)).toBe('拓扑');
      // 状态条挪到了管理总览；改版前这里是指标条，图的起点被压到 600px 以下，整页 1441px（1728×873）。
      expect(await page.text()).not.toContain('集群容量 · 整个集群');
      expect(await overflow(page)).toBeLessThanOrEqual(1);
      // 图框与图例一直排到窗口底边（扣掉主区下内边距），图比可用高度高时在图框里滚。
      const closed = await workspace(page);
      expect(closed.legendBottom).toBeGreaterThan(height - 40); expect(closed.legendBottom).toBeLessThanOrEqual(height); expect(closed.detailLeft).toBeNull();
      await page.eval(`document.querySelector('[data-node-id="cs-api"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
      await page.waitUntil(detailLoaded, 30_000, 200);
      // 打开详情后仍是一屏：详情栏贴在图的右侧、与图例同一条底边，内容再长也在栏里滚。
      expect(await overflow(page)).toBeLessThanOrEqual(1);
      const beside = await workspace(page);
      expect(beside.detailLeft!).toBeGreaterThan(beside.mainRight); expect(Math.abs(beside.detailBottom! - beside.legendBottom)).toBeLessThanOrEqual(2);
      expect(page.takeErrors()).toEqual([]);
    } finally { await page.cmd('Emulation.clearDeviceMetricsOverride'); }
  }, 120_000);

  test('the inventory fills one screen: only the table region scrolls under a header that stays put, the detail opens on the right, and switching views keeps the switcher in place', async () => {
    const page = session!.admin;
    await viewport(page, 1440, 900);
    try {
      await open(page, '/admin/cluster?tab=workloads'); await loaded(page);
      await page.waitUntil(`document.body.innerText.includes('符合筛选的资源')`, 60_000, 300);
      expect(await overflow(page)).toBeLessThanOrEqual(1);
      // 表格区是清单卡里唯一的滚动区：行多时滚下去，表头仍贴着表格区的顶边。
      const sticky = await page.eval<{ scrollable: boolean; thTop: number; regionTop: number }>(`(() => {
        const table = document.querySelector('[data-cluster-resource]').closest('table'), region = table.parentElement.parentElement; region.scrollTop = 200;
        return { scrollable: region.scrollHeight > region.clientHeight, thTop: Math.round(table.querySelector('th').getBoundingClientRect().top), regionTop: Math.round(region.getBoundingClientRect().top) };
      })()`);
      if (sticky.scrollable) expect(Math.abs(sticky.thTop - sticky.regionTop)).toBeLessThanOrEqual(1);
      await page.eval(`document.querySelector('[data-cluster-resource]').click()`);
      await page.waitUntil(detailLoaded, 30_000, 200);
      // 改版前详情排在清单下方，43 行时点一行要滚到 2560px 才看得到。
      expect(await overflow(page)).toBeLessThanOrEqual(1);
      const columns = await page.eval<{ listRight: number; detailLeft: number }>(`(() => { const detail = document.querySelector('section[aria-label="资源详情"]').parentElement, list = detail.previousElementSibling; return { listRight: Math.round(list.getBoundingClientRect().right), detailLeft: Math.round(detail.getBoundingClientRect().left) }; })()`);
      expect(columns.detailLeft).toBeGreaterThan(columns.listRight);
      const before = await page.eval<number>(`Math.round(document.querySelector(${JSON.stringify(views)}).getBoundingClientRect().top)`);
      await clickText(page, `${views} button`, 'Pod');
      await page.waitUntil(`document.querySelector('${views} button[aria-pressed="true"]').textContent === 'Pod' && !/载入中/.test(document.querySelector('main').innerText)`, 60_000, 200);
      expect(await page.eval<number>(`Math.round(document.querySelector(${JSON.stringify(views)}).getBoundingClientRect().top)`)).toBe(before);
      expect(await overflow(page)).toBeLessThanOrEqual(1);
      expect(page.takeErrors()).toEqual([]);
    } finally { await page.cmd('Emulation.clearDeviceMetricsOverride'); }
  }, 120_000);

  // 2026-09-24 作者裁定：详情顶部的管理动作两两一行、不可用原因写在各自按钮下，同一行的按钮顶端对齐。改前按格子居中：buildkitd 的「重启」
  // 比「调整副本」低 11px；英文的「Restore release replicas」比格子宽 15px，压到右边的「Delete / stop」上。
  test('the detail action buttons line up: buttons in one row share their top edge whatever reasons sit under them, and none is wider than its cell, in both languages', async () => {
    const page = session!.admin;
    await viewport(page, 1440, 900);
    try {
      await open(page, '/admin/cluster?tab=workloads'); await loaded(page);
      await page.waitUntil(`document.body.innerText.includes('符合筛选的资源')`, 60_000, 300);
      // 平台组件的工作负载：重启可做，其余不可用、原因长短不一，正是会错开的情形。
      await page.eval(`(() => { const rows = [...document.querySelectorAll('[data-cluster-resource]')]; (rows.find((b) => b.closest('tr').innerText.includes('平台内置')) ?? rows[0]).click(); })()`);
      await page.waitUntil(`${detailLoaded} && !!document.querySelector('[data-cluster-actions] button')`, 30_000, 200);
      for (const locale of ['zh-CN', 'en-US']) {
        await page.eval(`document.querySelector('button[lang="${locale}"]').click()`); await Bun.sleep(300);
        const cells = await page.eval<{ top: number; left: number; right: number; cellRight: number }[]>(`[...document.querySelectorAll('[data-cluster-actions] > div')].map((cell) => { const b = cell.querySelector('button').getBoundingClientRect(), c = cell.getBoundingClientRect(); return { top: Math.round(b.top), left: Math.round(b.left), right: Math.round(b.right), cellRight: Math.round(c.right) }; })`);
        expect(cells).toHaveLength(4);
        // 按行分组：左边界没有继续右移就是新的一行。
        const rows: (typeof cells)[] = [];
        for (const cell of cells) { const row = rows.at(-1); if (row && cell.left > row.at(-1)!.left) row.push(cell); else rows.push([cell]); }
        for (const row of rows) expect(Math.max(...row.map((c) => c.top)) - Math.min(...row.map((c) => c.top))).toBeLessThanOrEqual(1);
        for (const cell of cells) expect(cell.right).toBeLessThanOrEqual(cell.cellRight + 1);
      }
      expect(page.takeErrors()).toEqual([]);
    } finally {
      await page.eval(`document.querySelector('button[lang="zh-CN"]')?.click()`).catch(() => undefined);
      await page.cmd('Emulation.clearDeviceMetricsOverride');
    }
  }, 120_000);

  test('below 1100px the inventory flows with the page and switching views keeps the scroll position: the panel holds its height until the new list arrives', async () => {
    const page = session!.admin;
    await viewport(page, 1024, 800);
    try {
      await open(page, '/admin/cluster?tab=workloads'); await loaded(page);
      await page.waitUntil(`document.body.innerText.includes('符合筛选的资源')`, 60_000, 300);
      await page.eval(`document.querySelector(${JSON.stringify(views)}).scrollIntoView({ block: 'start' })`);
      const before = await scrolled(page);
      expect(before).toBeGreaterThan(100);
      await clickText(page, `${views} button`, 'Pod');
      await page.waitUntil(`document.querySelector('${views} button[aria-pressed="true"]').textContent === 'Pod' && !/载入中/.test(document.querySelector('main').innerText)`, 60_000, 200);
      // 2026-09-22 实机：面板塌成一行时浏览器把滚动位置钳到新的最大值（979 → 262）。
      expect(Math.abs(await scrolled(page) - before)).toBeLessThanOrEqual(2);
      expect(page.takeErrors()).toEqual([]);
    } finally { await page.cmd('Emulation.clearDeviceMetricsOverride'); }
  }, 120_000);

  test('the admin overview opens on the cluster status strip, before the pending items; a count tile opens the matching inventory view', async () => {
    const page = session!.admin;
    await open(page, '/admin');
    await page.waitUntil(`[...document.querySelectorAll('main h2')].some((h) => h.textContent === '集群状态')`, 30_000, 300);
    const strip = await page.eval<{ top: number; todo: number; tiles: string[] }>(`(() => {
      const section = [...document.querySelectorAll('main h2')].find((h) => h.textContent === '集群状态').closest('section');
      return { top: Math.round(section.getBoundingClientRect().top), todo: Math.round(document.querySelector('main section[aria-labelledby="admin-todo-title"]').getBoundingClientRect().top), tiles: [...section.querySelectorAll('a')].map((a) => a.getAttribute('href')) };
    })()`);
    expect(strip.top).toBeLessThan(strip.todo);
    expect(strip.tiles).toEqual(['/admin/cluster?tab=workloads', '/admin/cluster?tab=pods', '/admin/cluster?tab=network&kind=Service', '/admin/cluster?tab=storage&kind=PersistentVolumeClaim', '/admin/cluster?tab=pods&status=abnormal']);
    expect(await page.text()).toContain('集群容量 · 整个集群');
    await page.eval(`document.querySelector('main a[href="/admin/cluster?tab=pods"]').click()`);
    await page.waitUntil(`location.pathname === '/admin/cluster' && document.querySelector('${views} button[aria-pressed="true"]')?.textContent === 'Pod'`, 30_000, 200);
    expect(page.takeErrors()).toEqual([]);
  }, 90_000);

  test.skipIf(!session?.project)('the project deployment topology uses the same workspace: one screen, the read-only detail beside the diagram', async () => {
    const page = session!.admin, id = session!.project!.id;
    await viewport(page, 1440, 900);
    try {
      await open(page, `/projects/${id}/operations?tab=topology`);
      await page.waitUntil(`document.querySelectorAll('[data-node-id]').length > 0`, 60_000, 500);
      expect(await overflow(page)).toBeLessThanOrEqual(1);
      await page.eval(`document.querySelector('[data-node-id]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
      await page.waitUntil(`!!document.querySelector('[data-node-id][aria-pressed="true"]')`, 10_000, 200); await Bun.sleep(500);
      expect(await overflow(page)).toBeLessThanOrEqual(1);
      const columns = await workspace(page);
      expect(columns.detailLeft!).toBeGreaterThan(columns.mainRight); expect(Math.abs(columns.detailBottom! - columns.legendBottom)).toBeLessThanOrEqual(2);
      expect(page.takeErrors()).toEqual([]);
    } finally { await page.cmd('Emulation.clearDeviceMetricsOverride'); }
  }, 120_000);
});
