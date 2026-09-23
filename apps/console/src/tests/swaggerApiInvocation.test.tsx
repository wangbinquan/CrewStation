import './domSetup';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act } from 'react';
import { TaskIdSchema } from '@crewstation/contracts';
import { renderApp } from './renderApp';
import { apiInvocationFixture, invocationClick, invocationField, invocationInput, invocationOperation, invocationResponse, invocationRoute, invocationTaskId, refreshInvocationQueries } from './apiInvocationFixture';

const originalFetch = globalThis.fetch, originalSocket = globalThis.WebSocket;
const originalUrl = window.location.href;
const locationFields = ['hash', 'host', 'hostname', 'href', 'origin', 'pathname', 'port', 'protocol', 'search'];
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
beforeEach(() => {
  window.location.href = 'http://console.fixture.invalid/';
  // 浏览器 Location 字段可枚举；happy-dom 把它们放在不可枚举的原型上，url-parse 会丢掉 pathname。
  for (const key of locationFields) Object.defineProperty(window.location, key, { ...Object.getOwnPropertyDescriptor(Object.getPrototypeOf(window.location), key), configurable: true, enumerable: true });
});
afterEach(() => {
  page?.unmount(); page = undefined; globalThis.fetch = originalFetch; globalThis.WebSocket = originalSocket;
  for (const key of locationFields) Reflect.deleteProperty(window.location, key);
  window.location.href = originalUrl;
});

async function until(selector: string): Promise<HTMLElement> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const node = document.querySelector<HTMLElement>(selector);
    if (node) return node;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
  }
  throw new Error(`没有出现 ${selector}: ${document.body.textContent}`);
}
async function expand(method = 'post') {
  const summary = await until(`.opblock-${method} .opblock-summary-control`);
  await act(async () => { summary.click(); });
  await until(`.opblock-${method} .try-out__btn`);
  await invocationClick(page!, 'Try it out', document.querySelector(`.opblock-${method}`)!);
}

test('实际 Swagger 的 Try it out 与 Execute 走固定会话 HTTP，原服务没有浏览器请求', async () => {
  const f = apiInvocationFixture(); page = await renderApp(`${invocationRoute}&proxy=${invocationOperation.proxyId}`); await expand();
  const block = document.querySelector('.opblock-post')!;
  const id = await until('.opblock-post input[placeholder="id"]');
  await invocationInput(page, id as HTMLInputElement, 'a / b');
  await invocationInput(page, block.querySelector<HTMLInputElement>('input[placeholder="search"]')!, '中文');
  await invocationInput(page, block.querySelector<HTMLTextAreaElement>('textarea')!, '{"title":"保留正文"}');
  await invocationClick(page, 'Execute', block);
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0]!.input).toMatchObject({ expectedTaskId: invocationTaskId, operationId: invocationOperation.id, pathParameters: { id: 'a / b' }, query: { search: '中文' }, body: '{"title":"保留正文"}' });
  expect(f.reads.some((url) => url.startsWith('http://api.fixture.invalid'))).toBe(false);
  expect(page.text()).toContain('HTTP 422'); expect(page.text()).toContain('容器内实测 17 ms'); expect(block.textContent).toContain('业务校验失败');
  expect(block.textContent).toContain(`本次响应所属会话 ${invocationTaskId}`);
  expect(block.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('{"title":"保留正文"}');
});

