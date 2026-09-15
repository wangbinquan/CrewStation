import './domSetup';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { messages as zh } from '../app/i18n/zh-CN';
import { messages as en } from '../app/i18n/en-US';
import { LocaleSwitch } from '../app/layout/LocaleSwitch';
import { I18nProvider } from '../shared/lib/I18nProvider';
import type { Locale } from '../shared/lib/i18n';

let originalLanguage: string | null;
let dispose: (() => void) | undefined;
beforeEach(() => {
  originalLanguage = document.documentElement.getAttribute('lang');
  document.documentElement.lang = 'zh-CN';
});
afterEach(() => {
  dispose?.(); dispose = undefined;
  if (originalLanguage === null) document.documentElement.removeAttribute('lang');
  else document.documentElement.lang = originalLanguage;
});

async function mountLocale(initialLocale?: Locale) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  dispose = () => { act(() => root.unmount()); host.remove(); };
  await act(async () => root.render(
    <I18nProvider catalog={{ 'zh-CN': zh, 'en-US': en }} initialLocale={initialLocale}>
      <LocaleSwitch /><input aria-label="未提交草稿" defaultValue="保留这份输入" />
    </I18nProvider>,
  ));
  const select = host.querySelector('select')!;
  return { host, select, change: async (locale: Locale) => {
    await act(async () => { select.value = locale; select.dispatchEvent(new Event('change', { bubbles: true })); });
  } };
}

test('真实语言控件同步文案与文档语言，往返切换保留输入和焦点', async () => {
  const page = await mountLocale();
  const input = page.host.querySelector('input')!;
  input.focus();
  expect(page.select.getAttribute('aria-label')).toBe('界面语言');
  expect(document.documentElement.lang).toBe('zh-CN');
  await page.change('en-US');
  expect(page.select.getAttribute('aria-label')).toBe('Language');
  // 实机英文已加载，html 却仍是 zh-CN，辅助阅读不能据此选择正确语言。
  expect(document.documentElement.lang).toBe('en-US');
  expect(page.host.querySelector('input') === input).toBe(true);
  expect(input.value).toBe('保留这份输入');
  expect(document.activeElement === input).toBe(true);
  await page.change('zh-CN');
  expect(page.select.getAttribute('aria-label')).toBe('界面语言');
  expect(document.documentElement.lang).toBe('zh-CN');
  expect(input.value).toBe('保留这份输入');
  expect(document.activeElement === input).toBe(true);
});

test('初始英文文案使用英文声明，卸载后恢复宿主声明', async () => {
  const page = await mountLocale('en-US');
  expect(page.select.getAttribute('aria-label')).toBe('Language');
  expect(document.documentElement.lang).toBe('en-US');
  dispose?.(); dispose = undefined;
  expect(document.documentElement.lang).toBe('zh-CN');
});
