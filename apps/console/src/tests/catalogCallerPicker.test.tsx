import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { renderApp } from './renderApp';
import { adminDirectoryFixture } from './adminDirectoryFixture';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });
async function typeSearch(value: string) {
  const input = document.querySelector<HTMLInputElement>('input[aria-label="搜索调用方"]')!;
  await act(async () => { input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true })); });
  await page!.settle();
}
async function search(value: string) { await typeSearch(value); await page!.click('查询调用方'); }

test('调用方目录分页搜索，选中的页外项目独立读取，翻页与搜索不改变当前服务', async () => {
  const f = adminDirectoryFixture(), selected = f.projects[44]!.project; page = await renderApp(`/admin/capabilities?tab=api&projectId=${selected.id}`);
  expect(f.calls.some((c) => c.url.pathname === '/v1/projects')).toBe(false);
  expect(f.calls.find((c) => c.url.pathname === '/v1/projects/page')!.url.searchParams.get('limit')).toBe('20');
  expect(f.calls.find((c) => c.url.pathname === '/v1/catalog/operations')!.url.searchParams.get('serviceId')).toBe(selected.serviceId!);
  const selector = () => document.querySelector<HTMLSelectElement>('select[aria-label="调用方项目"]')!;
  expect(selector().value).toBe(selected.id); expect(selector().selectedOptions[0]!.textContent).toContain(selected.name); expect(selector().options.length).toBe(22);
  await page.click('下一批调用方'); expect(page.search().cursor).toBe('20'); expect(selector().value).toBe(selected.id);
  await search('managed-2'); expect(page.search()).toMatchObject({ q: 'managed-2', projectId: selected.id }); expect(page.search().cursor).toBeUndefined();
  expect(selector().value).toBe(selected.id); expect(f.calls.filter((c) => c.url.pathname === '/v1/catalog/operations').every((c) => c.url.searchParams.get('serviceId') === selected.serviceId)).toBe(true);
  await page.back(); expect(page.search().cursor).toBe('20'); expect(f.writes()).toHaveLength(0);
});

test('目录故障不混淆已确认调用方，资料读取失败或未知项目不会退回全局策略', async () => {
  const f = adminDirectoryFixture(), selected = f.projects[10]!.project; f.state.projectError = true;
  page = await renderApp(`/admin/capabilities?tab=api&projectId=${selected.id}`);
  expect(page.text()).toContain('管理项目目录离线'); expect(page.text()).toContain(selected.serviceId!);
  expect(f.calls.some((c) => c.url.pathname === '/v1/catalog/operations' && c.url.searchParams.get('serviceId') === selected.serviceId)).toBe(true);
  f.state.detailError = true; const before = f.calls.filter((c) => c.url.pathname === '/v1/catalog/operations').length;
  await page.click('重新读取项目目录'); expect(page.text()).toContain('调用方资料离线'); expect(f.calls.filter((c) => c.url.pathname === '/v1/catalog/operations')).toHaveLength(before);
  f.state.detailError = false; f.state.projectError = false; await page.click('重新读取项目目录'); expect(page.text()).toContain(selected.serviceId!);
  await page.navigate(`/admin/capabilities?tab=api&projectId=01a0bf5d-8f4b-7927-8d04-a341edee681a`); expect(page.text()).toContain('未找到指定项目');
  expect(f.calls.filter((c) => c.url.pathname === '/v1/catalog/operations').every((c) => c.url.searchParams.has('serviceId'))).toBe(true);
  await page.click('清除调用方'); expect(page.search().projectId).toBeUndefined();
  expect(f.calls.filter((c) => c.url.pathname === '/v1/catalog/operations').at(-1)!.url.searchParams.has('serviceId')).toBe(false); expect(f.writes()).toHaveLength(0);
});

test('重读与翻页保留未应用的搜索，清空搜索在原条件为空时也清掉输入', async () => {
  const f = adminDirectoryFixture(); page = await renderApp('/admin/capabilities?tab=api');
  const input = () => document.querySelector<HTMLInputElement>('input[aria-label="搜索调用方"]')!;
  await typeSearch('尚未查询'); await page.click('重新读取项目目录'); expect(input().value).toBe('尚未查询');
  await page.click('下一批调用方'); expect(input().value).toBe('尚未查询'); expect(page.search().q ?? '').toBe('');
  await page.click('清除搜索'); expect(input().value).toBe(''); expect(page.search().cursor).toBeUndefined();
  await typeSearch('再次输入'); await page.click('清除搜索'); expect(input().value).toBe('');
  await search('无匹配调用方'); expect(page.text()).toContain('没有匹配的项目');
  await page.click('清除搜索'); expect(input().value).toBe(''); expect(document.querySelector<HTMLSelectElement>('select[aria-label="调用方项目"]')!.options.length).toBe(21);
  expect(f.writes()).toHaveLength(0);
});
