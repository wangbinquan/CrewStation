import { RuntimeCompleteReportSchema } from '../../packages/contracts';
import { afterAll, describe, expect, test } from 'bun:test';
import { e2eAvailable, open, settle } from './consoleSession';
import { openAdminSession } from './session';
import { installRuntimeStatisticsFixture, measureRuntimeOverview } from './runtimeStatisticsFixture';

const session = await e2eAvailable() ? await openAdminSession() : undefined;
afterAll(async () => { await session?.close(); }, 30_000);
describe.skipIf(!session)('RFC-034 formal runtime observation', () => {
  test('deployed system statistics endpoint returns one complete original report', async () => {
    const response = await session!.admin.eval<{ status: number; report: unknown }>(`(async () => {
      const initial=await fetch('/v1/admin/observability/statistics?from=2026-01-01T00:00:00.000Z&to=2027-01-01T00:00:00.000Z&timezone=Asia%2FShanghai');
      let report=await initial.json();const reportId=report.reportId,deadline=performance.now()+4000;
      while(report.state==='building') {
        if(performance.now()>=deadline)throw new Error('Original complete report did not settle');
        await new Promise(resolve=>setTimeout(resolve,100));
        const next=await fetch('/v1/admin/observability/reports/'+reportId);if(!next.ok)throw new Error('Original report status unavailable');
        report=await next.json();if(report.reportId!==reportId)throw new Error('Original complete report identity changed');
      }
      return {status:initial.status,report};
    })()`);
    expect(response.status).toBe(200);
    const report=RuntimeCompleteReportSchema.parse(response.report);
    expect(['ready','not-ready']).toContain(report.state);
    if(report.state==='ready') {
      expect(report.header).toMatchObject({scope:'system',projectionVersion:2,coverage:'complete',filters:{from:'2026-01-01T00:00:00.000Z',to:'2027-01-01T00:00:00.000Z',timezone:'Asia/Shanghai'}});
      if(report.summary.metrics.state==='ready')expect(report.summary.metrics.cost.currency).toBe('CNY');
      else expect(report.summary.metrics.state).toBe('not-applicable');
    } else if(report.state==='not-ready') {
      expect(report.gaps.length).toBeGreaterThan(0);
      expect(report).not.toHaveProperty('summary');expect(report).not.toHaveProperty('metrics');
    }
  });
  test('layout archive preserves original attempt native pages and rejects unknown parents', async () => {
    const page = session!.admin, f = await installRuntimeStatisticsFixture(page);
    await open(page, '/admin/observability/tasks/' + f.taskId + '?' + f.query);
    const result = await page.eval<{ pages: { section: string; parent: string; total: string; items: unknown[]; sameSnapshot: boolean; eof: boolean }[]; unknownParentRejected: boolean }>(`(async () => {
      const report = await (await fetch('/v1/admin/observability/tasks/${f.taskId}')).json();
      const path = '/v1/admin/observability/reports/' + report.header.reportId + '/pages?';
      const attempts = await (await fetch(path + new URLSearchParams({section:'attempts',parent:'${f.taskId}',pageSize:'100'}))).json();
      const pages = [];
      for (const attempt of attempts.items) for (const section of ['captures','native-pages']) {
        const original = await (await fetch(path + new URLSearchParams({section,parent:attempt.key,pageSize:'100'}))).json();
        pages.push({section,parent:original.parent,total:original.total,items:original.items,
          sameSnapshot:original.reportId===report.header.reportId && original.snapshotId===report.header.snapshotId,eof:original.nextCursor===null});
      }
      let unknownParentRejected = false;
      try { await fetch(path + new URLSearchParams({section:'native-pages',parent:'unregistered-original-attempt',pageSize:'100'})); }
      catch (error) { unknownParentRejected = String(error).includes('Unknown immutable report page request'); }
      return {pages,unknownParentRejected};
    })()`);
    expect(result.pages).toHaveLength(2);
    expect(result.pages.map(row => row.section)).toEqual(['captures', 'native-pages']);
    expect(new Set(result.pages.map(row => row.parent)).size).toBe(1);
    for (const row of result.pages) {
      expect(row).toMatchObject({ total: '0', items: [], sameSnapshot: true, eof: true });
      expect(row.parent).toContain(f.taskId);
    }
    expect(result.unknownParentRejected).toBe(true);
    expect(page.takeErrors()).toEqual([]);
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
      const lane = scroll + ' [data-runtime-section="swimlane"] button[aria-label]:not(:disabled)';
      // Readiness and the original click share one DOM evaluation: background refresh can replace the region between CDP awaits.
      await page.waitUntil(`(() => {const bar=document.querySelector('${lane}');if(!bar)return false;bar.click();return true})()`);
      await page.waitUntil('!!document.querySelector("dialog[open]")');
      expect(await page.eval<boolean>('!!document.querySelector("dialog[open]")')).toBe(true);
      await page.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await page.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await settle(page); expect(await page.eval<boolean>('!document.querySelector("dialog[open]")')).toBe(true);
      const unzoomedWidth = await page.eval<number>(`(async () => {
        const started=performance.now();
        for(;;) {
          const region=document.querySelector('${scroll}'),button=region?.closest('section')?.querySelector('header button');
          if(region?.clientWidth>0 && region.querySelector('[data-runtime-section="swimlane"] button[aria-label]:not(:disabled)') && button && !button.disabled) {
            const originalWidth=region.scrollWidth;button.click();return originalWidth;
          }
          if(performance.now()-started>15000)throw new Error('Original timeline zoom control did not settle');
          await new Promise(resolve=>setTimeout(resolve,200));
        }
      })()`);
      await page.waitUntil(`document.querySelector('${scroll}')?.clientWidth > 0 && document.querySelector('${scroll}').scrollWidth > ${unzoomedWidth}`);
      expect(await page.eval<boolean>(`document.querySelector('${scroll}').scrollWidth > document.querySelector('${scroll}').clientWidth`)).toBe(true);
      expect(await page.eval<number>('document.documentElement.scrollWidth-innerWidth')).toBeLessThanOrEqual(1);
      expect(page.takeErrors()).toEqual([]);
    }
  }, 120_000);
});
