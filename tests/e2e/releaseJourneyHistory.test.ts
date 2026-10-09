import { afterAll, describe, expect, test } from 'bun:test';
import { apiGet, e2eAvailable, open, settle } from './consoleSession';
import { openAdminSession } from './session';

const session = await e2eAvailable() ? await openAdminSession() : undefined;
afterAll(async () => { await session?.close(); }, 30_000);
const integrationId = process.env.CS_E2E_RELEASE_INTEGRATION_ID;
const integration = session && integrationId ? await apiGet<{ id: string; kind: string; state: string }>(session.admin, `/v1/projects/${encodeURIComponent(integrationId)}`) : undefined;
if (integration && (!['APIProxy', 'EventProducer'].includes(integration.kind) || integration.state !== 'active')) throw Error('Release integration acceptance requires an active integration project');
const space = integration ? 'admin/integrations' : 'projects', selectedProjectId = integration?.id ?? session?.project?.id;
const scenarios = [1440, 1024, 390, 320].flatMap(width =>
  ['zh-CN', 'en-US'].flatMap(locale => ['light', 'dark'].map(theme => [width, locale, theme] as const)));

describe.skipIf(!selectedProjectId)(`${space} 发布历史的真实路由、返回上下文和只读请求`, () => {
  test.each(scenarios)('%dpx／%s／%s：末行进入五步历史，回看零写，返回保留滚动和触发焦点', async (width, locale, theme) => {
    const page = session!.admin, path = `/${space}/${selectedProjectId}/release`;
    const steps = locale === 'zh-CN' ? '发布步骤' : 'Release steps', back = locale === 'zh-CN' ? '返回发布总览' : 'Back to releases';
    await page.cmd('Emulation.setDeviceMetricsOverride', { width, height: 440, deviceScaleFactor: 1, mobile: false });
    await page.cmd('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    await page.cmd('Network.enable');
    const writes: string[] = [];
    const stop = session!.browser.on(page.sessionId, 'Network.requestWillBeSent', params => {
      const request = params.request as { method?: string; url?: string } | undefined;
      if (request?.url && new URL(request.url).pathname.startsWith('/v1/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method ?? '')) writes.push(`${request.method} ${new URL(request.url).pathname}`);
    });
    try {
      await open(page, path);
      expect(await page.eval<string>('location.pathname')).toBe(path);
      await page.eval(`document.querySelector('header button[lang="${locale}"]').click()`);
      await settle(page);
      await page.waitUntil(`!!document.querySelector('main a[id^="release-history-"]')`);
      const before = await page.eval<{ id: string; main: number; window: number; href: string }>(`(() => {
        const link = [...document.querySelectorAll('main a[id^="release-history-"]')].at(-1);
        link.scrollIntoView({block:'center'}); link.focus({preventScroll:true});
        return {id:link.id, main:document.querySelector('main').scrollTop, window:scrollY, href:link.href};
      })()`);
      await page.eval(`document.getElementById(${JSON.stringify(before.id)}).click()`);
      await page.waitUntil(`!!document.getElementById('release-wizard-step-heading')`);
      expect(await page.eval<string>('location.pathname')).toBe(new URL(before.href).pathname);
      expect(await page.eval<number>(`document.querySelectorAll('[role="dialog"]').length`)).toBe(0);
      expect(await page.eval<number>(`document.querySelectorAll('main nav[aria-label="${steps}"] button').length`)).toBe(5);
      expect(await page.eval<string>('document.documentElement.lang')).toBe(locale);
      const colors = await page.eval<{ dark: boolean; background: string }>(`({dark:matchMedia('(prefers-color-scheme: dark)').matches,background:getComputedStyle(document.body).backgroundColor})`);
      expect(colors.dark).toBe(theme === 'dark'); expect(colors.background).toBe(theme === 'dark' ? 'rgb(17, 21, 28)' : 'rgb(245, 247, 250)');
      const geometry = await page.eval<{ overflow: number; outside: number }>(`({overflow:document.documentElement.scrollWidth-innerWidth,outside:[...document.querySelectorAll('main nav[aria-label="${steps}"] button')].filter(node=>{const r=node.getBoundingClientRect();return r.left < -1 || r.right > innerWidth+1;}).length})`);
      expect(geometry.overflow).toBeLessThanOrEqual(1); expect(geometry.outside).toBe(0);
      await page.eval(`document.querySelector('main nav[aria-label="${steps}"] button').click()`);
      await settle(page);
      expect(await page.eval<string>(`document.activeElement.id`)).toBe('release-wizard-step-heading');
      await page.eval(`(() => {
        const back = [...document.querySelectorAll('main a')].find(node => node.textContent.trim() === ${JSON.stringify(back)});
        if (!back) throw Error('Missing history return control'); back.click();
      })()`);
      await page.waitUntil(`document.activeElement.id === ${JSON.stringify(before.id)}`);
      const after = await page.eval<{ main: number; window: number; overflow: number; dialog: number }>(`({main:document.querySelector('main').scrollTop,window:scrollY,overflow:document.documentElement.scrollWidth-innerWidth,dialog:document.querySelectorAll('[role="dialog"]').length})`);
      expect(after.main).toBeCloseTo(before.main, 0); expect(after.window).toBeCloseTo(before.window, 0);
      expect(after.overflow).toBeLessThanOrEqual(1); expect(after.dialog).toBe(0);
      await page.eval(`(() => {
        const prepare = [...document.querySelectorAll('main a')].find(node => new URL(node.href).pathname.endsWith('/release/publish'));
        if (!prepare) throw Error('Missing preparation route'); prepare.click();
      })()`);
      await page.waitUntil(`!!document.querySelector('main input[name="version"]')`);
      const prepare = await page.eval<{ path: string; overflow: number; fields: number; dialogs: number; outside: number }>(`({path:location.pathname,overflow:document.documentElement.scrollWidth-innerWidth,fields:document.querySelectorAll('main input[name="version"],main textarea[name="message"]').length,dialogs:document.querySelectorAll('[role="dialog"]').length,outside:[...document.querySelectorAll('main input,main textarea,main select')].filter(node=>{const r=node.getBoundingClientRect();return r.left < -1 || r.right > innerWidth+1;}).length})`);
      expect(prepare.path).toBe(path + '/publish'); expect(prepare.fields).toBe(2); expect(prepare.dialogs).toBe(0);
      expect(prepare.overflow).toBeLessThanOrEqual(1); expect(prepare.outside).toBe(0);
      // 回看只读取原记录，不能顺手确认验证、补造阶段或再次提交上线。
      expect(writes).toEqual([]); expect(page.takeErrors()).toEqual([]);
    } finally { stop(); }
  }, 60_000);
});
