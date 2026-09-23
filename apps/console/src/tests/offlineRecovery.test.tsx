import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { onlineManager } from '@tanstack/react-query';
import { renderApp } from './renderApp';
import { summaryFixture } from './projectSummaryFixture';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; onlineManager.setOnline(true); globalThis.fetch = originalFetch; });
async function connection(online: boolean) {
  await act(async () => window.dispatchEvent(new Event(online ? 'online' : 'offline')));
  await page!.settle();
}

test('断网时解释读取暂停，保留搜索草稿与焦点，联网后读取真实新结果', async () => {
  const f = summaryFixture(); page = await renderApp('/projects');
  const field = document.querySelector<HTMLInputElement>('[aria-label="搜索名称或标识"]')!;
  await act(async () => {
    field.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, '尚未查询的草稿');
    field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
  }); await page.settle();
  const before = f.calls.length; await connection(false);
  // 实机 Offline 后刷新会暂停，原页面却只显示上次的空态，没有解释暂停原因。
  expect(page.text()).toContain('当前离线，读取已暂停'); expect(page.text()).toContain('已有数据可能过期');
  expect(document.activeElement).toBe(field); expect(field.value).toBe('尚未查询的草稿');
  await page.reread(); expect(f.calls).toHaveLength(before); expect(page.text()).toContain('数字助手 1');
  f.item.project.name = '联网后读取的新项目'; await connection(true);
  expect(page.text()).toContain('联网后读取的新项目'); expect(page.text()).not.toContain('当前离线');
  expect(field.value).toBe('尚未查询的草稿'); expect(page.search().q).toBe(''); expect(f.writes).toEqual([]);
});

test.each([['/projects', '数字助手 1'], ['/admin/projects', '此范围没有项目']])('初次进入 %s 时读取暂停有原因，恢复网络不需要重载页面', async (path, expected) => {
  const f = summaryFixture(); onlineManager.setOnline(false); page = await renderApp(path);
  expect(page.text()).toContain('当前离线，读取已暂停'); expect(f.calls).toHaveLength(0);
  expect(page.text()).not.toContain('尚无项目');
  await connection(true); expect(f.calls.length).toBeGreaterThan(0); expect(page.text()).not.toContain('当前离线');
  expect(f.calls.some((url) => url.startsWith(path === '/projects' ? '/v1/workbench/project-summaries' : '/v1/projects'))).toBe(true);
  expect(page.text()).toContain(expected); expect(f.writes).toEqual([]);
});
