import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { renderApp } from './renderApp';
import { apiInvocationFixture, invocationOperation, invocationRoute, secondInvocationOperation } from './apiInvocationFixture';

const originalFetch = globalThis.fetch, originalSocket = globalThis.WebSocket, originalUrl = window.location.href;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; globalThis.WebSocket = originalSocket; window.location.href = originalUrl; });
const aside = () => document.querySelector('aside[aria-label="操作详情"]')!;
const swaggerCard = () => [...document.querySelectorAll('section > header > h2')].find((node) => node.textContent === '内嵌 Swagger')?.closest('section');

test('放大形态列表在前、详情在旁：地址里的操作是选中而不是筛选，点路径换行写回地址，取消选中回到说明', async () => {
  apiInvocationFixture(); page = await renderApp(`${invocationRoute}&operation=${secondInvocationOperation.id}`);
  expect(document.querySelectorAll('li[aria-current="true"]')).toHaveLength(1); expect(document.querySelector('li[aria-current="true"]')?.textContent).toContain('/ping');
  expect(aside().textContent).toContain('GET /ping'); expect(page.text()).toContain('/items/{id}');
  // 2026-09-23：列表与详情栏都不出现操作 ID；详情栏给的是代码里写的调用地址。
  expect(page.text()).not.toContain(invocationOperation.id); expect(aside().textContent).toContain('${CS_INTERNAL_API_BASE}');
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('li button[title="查看详情"]')].find((node) => node.textContent?.includes('/items/{id}'))!.click()); await page.settle();
  expect(page.search().operation).toBe(invocationOperation.id); expect(aside().textContent).toContain('POST /items/{id}'); expect(aside().textContent).toContain('保存条目');
  await page.click('取消选中'); expect(page.search().operation).toBeUndefined(); expect(document.querySelector('li[aria-current="true"]')).toBeNull(); expect(aside().textContent).toContain('在左侧列表里点一个接口的路径');
  // Swagger 段直接展示（2026-09-23 作者裁定，此前没带 proxy 进入时收起）；试调面板在详情栏而不是表上方。
  expect(swaggerCard()?.closest('details') === null).toBe(true); expect(swaggerCard()!.querySelector('select')!.value).toBe(''); expect(aside().textContent).toContain('API 试调');
});

test('试调从表里打开时选中该行并在详情栏出现表单；带 proxy 进入时 Swagger 段选好该代理', async () => {
  apiInvocationFixture(); page = await renderApp(`${invocationRoute}&proxy=${invocationOperation.proxyId}`);
  expect(swaggerCard()?.closest('details') === null).toBe(true); expect(swaggerCard()!.querySelector('select')!.value).toBe(invocationOperation.proxyId);
  await page.click('试调');
  expect(document.querySelector('li[aria-current="true"]')?.textContent).toContain('/items/{id}'); expect(aside().querySelector('input[name], textarea, input')).not.toBeNull();
  expect(page.search().operation).toBe(invocationOperation.id);
});
