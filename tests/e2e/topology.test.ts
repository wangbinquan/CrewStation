import { afterAll, describe, expect, test } from 'bun:test';
import { ClusterSummarySchema, ProjectClusterResourcesSchema } from '../../packages/contracts';
import type { Page } from './cdp';
import { apiGet, e2eAvailable, e2eVisitor, open, signIn } from './consoleSession';
import { openAdminSession } from './session';

// RFC-019 TP-01…TP-16 的实机部分：三层拓扑与项目形态页签在部署的集群上真的画出盘点里的对象，宽度用满，成员只读。
const available = await e2eAvailable(), session = available ? await openAdminSession() : undefined, visitor = e2eVisitor();
afterAll(async () => { await session?.close(); }, 30_000);
const nodeIds = (page: Page) => page.eval<string[]>(`[...document.querySelectorAll('[data-node-id]')].map((n) => n.getAttribute('data-node-id'))`);
const clickButton = (page: Page, text: string) => page.eval<boolean>(`(() => { const b = [...document.querySelectorAll('button')].find((n) => n.textContent === ${JSON.stringify(text)}); if (!b) throw new Error('no button ' + ${JSON.stringify(text)}); b.click(); return true; })()`);
const waitForNodes = (page: Page) => page.waitUntil(`document.querySelectorAll('[data-node-id]').length > 0`, 60_000, 500);
const pressKey = async (page: Page, key: string, windowsVirtualKeyCode: number) => { await page.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key, windowsVirtualKeyCode }); await page.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key, windowsVirtualKeyCode }); };
const colourScheme = (page: Page, value: 'light' | 'dark') => page.cmd('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] });

describe.skipIf(!session)('deployed deployment topology (RFC-019)', () => {
  test('cluster topology: the system layer shows observed platform components with static edges and the project layer lists every project with counts', async () => {
    const page = session!.admin;
    await open(page, '/admin/cluster?tab=topology'); await waitForNodes(page);
    const ids = await nodeIds(page);
    for (const id of ['cs-api', 'cs-controller', 'postgres', 'traefik', 'users', 'slots']) expect(ids).toContain(id);
    expect(await page.eval<number>(`document.querySelectorAll('[data-evidence="static"]').length`)).toBeGreaterThan(10);
    expect(await page.eval<string>(`document.querySelector('[data-node-id="cs-api"]').getAttribute('aria-label')`)).toContain('副本');
    const summary = ClusterSummarySchema.parse(await apiGet(page, '/v1/admin/cluster/summary'));
    if (summary.complete) expect(summary.projects.every((p) => typeof p.pods === 'number' && typeof p.workloads === 'number')).toBe(true);
    const count = summary.projects.length;
    await clickButton(page, `项目层 · ${count}`);
    await page.waitUntil(`document.body.innerText.includes('异常项目置顶')`, 30_000, 300);
    if (count > 0) {
      // 有项目的部署（本机）：每个项目一张卡；CI 的空平台没有项目，项目层只剩提示与空态。
      await page.waitUntil(`document.querySelectorAll('[data-node-id^="project:"]').length > 0`, 30_000, 300);
      expect(await page.bodyText()).toContain('个项目');
    }
    expect((await nodeIds(page)).filter((id) => id.startsWith('project:'))).toHaveLength(count);
    expect(page.takeErrors()).toEqual([]);
  }, 120_000);

  test.skipIf(!session?.project)('the Pod layer and the project operations tab draw every Pod the inventory reports; the member detail is read-only', async () => {
    const page = session!.admin, id = session!.project!.id;
    const inventory = ProjectClusterResourcesSchema.parse(await apiGet(page, `/v1/projects/${id}/cluster-resources`));
    expect(inventory.items.every((item) => item.availableActions.length === 0)).toBe(true);
    const pods = inventory.items.filter((item) => item.kind === 'Pod');
    await open(page, `/admin/cluster?tab=topology&layer=project&projectId=${id}&scope=project`); await waitForNodes(page);
    let ids = await nodeIds(page); for (const pod of pods) expect(ids).toContain(pod.uid);
    expect(await page.bodyText()).toContain('项目层 ›');
    // RFC-020 D3：拓扑并入「状态」页签；旧的 tab=topology 由路由改写。
    await open(page, `/projects/${id}/operations?tab=status`); await waitForNodes(page);
    ids = await nodeIds(page); for (const pod of pods) expect(ids).toContain(pod.uid);
    // 盘点里 PVC 的 facts 值是 JSON（如 capacity {"storage":"10Gi"}），卡片上要显示成量，不能原样上图。
    const pvc = inventory.items.find((item) => item.kind === 'PersistentVolumeClaim' && Object.values(item.facts).some((value) => value.startsWith('{')));
    if (pvc) expect(await page.eval<string>(`document.querySelector('[data-node-id="${pvc.uid}"]').textContent`)).not.toContain('{"');
    const first = pods[0];
    if (first) {
      await page.eval(`document.querySelector('[data-node-id="${first.uid}"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
      await page.waitUntil(`document.body.innerText.includes('这里只读')`, 10_000, 200);
      const text = await page.bodyText(); expect(text).toContain(first.name); expect(text).not.toContain('调整副本');
    }
    expect(page.takeErrors()).toEqual([]);
  }, 150_000);

  test.each([1280, 1024, 390, 320])('the topology fills the content width at %i px and degrades to a grouped list on phones', async (width) => {
    const page = session!.admin;
    await page.cmd('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    try {
      await open(page, '/admin/cluster?tab=topology');
      await page.waitUntil(`document.querySelectorAll('[data-node-id], [aria-label="部署与运行形态（列表）"]').length > 0`, 60_000, 500);
      expect(await page.eval<number>('document.documentElement.scrollWidth - innerWidth')).toBeLessThanOrEqual(1);
      if (width >= 1024) {
        const measured = await page.eval<{ frame: number; svg: number }>(`(() => { const svg = document.querySelector('svg[role="group"]'); return { frame: svg.parentElement.clientWidth, svg: svg.getBoundingClientRect().width }; })()`);
        expect(Math.abs(measured.frame - measured.svg)).toBeLessThanOrEqual(8);
      } else {
        expect(await page.eval<boolean>(`!!document.querySelector('[aria-label="部署与运行形态（列表）"]') && !document.querySelector('svg[role="group"]')`)).toBe(true);
      }
      expect(page.takeErrors()).toEqual([]);
    } finally { await page.cmd('Emulation.clearDeviceMetricsOverride'); }
  }, 90_000);

  test.skipIf(!session?.project)('under a light colour scheme the topology tokens switch, and Enter / Escape drive the read-only detail from the keyboard', async () => {
    const page = session!.admin, id = session!.project!.id;
    const stroke = () => page.eval<string>(`getComputedStyle(document.documentElement).getPropertyValue('--cs-topo-gateway-stroke').trim()`);
    await colourScheme(page, 'light');
    try {
      await open(page, `/projects/${id}/operations?tab=topology`); await waitForNodes(page);
      expect(await page.eval<string>('location.search')).toContain('tab=status');
      expect(await page.eval<boolean>(`matchMedia('(prefers-color-scheme: light)').matches`)).toBe(true);
      const light = await stroke(); expect(light).not.toBe('');
      await colourScheme(page, 'dark'); expect(await stroke()).not.toBe(light); await colourScheme(page, 'light');
      const pod = ProjectClusterResourcesSchema.parse(await apiGet(page, `/v1/projects/${id}/cluster-resources`)).items.find((item) => item.kind === 'Pod');
      if (pod) {
        await page.eval(`document.querySelector('[data-node-id="${pod.uid}"]').focus()`);
        await pressKey(page, 'Enter', 13);
        await page.waitUntil(`document.body.innerText.includes('这里只读')`, 10_000, 200);
        expect(await page.eval<string>(`document.querySelector('[data-node-id="${pod.uid}"]').getAttribute('aria-pressed')`)).toBe('true');
        await pressKey(page, 'Escape', 27);
        await page.waitUntil(`!document.body.innerText.includes('这里只读')`, 10_000, 200);
        expect(await page.eval<string | null>(`document.querySelector('[data-node-id="${pod.uid}"]').getAttribute('aria-pressed')`)).not.toBe('true');
        // 键盘焦点仍在节点上，邻域高亮（压暗其他节点）随焦点保留，这是设计；焦点移走后才全部恢复。
        await page.eval(`document.activeElement.blur()`);
        expect(await page.eval<number>(`document.querySelectorAll('[data-dim="true"]').length`)).toBe(0);
      }
      expect(page.takeErrors()).toEqual([]);
    } finally { await page.cmd('Emulation.setEmulatedMedia', { features: [] }); }
  }, 90_000);

  test.skipIf(!session?.project || visitor === undefined)('the project inventory route answers a non-admin by membership: develop passes, a tester is refused, a stranger is told the project does not exist', async () => {
    const id = session!.project!.id, page = await signIn(session!.browser, visitor!.username, visitor!.password);
    try {
      const me = await apiGet<{ isAdmin?: boolean; memberships?: { projectId: string; role: string }[] }>(page, '/v1/me');
      const role = me.memberships?.find((m) => m.projectId === id)?.role;
      const status = await page.eval<number>(`fetch('/v1/projects/${id}/cluster-resources').then((r) => r.status)`);
      // project 模块的 authorize：非成员按项目不存在处理（404，不暴露项目），成员角色不够才是 403。
      expect(status).toBe(me.isAdmin || role === 'owner' || role === 'developer' ? 200 : role === 'tester' ? 403 : 404);
    } finally { await page.close(); }
  }, 60_000);
});