test('Swagger 输入先绑定会话；会话变化或读取失败后不发送，明确重绑才可继续', async () => {
  const f = apiInvocationFixture(); page = await renderApp(`${invocationRoute}&proxy=${invocationOperation.proxyId}`); await expand();
  await invocationInput(page, document.querySelector<HTMLInputElement>('.opblock-post input[placeholder="id"]')!, 'old-draft');
  f.state.taskId = TaskIdSchema.parse('01a0bf5d-8f4b-7d55-84d0-6a2289a856b4'); await refreshInvocationQueries(page);
  // RFC-020：目录住在开发工作区里，工作区按任务重建——换了会话就没有旧表单，旧输入不可能发到新会话；重新展开的表单先绑定新会话再发送。
  expect(f.calls).toHaveLength(0); expect(document.querySelector<HTMLInputElement>('.opblock-post input[placeholder="id"]')?.value ?? '').not.toBe('old-draft');
  await expand(); const block = document.querySelector('.opblock-post')!;
  await invocationInput(page, block.querySelector<HTMLInputElement>('input[placeholder="id"]')!, 'new-draft');
  await invocationClick(page, '重新检查并绑定当前会话'); await invocationClick(page, 'Execute', block); expect(f.calls).toHaveLength(1); expect(f.calls[0]!.input.expectedTaskId).toBe(f.state.taskId);
});

test('Swagger 一个操作发送成功不清除另一操作或详情输入的离开保护', async () => {
  const f = apiInvocationFixture(); page = await renderApp(`${invocationRoute}&proxy=${invocationOperation.proxyId}`); await expand();
  const post = document.querySelector('.opblock-post')!;
  await invocationInput(page, post.querySelector<HTMLInputElement>('input[placeholder="id"]')!, 'post-draft');
  await expand('get'); const get = document.querySelector('.opblock-get')!;
  await invocationInput(page, get.querySelector<HTMLInputElement>('input[placeholder="value"]')!, 'get-draft');
  await invocationClick(page, '试调'); await invocationInput(page, invocationField('路径参数 id'), 'detail-draft');
  await invocationClick(page, 'Execute', post); expect(f.calls).toHaveLength(1);
  await page.requestNavigate('/projects'); await invocationClick(page, '继续编辑'); expect(get.querySelector<HTMLInputElement>('input')!.value).toBe('get-draft'); expect(invocationField('路径参数 id').value).toBe('detail-draft');
  await invocationClick(page, '发送请求'); expect(f.calls).toHaveLength(2);
  await page.requestNavigate('/projects'); await invocationClick(page, '继续编辑');
  await invocationClick(page, 'Execute', get); expect(f.calls).toHaveLength(3);
  await page.navigate('/projects'); expect(page.path()).toBe('/projects');
});

test('切换代理或重新加载文档前确认，取消保留；文档更新和读取失败不会卸载草稿', async () => {
  const f = apiInvocationFixture(); page = await renderApp(`${invocationRoute}&proxy=${invocationOperation.proxyId}`); await expand();
  const field = () => document.querySelector<HTMLInputElement>('.opblock-post input[placeholder="id"]')!;
  await invocationInput(page, field(), 'kept');
  const picker = [...document.querySelectorAll('select')].find((node) => node.options[0]?.text === '选择一个代理')!;
  await act(async () => { picker.value = '01a0bf5d-8f4b-744d-8cd0-5317e6c8590f'; picker.dispatchEvent(new Event('change', { bubbles: true })); }); await page.settle();
  expect(page.text()).toContain('丢弃 crm 的 Swagger 输入'); await invocationClick(page, '保留当前输入'); expect(picker.value).toBe(invocationOperation.proxyId); expect(field().value).toBe('kept');
  f.state.documentFailure = true; await page.reread(); await invocationClick(page, 'Execute', document.querySelector('.opblock-post')!);
  expect(f.calls).toHaveLength(0); expect(field().value).toBe('kept'); expect(page.text()).toContain('文档读取失败');
  f.state.documentFailure = false; f.state.documentVersion = '2.0.0'; await page.reread();
  expect(page.text()).toContain('文档已更新'); expect(field().value).toBe('kept'); await invocationClick(page, 'Execute', document.querySelector('.opblock-post')!); expect(f.calls).toHaveLength(0);
  await invocationClick(page, '重新加载文档'); await invocationClick(page, '保留当前输入'); expect(field().value).toBe('kept');
  await invocationClick(page, '重新加载文档'); await invocationClick(page, '丢弃当前输入并切换'); await expand(); expect(field().value).toBe(''); expect(page.text()).toContain('2.0.0');
});

