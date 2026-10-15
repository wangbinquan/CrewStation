// RFC-034 v2（proposal/rfc/RFC-034-runtime-observability/redesign-v2-20261014.md §5–§6）实机验收：部署后的两级统计接口
// 返回 v2 形状（按需聚合，没有报告），项目接口遵守费用可见性；统计页在宽窄屏、中英文与明暗下不横向溢出。
import {
  ObservationAgentPageSchema, ObservationModelPageSchema, ObservationOverviewSchema, ObservationPlatformPageSchema, ObservationPricingDirectorySchema,
  ObservationProjectPageSchema, ObservationTaskPageSchema,
} from '../../packages/contracts';
import { afterAll, describe, expect, test } from 'bun:test';
import { e2eAvailable, open, settle } from './consoleSession';
import { openAdminSession } from './session';

const session = await e2eAvailable() ? await openAdminSession() : undefined;
afterAll(async () => { await session?.close(); }, 30_000);
type Reads = Record<string, { status: number; body: unknown }>;
/** 浏览器里以当前身份读一组统计接口，窗口为最近 7 天、按浏览器时区切日桶。 */
function readAll(prefix: string, paths: readonly string[]): Promise<Reads> {
  return session!.admin.eval<Reads>(`(async () => {
    const to = new Date(), from = new Date(to.getTime() - 7 * 86400000);
    const window = 'from=' + from.toISOString() + '&to=' + to.toISOString() + '&tzOffset=' + (-to.getTimezoneOffset());
    const result = {};
    for (const path of ${JSON.stringify(paths)}) {
      const response = await fetch(${JSON.stringify(prefix)} + path + (path === '/pricing' ? '' : '?' + window));
      result[path] = { status: response.status, body: await response.json() };
    }
    return result;
  })()`);
}

describe.skipIf(!session)('RFC-034 v2 runtime observability', () => {
  test('system statistics answer with the v2 shapes for the last 7 days', async () => {
    const reads = await readAll('/v1/admin/observability', ['/overview', '/tasks', '/agents', '/models', '/projects', '/platform', '/pricing']);
    for (const [path, read] of Object.entries(reads)) expect(read.status, path).toBe(200);
    const overview = ObservationOverviewSchema.parse(reads['/overview']!.body);
    expect(overview.costVisible).toBe(true);
    expect(overview.daily.length).toBeGreaterThanOrEqual(7);
    expect(overview.usage.calls).toBe(overview.bySource.business.calls + overview.bySource.development.calls + overview.bySource.platform.calls);
    ObservationTaskPageSchema.parse(reads['/tasks']!.body); ObservationAgentPageSchema.parse(reads['/agents']!.body);
    ObservationModelPageSchema.parse(reads['/models']!.body); ObservationProjectPageSchema.parse(reads['/projects']!.body);
    ObservationPlatformPageSchema.parse(reads['/platform']!.body); ObservationPricingDirectorySchema.parse(reads['/pricing']!.body);
  });

  test.skipIf(!session?.project)('project statistics follow the project cost visibility', async () => {
    const id = encodeURIComponent(session!.project!.id);
    const reads = await readAll(`/v1/projects/${id}/observability`, ['/overview', '/tasks', '/agents', '/models']);
    for (const [path, read] of Object.entries(reads)) expect(read.status, path).toBe(200);
    const overview = ObservationOverviewSchema.parse(reads['/overview']!.body);
    expect(overview.topProjects).toEqual([]);
    if (!overview.costVisible) expect(overview.usage.costNano).toBeNull();
  });

  test('statistics pages fit desktop and phone widths in Chinese/English and light/dark', async () => {
    const page = session!.admin, roots = ['/admin/observability', ...(session!.project ? [`/projects/${session!.project.id}/observability`] : [])];
    for (const [width, locale, scheme] of [[1280, 'zh-CN', 'light'], [390, 'zh-CN', 'light'], [390, 'en-US', 'dark']] as const) {
      await page.cmd('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: false });
      await page.cmd('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
      for (const root of roots) for (const tab of ['overview', 'tasks', 'agents', ...(root.startsWith('/admin') ? ['projects', 'platform'] : [])]) {
        await open(page, `${root}?tab=${tab}`);
        await page.eval(`document.querySelector('header button[lang="${locale}"]')?.click()`); await settle(page);
        const diagnostic = JSON.stringify({ width, locale, scheme, root, tab });
        expect(await page.eval<string>('document.documentElement.lang'), diagnostic).toBe(locale);
        expect(await page.eval<boolean>('!!document.querySelector("[data-runtime-statistics] [role=tabpanel]")'), diagnostic).toBe(true);
        expect(await page.eval<number>('document.documentElement.scrollWidth - innerWidth'), diagnostic).toBeLessThanOrEqual(1);
        expect(await page.eval<string[]>(`[...document.querySelectorAll('main [role="alert"]')].map((node) => node.textContent)`), diagnostic).toEqual([]);
      }
      expect(page.takeErrors()).toEqual([]);
    }
  }, 180_000);
});
