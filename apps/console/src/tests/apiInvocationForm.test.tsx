import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { TaskIdSchema } from '@crewstation/contracts';
import { renderApp } from './renderApp';
import { apiInvocationFixture, invocationClick, invocationField, invocationInput, invocationOperation, invocationResponse, invocationRoute, invocationTaskId, refreshInvocationQueries } from './apiInvocationFixture';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });

test('详情表单展示约束和全部字段错误，真实请求按固定会话发送并呈现 HTTP 错误与截断', async () => {
  const f = apiInvocationFixture(); page = await renderApp(invocationRoute); await invocationClick(page, '试调');
  expect(page.text()).toContain('最多 64 项'); expect(page.text()).toContain('64 KiB');
  await invocationInput(page, invocationField('查询参数'), 'invalid'); await invocationInput(page, invocationField('请求头'), '[]');
  await invocationClick(page, '发送请求');
  expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(3); expect(f.calls).toHaveLength(0);
  await invocationInput(page, invocationField('路径参数 id'), 'a / b'); await invocationInput(page, invocationField('查询参数'), '{"tag":["one","two"]}'); await invocationInput(page, invocationField('请求头'), '{"content-type":"application/json"}');
  await act(async () => { invocationField('发送请求体').click(); }); await page.settle();
  await invocationInput(page, invocationField('请求体'), '{"title":"文档"}');
  f.pending.handle = async (input) => Response.json(invocationResponse(input, { result: { status: 422, headers: { 'content-type': 'application/json' }, body: 'partial result', truncated: true, bodyTruncated: true, headersTruncated: false, durationMs: 24 } }));
  await invocationClick(page, '发送请求');
  expect(f.calls).toHaveLength(1); expect(f.calls[0]!.input).toEqual({ expectedTaskId: invocationTaskId, operationId: invocationOperation.id, pathParameters: { id: 'a / b' }, query: { tag: ['one', 'two'] }, headers: { 'content-type': 'application/json' }, body: '{"title":"文档"}' });
  expect(page.text()).toContain('HTTP 422'); expect(page.text()).toContain('容器内实测 24 ms'); expect(page.text()).toContain('已截断：响应正文'); expect(page.text()).toContain('本次响应所属会话');
  expect(invocationField('请求体').value).toBe('{"title":"文档"}');
});

test('失败、收起、取消切操作均保留输入；确认切换只丢弃当前表单', async () => {
  const f = apiInvocationFixture(); page = await renderApp(invocationRoute); await invocationClick(page, '试调');
  await invocationInput(page, invocationField('路径参数 id'), 'draft');
  f.pending.handle = async () => Response.json({ error: 'unavailable', message: '容器响应丢失，请先核对业务状态' }, { status: 503 });
  await invocationClick(page, '发送请求'); expect(page.text()).toContain('容器响应丢失'); expect(invocationField('路径参数 id').value).toBe('draft');
  await invocationClick(page, '收起输入'); await invocationClick(page, '继续编辑试调输入'); expect(invocationField('路径参数 id').value).toBe('draft');
  const next = () => [...document.querySelectorAll('tr')].find((row) => row.textContent?.includes('/ping'))!;
  await invocationClick(page, '试调', next()); expect(page.text()).toContain('丢弃当前操作的输入'); await invocationClick(page, '保留当前输入'); expect(invocationField('路径参数 id').value).toBe('draft');
  await invocationClick(page, '试调', next()); await invocationClick(page, '丢弃当前输入并切换'); expect(document.querySelector('input[aria-invalid]')).toBeNull(); expect(page.text()).toContain('GET／HEAD 不发送请求体');
  expect(f.calls).toHaveLength(1);
});

