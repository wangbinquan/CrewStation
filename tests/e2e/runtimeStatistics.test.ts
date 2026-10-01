import { afterAll, describe, expect, test } from 'bun:test';
import { e2eAvailable, open, settle } from './consoleSession';
import { openAdminSession } from './session';
import { installRuntimeStatisticsFixture, measureRuntimeOverview } from './runtimeStatisticsFixture';

const session = await e2eAvailable() ? await openAdminSession() : undefined;
afterAll(async () => { await session?.close(); }, 30_000);
describe.skipIf(!session)('RFC-034 formal runtime observation', () => {
  test('deployed system statistics endpoint returns a real bounded snapshot', async () => {
    const response = await session!.admin.eval<{ status: number; scope: string; cohort: string; currency: string }>(`fetch('/v1/admin/observability/statistics?from=2026-01-01T00:00:00.000Z&to=2027-01-01T00:00:00.000Z&timezone=Asia%2FShanghai').then(async r => {const d=await r.json();return {status:r.status,scope:d.scope,cohort:d.cohort,currency:d.metrics?.cost.currency}})`);
    expect(response).toEqual({ status: 200, scope: 'system', cohort: 'started', currency: 'CNY' });
  });
  test('24 trend columns, standard card gaps and five views fit both levels in Chinese/English and light/dark', async () => {
    const page = session!.admin, f = await installRuntimeStatisticsFixture(page);
    for (const [width, locale, scheme] of [[1280, 'zh-CN', 'light'], [390, 'zh-CN', 'light'], [390, 'en-US', 'dark']] as const) {
      await page.cmd('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: false });
      await page.cmd('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
      for (const root of ['/admin/observability', '/projects/' + f.projectId + '/observability']) {
        await open(page, root + '?' + f.query);
        await page.eval(`document.querySelector('header button[lang="${locale}"]').click()`); await settle(page);
        const actual = await measureRuntimeOverview(page);
        expect(actual.bars).toBe(24); expect(actual.tokenLabels).toEqual(['2,400', ...Array.from({ length: 23 }, () => '0')]); expect(actual.alignedRange).toBe(true); expect(actual.noExport).toBe(true); expect(actual.gap).toBeCloseTo(actual.expectedGap, 0); expect(actual.gap).toBeGreaterThan(0); expect(actual.sectionGap).toBeCloseTo(actual.expectedSectionGap, 0);
        expect(actual.tokenBuckets).toEqual(['1,920', '0', '0', '480']); expect(actual.bucketPairsAligned).toBe(true); expect(actual.stackPercent).toEqual(['80%', '0%', '0%', '20%']);
        await page.eval(`document.querySelector('[data-runtime-statistics] [role="tabpanel"] [role="group"] button').focus()`);
        await page.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        await page.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }); await settle(page);
        expect(await page.eval<boolean>(`(() => {const groups=document.querySelectorAll('[data-runtime-statistics] [role="tabpanel"] [role="group"]'), second=groups[0].querySelectorAll('button')[1];return document.activeElement===second && groups[1].textContent.includes(second.getAttribute('aria-label').split(' · ')[0])})()`)).toBe(true);
        expect(await page.eval<string[]>(`[...document.querySelectorAll('[data-runtime-statistics] [role="tabpanel"] [role="group"]')[1].querySelectorAll('[data-token-buckets] dd')].map(node=>node.textContent)`)).toEqual(['0', '0', '0', '0']);
        await page.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 8 });
        await page.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 8 }); await settle(page);
        expect(await page.eval<boolean>(`document.activeElement===document.querySelector('[data-runtime-statistics] [role="tabpanel"] [role="group"] button')`)).toBe(true);
        expect(await page.eval<string[]>(`[...document.querySelectorAll('[data-runtime-statistics] [role="tabpanel"] [role="group"]')[1].querySelectorAll('[data-token-buckets] dd')].map(node=>node.textContent)`)).toEqual(['1,920', '0', '0', '480']);
        expect(actual.overflow).toBeLessThanOrEqual(1); expect(actual.mainOverflow).toBeLessThanOrEqual(1); expect(actual.chartOverflow).toBeLessThanOrEqual(1);
        for (const tab of ['tasks', 'agents', 'usage', 'performance']) {
          await open(page, root + '?tab=' + tab + '&' + f.query);
          await page.eval(`document.querySelector('header button[lang="${locale}"]').click()`); await settle(page);
          expect(await page.eval<string>('document.documentElement.lang')).toBe(locale);
          expect(await page.eval<number>('document.documentElement.scrollWidth-innerWidth')).toBeLessThanOrEqual(1);
        }
        expect(page.takeErrors()).toEqual([]);
      }
      await open(page, '/admin/observability/tasks/' + f.taskId + '?' + f.query);
      await page.eval(`document.querySelector('header button[lang="${locale}"]').click()`); await settle(page);
      const scroll = '[data-runtime-task] [role="region"]';
      expect(await page.eval<boolean>(`document.querySelector('${scroll}').scrollWidth > document.querySelector('${scroll}').clientWidth`)).toBe(width < 680);
      await page.eval(`document.querySelector('${scroll} button').click()`); await settle(page);
      expect(await page.eval<boolean>('!!document.querySelector("dialog[open]")')).toBe(true);
      await page.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await page.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await settle(page); expect(await page.eval<boolean>('!document.querySelector("dialog[open]")')).toBe(true);
      await page.eval(`document.querySelector('[data-runtime-task] section header button').click()`);
      expect(await page.eval<boolean>(`document.querySelector('${scroll}').scrollWidth > document.querySelector('${scroll}').clientWidth`)).toBe(true);
      expect(await page.eval<number>('document.documentElement.scrollWidth-innerWidth')).toBeLessThanOrEqual(1);
      expect(page.takeErrors()).toEqual([]);
    }
  }, 120_000);
});
