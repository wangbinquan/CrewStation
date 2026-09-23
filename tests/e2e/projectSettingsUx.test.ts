import type { Page } from './cdp';
import { afterAll, describe, expect, test } from 'bun:test';
import { e2eAvailable, open, settle } from './consoleSession';
import { openAdminSession } from './session';

const session = await e2eAvailable() ? await openAdminSession() : undefined;
afterAll(async () => { await session?.close(); }, 30_000);
// RFC-020：项目设置五组；「可使用资源」四类（2026-09-23）住在开发页放大的面板里，数据与项目信息各归其家。
const routes = ['settings', 'settings?tab=visibility', 'settings?tab=members', 'settings?tab=advanced', 'settings?tab=info', 'dev-session?view=reference&panel=full&topic=api', 'dev-session?view=reference&panel=full&topic=events', 'dev-session?view=reference&panel=full&topic=guide', 'dev-session?view=reference&panel=full&topic=agent'];

async function openLocalized(page: Page, path: string, locale: string) {
  await open(page, path);
  await page.eval(`document.querySelector('header button[lang="${locale}"]').click()`);
  await settle(page);
}

/** 真正量测页面宽度和可见表单，防止二级导航挤压正文或把整个编辑器默认摊开；参考面板放大后要占满内容区且主题页签可见。 */
describe.skipIf(!session?.project)('项目设置与资源的真实布局', () => {
  test.each([
    [1280, 'zh-CN', 'light'], [390, 'zh-CN', 'light'], [320, 'zh-CN', 'light'], [390, 'en-US', 'dark'],
  ] as const)('%dpx / %s / %s：九个地址无整页溢出，编辑器按需打开', async (width, locale, scheme) => {
    const page = session!.admin, id = session!.project!.id;
    await page.cmd('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: false });
    await page.cmd('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
    for (const route of routes) {
      await openLocalized(page, `/projects/${id}/${route}`, locale);
      const measured = await page.eval<{ overflow: number; forms: number; reviewTools: boolean; panelFull: boolean; topicTabs: boolean; colorScheme: string; locale: string }>(`(() => ({
        overflow: document.documentElement.scrollWidth - innerWidth,
        forms: [...document.querySelectorAll('main form')].filter(node => node.getBoundingClientRect().height > 0).length,
        reviewTools: document.querySelector('main')?.innerText.includes('评审工具'),
        panelFull: document.querySelector('aside[data-mode="full"]') !== null,
        topicTabs: [...document.querySelectorAll('[role="tablist"] [role="tab"]')].some(node => node.getBoundingClientRect().height > 0),
        locale: document.documentElement.lang,
        colorScheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      }))()`);
      expect(measured.overflow).toBeLessThanOrEqual(1);
      expect(measured.reviewTools).toBe(false); expect(measured.colorScheme).toBe(scheme); expect(measured.locale).toBe(locale);
      if (route.startsWith('dev-session')) { expect(measured.panelFull).toBe(true); expect(measured.topicTabs).toBe(true); }
      if (['settings', 'settings?tab=visibility', 'settings?tab=members'].includes(route)) expect(measured.forms).toBe(0);
      expect(page.takeErrors()).toEqual([]);
    }
    await openLocalized(page, `/projects/${id}/settings`, locale);
    const addLabel = locale === 'zh-CN' ? '新增变量' : 'Add variable';
    await page.eval(`Array.from(document.querySelectorAll('button')).find(node => !node.closest('[hidden]') && node.textContent === ${JSON.stringify(addLabel)}).click()`);
    await settle(page);
    expect(await page.eval<number>('document.documentElement.scrollWidth - innerWidth')).toBeLessThanOrEqual(1);
    expect(await page.eval<string | null>('document.activeElement?.getAttribute("placeholder")')).toBe('DATABASE_URL');
    // 只提交空表单验证字段错误，绝不写入真实项目配置。
    await page.eval('document.querySelector("main form").requestSubmit()'); await settle(page);
    expect(await page.eval<string | null>('document.activeElement?.getAttribute("aria-invalid")')).toBe('true');
    expect(page.takeErrors()).toEqual([]);
  }, 120_000);
});