test('会话替换后不会把旧输入自动发到新会话，失败重读保留，再明确绑定才允许发送', async () => {
  const f = apiInvocationFixture(); page = await renderApp(invocationRoute); await invocationClick(page, '试调'); await invocationInput(page, invocationField('路径参数 id'), 'retained');
  f.state.taskId = TaskIdSchema.parse('01a0bf5d-8f4b-7d55-84d0-6a2289a856b4'); await refreshInvocationQueries(page);
  await invocationClick(page, '发送请求'); expect(f.calls).toHaveLength(0); expect(page.text()).toContain('会话已变化'); expect(invocationField('路径参数 id').value).toBe('retained');
  f.state.sessionFailure = true; await invocationClick(page, '重新检查并绑定当前会话'); expect(page.text()).toContain('没有已确认'); expect(invocationField('路径参数 id').value).toBe('retained');
  f.state.sessionFailure = false; await invocationClick(page, '重新检查并绑定当前会话'); await invocationClick(page, '发送请求'); expect(f.calls[0]!.input.expectedTaskId).toBe(f.state.taskId);
});

test('在途单次发送且离开需确认，迟到结果不会把用户拉回原页面', async () => {
  const f = apiInvocationFixture(); let finish!: (response: Response) => void;
  f.pending.handle = () => new Promise((resolve) => { finish = resolve; });
  page = await renderApp(invocationRoute); await invocationClick(page, '试调'); await invocationInput(page, invocationField('路径参数 id'), 'pending');
  await invocationClick(page, '发送请求'); await invocationClick(page, '发送中…'); expect(f.calls).toHaveLength(1); expect(page.text()).toContain('离开页面不会撤销');
  await page.requestNavigate('/projects'); expect(page.text()).toContain('放弃输入并离开'); await invocationClick(page, '继续编辑'); expect(invocationField('路径参数 id').value).toBe('pending');
  await page.requestNavigate('/projects'); await invocationClick(page, '放弃输入并离开'); expect(page.path()).toBe('/projects');
  await act(async () => { finish(Response.json(invocationResponse(f.calls[0]!.input))); }); await page.settle(); expect(page.path()).toBe('/projects'); expect(page.text()).not.toContain('业务校验失败');
});

test('读取失败、失去授权与错会话响应不会显示成功或清空输入', async () => {
  const f = apiInvocationFixture(); page = await renderApp(invocationRoute); await invocationClick(page, '试调'); await invocationInput(page, invocationField('路径参数 id'), 'preserved');
  f.state.catalogFailure = true; await refreshInvocationQueries(page); await invocationClick(page, '发送请求'); expect(f.calls).toHaveLength(0); expect(page.text()).toContain('目录未确认');
  f.state.catalogFailure = false; f.state.granted = false; await refreshInvocationQueries(page); await invocationClick(page, '发送请求'); expect(f.calls).toHaveLength(0);
  f.state.granted = true; await refreshInvocationQueries(page);
  f.pending.handle = async (input) => Response.json(invocationResponse(input, { taskId: '01a0bf5d-8f4b-7d55-84d0-6a2289a856b4' })); await invocationClick(page, '发送请求');
  expect(page.text()).toContain('响应无法匹配'); expect(page.text()).not.toContain('最近一次试调响应'); expect(invocationField('路径参数 id').value).toBe('preserved');
});

test('测试者深链接回到版本试用；开发者无会话时明确说明且不打开试调表单', async () => {
  const f = apiInvocationFixture(); f.state.role = 'tester'; page = await renderApp(invocationRoute);
  expect([...document.querySelectorAll('button')].some((node) => node.textContent === '试调')).toBe(false); expect(f.calls).toHaveLength(0); expect(page.text()).toContain('Beta');
  expect(f.reads.some((url) => /\/catalog\/|\/dev-session/.test(url))).toBe(false);
  page.unmount(); page = undefined; f.state.role = 'developer'; f.state.malformedSession = true; page = await renderApp(invocationRoute); await invocationClick(page, '试调');
  expect(page.text()).toContain('没有已确认'); expect(document.querySelector('textarea')).toBeNull(); expect(f.calls).toHaveLength(0);
});