test('Swagger 在途修改保留新输入，另一个 Execute 不会并发发送，截断与来源在当前操作明确展示', async () => {
  const f = apiInvocationFixture(); let finish!: (value: Response) => void;
  f.pending.handle = () => new Promise((resolve) => { finish = resolve; });
  page = await renderApp(`${invocationRoute}&proxy=${invocationOperation.proxyId}`); await expand(); const post = document.querySelector('.opblock-post')!;
  await invocationInput(page, post.querySelector<HTMLInputElement>('input[placeholder="id"]')!, 'sent-value'); await expand('get'); const get = document.querySelector('.opblock-get')!;
  await invocationClick(page, 'Execute', post); await invocationClick(page, 'Execute', get); await until('.opblock-get .live-responses-table'); expect(f.calls).toHaveLength(1); expect(page.text()).toContain('已有试调请求');
  await invocationInput(page, post.querySelector<HTMLInputElement>('input[placeholder="id"]')!, 'new-value');
  const response = invocationResponse(f.calls[0]!.input); response.result.truncated = true; response.result.headersTruncated = true;
  await act(async () => { finish(Response.json(response)); }); await page.settle();
  expect([...document.querySelectorAll('section')].find((section) => section.querySelector('h2')?.textContent === 'API 试调')!.textContent).not.toContain('已有试调请求');
  expect(post.textContent).toContain('已截断：响应头'); expect(post.textContent).toContain(invocationTaskId); expect(f.calls[0]!.input.pathParameters.id).toBe('sent-value');
  await page.requestNavigate('/projects'); await invocationClick(page, '继续编辑'); expect(post.querySelector<HTMLInputElement>('input[placeholder="id"]')!.value).toBe('new-value');
});

test('测试者不挂载开发工具；开发者无会话时不能执行实际 Swagger', async () => {
  const f = apiInvocationFixture(); f.state.role = 'tester'; page = await renderApp(`${invocationRoute}&proxy=${invocationOperation.proxyId}`);
  expect(page.text()).toContain('Beta');
  expect(document.querySelector('.swagger-ui') === null).toBe(true); expect(f.calls).toHaveLength(0);
  expect(f.reads.some((url) => /\/catalog\/|\/openapi|\/dev-session/.test(url))).toBe(false);
  page.unmount(); page = undefined; f.state.role = 'developer'; f.state.sessionFailure = true;
  page = await renderApp(`${invocationRoute}&proxy=${invocationOperation.proxyId}`); await expand();
  expect(page.text()).toContain('没有已确认'); expect(document.querySelector('.opblock-post .execute')).toBeNull(); expect(f.calls).toHaveLength(0);
});

test('当前身份刷新后调整 Swagger 写入口，恢复开发权限时保留此前输入', async () => {
  const f = apiInvocationFixture(); f.state.role = 'tester'; page = await renderApp(`${invocationRoute}&proxy=${invocationOperation.proxyId}`);
  expect(page.text()).toContain('Beta'); expect(document.querySelector('.try-out__btn') === null).toBe(true);
  f.state.role = 'developer'; await refreshInvocationQueries(page); await page.navigate(`${invocationRoute}&proxy=${invocationOperation.proxyId}`); await expand();
  await invocationInput(page, document.querySelector<HTMLInputElement>('.opblock-post input[placeholder="id"]')!, 'role-draft');
  f.state.role = 'tester'; await refreshInvocationQueries(page); expect(page.text()).toContain('需要开发者角色');
  expect(document.querySelector('.opblock-post')?.closest('[hidden]') !== null).toBe(true);
  expect(document.querySelector('.opblock-post .execute') === null).toBe(true);
  f.state.role = 'developer'; await refreshInvocationQueries(page); await until('.opblock-post .execute'); expect(document.querySelector<HTMLInputElement>('.opblock-post input[placeholder="id"]')!.value).toBe('role-draft'); expect(f.calls).toHaveLength(0);
});
