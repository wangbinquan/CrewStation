import { expect, test } from 'bun:test';
import type { ApiOperationDto, TaskId } from '@crewstation/contracts';
import { API_INVOCATION_BODY_BYTES, ApiInvocationRequestSchema } from '@crewstation/contracts';
import { forbidden } from '@crewstation/kernel';
import { apiInvocationUseCase } from '../application/apiInvocation';
import { workspaceActor, workspaceFixture, workspaceProject, workspaceService, workspaceTask } from './workspaceFixture';

export const invocationOperation: ApiOperationDto = { id: '01a0bf5d-8f4b-7b54-886c-7917f8da8165', proxyId: '01a0bf5d-8f4b-7048-89ae-74b8b9667da7', proxy: 'crm', method: 'POST', path: '/items/{id}', openPolicy: 'default', granted: true };
export const invocationInput = { expectedTaskId: workspaceTask, operationId: invocationOperation.id, pathParameters: { id: '用户 / 1' }, query: { label: ['one', 'two'] }, headers: { 'content-type': 'application/json' }, body: '{"message":"hello"}' };
export const invocationResult = { status: 422, headers: { 'content-type': 'application/json' }, body: '{"error":"invalid"}', truncated: false, bodyTruncated: false, headersTruncated: false, durationMs: 27 };

function fixture() {
  const f = workspaceFixture();
  f.state.result = invocationResult;
  f.deps.apiCatalog.listOperations = async (actor, serviceId) => { expect(actor).toEqual(workspaceActor); expect(serviceId).toBe(workspaceService); return [invocationOperation]; };
  return { ...f, invoke: () => apiInvocationUseCase(f.deps)(workspaceActor, workspaceProject, invocationInput) };
}

test('试调使用当前目录、当前服务和固定会话；HTTP 错误也返回真实响应，不执行 shell', async () => {
  const f = fixture(); const actions: string[] = [];
  f.deps.authorizer.authorize = async (_actor, projectId, action) => { expect(projectId).toBe(workspaceProject); actions.push(action); };
  expect(await f.invoke()).toEqual({ taskId: workspaceTask, operationId: invocationOperation.id, result: invocationResult });
  expect(actions).toEqual(['develop']);
  expect(f.commands).toHaveLength(1);
  expect(f.commands[0]).toMatchObject({ type: 'invokeApi', proxy: 'crm', method: 'POST', path: '/items/%E7%94%A8%E6%88%B7%20%2F%201', body: invocationInput.body, query: invocationInput.query });
  expect(f.commands[0]).not.toHaveProperty('expectedTaskId');
});

test('拒绝、断线、目录撤下或授权变化时不发出任何请求', async () => {
  const f = fixture();
  f.deps.authorizer.authorize = async () => { throw forbidden(); };
  await expect(f.invoke()).rejects.toMatchObject({ kind: 'forbidden' });
  f.deps.authorizer.authorize = async () => {};
  f.state.connected = false;
  await expect(f.invoke()).rejects.toMatchObject({ kind: 'precondition' });
  f.state.connected = true; f.state.missing = true;
  await expect(f.invoke()).rejects.toMatchObject({ kind: 'not_found' });
  f.state.missing = false;
  f.deps.apiCatalog.listOperations = async () => [];
  await expect(f.invoke()).rejects.toMatchObject({ kind: 'precondition' });
  f.deps.apiCatalog.listOperations = async () => [{ ...invocationOperation, granted: false }];
  await expect(f.invoke()).rejects.toMatchObject({ kind: 'forbidden' });
  expect(f.commands).toHaveLength(0);
});

test('会话在输入后或目录查询期间被替换均不转向新容器；服务身份不匹配也拒绝', async () => {
  const f = fixture();
  await expect(apiInvocationUseCase(f.deps)(workspaceActor, workspaceProject, { ...invocationInput, expectedTaskId: '01a0bf5d-8f4b-7ad2-8eeb-8f56308fb856' as TaskId })).rejects.toMatchObject({ kind: 'conflict' });
  f.deps.apiCatalog.listOperations = async () => { f.state.missing = true; return [invocationOperation]; };
  await expect(f.invoke()).rejects.toMatchObject({ kind: 'conflict' });
  f.state.missing = false;
  f.deps.services.resolveServiceOfProject = async () => undefined;
  await expect(f.invoke()).rejects.toMatchObject({ kind: 'conflict' });
  expect(f.commands).toHaveLength(0);
});

test('缺失／多余路径参数、路径归一化和 GET 请求体不能悄悄变成另一条请求', async () => {
  const f = fixture(); const invoke = apiInvocationUseCase(f.deps);
  const parameters: Array<Record<string, string>> = [{}, { id: '1', extra: '2' }, { id: '..' }, { id: '' }];
  for (const pathParameters of parameters) await expect(invoke(workspaceActor, workspaceProject, { ...invocationInput, pathParameters })).rejects.toMatchObject({ kind: 'validation' });
  f.deps.apiCatalog.listOperations = async () => [{ ...invocationOperation, method: 'GET' }];
  await expect(f.invoke()).rejects.toMatchObject({ kind: 'validation' });
  expect(f.commands).toHaveLength(0);
});

test('乱码回执与传输错误保留未知；一次失败不自动重发', async () => {
  const f = fixture(); f.state.result = {};
  await expect(f.invoke()).rejects.toMatchObject({ kind: 'unavailable', message: expect.stringContaining('可能已执行') });
  expect(f.commands).toHaveLength(1);
  let sent = 0;
  f.deps.runner.sendCommand = async () => { sent++; throw new Error('offline'); };
  await expect(f.invoke()).rejects.toMatchObject({ kind: 'unavailable', message: expect.stringContaining('可能已执行') });
  expect(sent).toBe(1);
});

test('结构化输入严格拒绝任意 URL、超大 UTF-8 请求体与非法请求头', () => {
  expect(ApiInvocationRequestSchema.safeParse({ ...invocationInput, url: 'https://elsewhere.invalid' }).success).toBe(false);
  expect(ApiInvocationRequestSchema.safeParse({ ...invocationInput, body: 'a'.repeat(API_INVOCATION_BODY_BYTES) }).success).toBe(true);
  expect(ApiInvocationRequestSchema.safeParse({ ...invocationInput, body: '中'.repeat(22_000) }).success).toBe(false);
  expect(ApiInvocationRequestSchema.safeParse({ ...invocationInput, headers: { 'x-test': 'a\r\nb' } }).success).toBe(false);
  expect(ApiInvocationRequestSchema.safeParse({ ...invocationInput, query: { repeated: Array(17).fill('x') } }).success).toBe(false);
});
