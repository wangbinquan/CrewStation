import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { adminAuthenticationFixture, provider } from './adminAuthenticationFixture';
import { setIdentityField as field, clickIdentitySelector } from './identityUiHelpers';
import { renderApp } from './renderApp';
import { renderElement } from './renderElement';
import { CopyButton } from '../shared/ui/clipboard/CopyButton';
import { ChoiceField } from '../shared/ui/selection/ChoiceField';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
let element: Awaited<ReturnType<typeof renderElement>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; element?.unmount(); element = undefined; globalThis.fetch = originalFetch; });

test('HTTP 200 的 ok=false 是失败；每次重试先清除旧成功，网络错误原文可见', async () => {
  const f = adminAuthenticationFixture(); page = await renderApp('/admin/authentication');
  expect(document.querySelector('[aria-live="polite"]')).toBeNull(); await page.click('测试连接');
  expect(document.querySelector('[aria-live="polite"] .success')?.textContent).toBe('可登录');
  f.state.probeOk = false; await page.click('测试连接'); expect(document.querySelector('[aria-live="polite"] .success')).toBeNull();
  const base = globalThis.fetch; globalThis.fetch = (async (input, init) => String(input).endsWith('/test')
    ? Response.json({ error: 'unavailable', message: '提供方连接超时' }, { status: 503 }) : base(input, init)) as typeof fetch;
  await page.click('测试连接'); expect(page.text()).toContain('提供方连接超时'); expect(page.text()).toContain('HTTP 503'); expect(page.text()).not.toContain('https://idp.corp.example/authorize');
});

test('手工端点、缺失端点、发现失败原因及未检查的 JWKS 分别展示', async () => {
  adminAuthenticationFixture(); const base = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const response = await base(input, init);
    if (!String(input).endsWith('/test')) return response;
    const result = await response.json();
    return Response.json({ ...result, ok: false, discovery: { ok: false, error: 'discovery returned 404' }, jwksReachable: undefined, scopesSupported: [], endpoints: { ...result.endpoints, tokenEndpoint: null, authorizationEndpoint: { url: 'https://manual.example/authorize?client=full', source: 'manual' } } });
  }) as typeof fetch;
  page = await renderApp('/admin/authentication'); await page.click('测试连接');
  expect(page.text()).toContain('discovery returned 404'); expect(page.text()).toContain('手工配置'); expect(page.text()).toContain('未解析'); expect(page.text()).toContain('JWKS · 尚未测试');
  expect(page.text()).toContain('https://manual.example/authorize?client=full'); expect(page.text()).toContain('未返回');
});

test('提供方并发探针独立绑定；保存后旧请求迟到也不能覆盖新诊断', async () => {
  const first = provider(), second = provider({ id: `01a0bf5d-8f4b-7fe9-8ac6-e1d50c9fc811` as ReturnType<typeof provider>['id'], slug: 'other-sso', displayName: '第二身份' });
  adminAuthenticationFixture({ providers: [first, second] }); const base = globalThis.fetch;
  const pending: Array<{ id: string; release: () => void }> = [];
  globalThis.fetch = (async (input, init) => {
    const response = await base(input, init);
    if (String(input).endsWith('/test')) return new Promise<Response>((resolve) => pending.push({ id: String(input), release: () => resolve(response) }));
    return response;
  }) as typeof fetch;
  page = await renderApp('/admin/authentication'); await page.click('测试连接'); await page.click('测试连接');
  expect(pending).toHaveLength(2); expect(pending[0]?.id).toContain(first.id); expect(pending[1]?.id).toContain(second.id);
  await act(async () => pending[1]!.release()); await page.settle();
  expect(document.querySelectorAll('[aria-live="polite"] .success')).toHaveLength(1);
  await clickIdentitySelector(`#provider-${first.id}`); await field('显示名', '更新配置'); await page.click('保存修改');
  expect(page.text()).toContain('配置已更改'); await page.click('测试连接'); expect(pending).toHaveLength(3);
  await act(async () => pending[2]!.release()); await page.settle();
  await act(async () => pending[0]!.release()); await page.settle();
  expect(document.querySelectorAll('[aria-live="polite"] .success')).toHaveLength(2); expect(page.text()).not.toContain('配置已更改');
});

test('提供方目录错误重试恢复；已完成诊断在配置更新后标为过期', async () => {
  adminAuthenticationFixture(); const base = globalThis.fetch; let fail = true;
  globalThis.fetch = (async (input, init) => fail && String(input).endsWith('/providers') ? Response.json({ error: 'unavailable', message: '目录暂不可用' }, { status: 503 }) : base(input, init)) as typeof fetch;
  page = await renderApp('/admin/authentication'); expect(page.text()).toContain('目录暂不可用'); fail = false; await page.click('重新加载');
  await page.click('测试连接'); await page.click('编辑'); await field('显示名', '新配置'); await page.click('保存修改');
  expect(page.text()).toContain('这份结果对应旧配置'); expect(document.querySelector('[aria-live="polite"] .success')).toBeNull();
});

test('通用复制控件成功回执与失败原地提示，原生选择控件保留标签、描述和选中状态', async () => {
  const clipboard = navigator.clipboard, writes: string[] = []; let fail = false;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { if (fail) throw new Error('clipboard denied'); writes.push(value); } } });
  try {
    element = await renderElement(<><CopyButton value="https://idp.example/full/path?query=1" /><ChoiceField type="radio" name="choice" checked label="选择角色" description="角色说明" readOnly /></>, {});
    await element.click('复制'); expect(writes).toEqual(['https://idp.example/full/path?query=1']); expect(element.text()).toContain('已复制');
    const input = element.host.querySelector('input')!; expect(input.type).toBe('radio'); expect(input.checked).toBe(true); expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBe('角色说明');
    fail = true; await element.click('已复制'); expect(element.text()).toContain('复制失败');
  } finally { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard }); }
});
