import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { renderApp } from './renderApp';
import { apiInvocationFixture, invocationOperation, invocationRoute, secondInvocationOperation } from './apiInvocationFixture';

const originalFetch = globalThis.fetch, originalSocket = globalThis.WebSocket, originalUrl = window.location.href;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; globalThis.WebSocket = originalSocket; window.location.href = originalUrl; });
const aside = () => document.querySelector('aside[aria-label="操作详情"]')!;
const swaggerFold = () => [...document.querySelectorAll<HTMLDetailsElement>('details')].find((node) => node.querySelector('summary')?.textContent === '内嵌 Swagger')!;

test('放大形态表在前、详情在旁：地址里的操作是选中而不是筛选，点选换行写回地址，取消选中回到说明', async () => {
  apiInvocationFixture(); page = await renderApp(`${invocationRoute}&operation=${secondInvocationOperation.id}`);
  expect(document.querySelectorAll('tr[aria-current="true"]')).toHaveLength(1); expect(document.querySelector('tr[aria-current="true"]')?.textContent).toContain('/ping');
  expect(aside().textContent).toContain('GET /ping'); expect(page.text()).toContain('/items/{id}');
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('tr button')].find((node) => node.textContent === invocationOperation.id)!.click()); await page.settle();
  expect(page.search().operation).toBe(invocationOperation.id); expect(aside().textContent).toContain('POST /items/{id}'); expect(aside().textContent).toContain('保存条目');
  await page.click('取消选中'); expect(page.search().operation).toBeUndefined(); expect(document.querySelector('tr[aria-current="true"]')).toBeNull(); expect(aside().textContent).toContain('在左侧表里点选一个操作');
  // Swagger 折叠段：没带 proxy 进入时收起，试调面板在详情栏而不是表上方。
  expect(swaggerFold().open).toBe(false); expect(aside().textContent).toContain('API 试调');
});

test('试调从表里打开时选中该行并在详情栏出现表单；带 proxy 进入时 Swagger 段展开', async () => {
  apiInvocationFixture(); page = await renderApp(`${invocationRoute}&proxy=${invocationOperation.proxyId}`);
  expect(swaggerFold().open).toBe(true);
  await page.click('试调');
  expect(document.querySelector('tr[aria-current="true"]')?.textContent).toContain('/items/{id}'); expect(aside().querySelector('input[name], textarea, input')).not.toBeNull();
  expect(page.search().operation).toBe(invocationOperation.id);
});
