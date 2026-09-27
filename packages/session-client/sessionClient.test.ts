import { expect, test } from 'bun:test';
import type { StoredBusinessExecutionDto, TaskId } from '@crewstation/contracts';
import { createSessionClient } from './sessionClient';

test('可靠执行读取保留句柄并校验结果，事件 cursor 不依赖 Runner 在线', async () => {
  const taskId = '01a0bf5d-8f4b-7001-8458-107366e7de39' as TaskId, urls: string[] = [];
  const snapshot: StoredBusinessExecutionDto = { taskId, receipt: { executionId: 'id/one', incarnation: crypto.randomUUID(), attempt: 1, payloadDigest: 'a'.repeat(64), phase: 'unknown', lastSequence: 0, acknowledgedSequence: 0, outputBytes: 0, result: null }, persistedThrough: 0, acknowledgedThrough: 0, complete: false };
  const fetchImpl = Object.assign(async (url: string | URL | Request) => { urls.push(String(url)); return Response.json(String(url).includes('/events?') ? { items: [] } : snapshot); }, { preconnect: fetch.preconnect });
  const client = createSessionClient('http://session', fetchImpl);
  expect(await client.getBusinessExecution(taskId, 'id/one')).toEqual(snapshot);
  expect(await client.listBusinessExecutionEvents(taskId, 'id/one', 12, 50)).toEqual([]);
  expect(urls).toEqual([`http://session/internal/tasks/${taskId}/executions/id%2Fone`, `http://session/internal/tasks/${taskId}/executions/id%2Fone/events?after=12&limit=50`]);
});

test('Runner 明确拒绝和通信超时保留不同 code，调用者才能区分启动失败与结果未确认', async () => {
  const fetchImpl = Object.assign(async () => Response.json({ error: 'precondition', message: 'PTY unavailable', details: { code: 'pty_unavailable' } }, { status: 412 }), { preconnect: fetch.preconnect });
  const client = createSessionClient('http://session', fetchImpl);
  await expect(client.sendCommand('tsk_0123456789abcdef0123456789abcdef' as TaskId, { id: 'query', type: 'listAgentTerminals' })).rejects.toMatchObject({ kind: 'precondition', details: { code: 'pty_unavailable' } });
});

test('试调和普通 CLI 命令均有传输截止时间，避免服务更新后无限等待', async () => {
  const requests: Array<RequestInit | undefined> = [];
  const fetchImpl = Object.assign(async (_url: string | URL | Request, init?: RequestInit) => { requests.push(init); return Response.json({ payload: {} }); }, { preconnect: fetch.preconnect });
  const client = createSessionClient('http://session', fetchImpl), taskId = 'tsk_0123456789abcdef0123456789abcdef' as TaskId;
  await client.sendCommand(taskId, { id: 'http', type: 'invokeApi', proxy: 'crm', method: 'GET', path: '/items', query: {}, headers: {} });
  await client.sendCommand(taskId, { id: 'cli', type: 'listAgentTerminals' });
  expect(requests[0]).toMatchObject({ keepalive: false, redirect: 'error', signal: expect.any(AbortSignal) });
  // 真实 workspace-status 等待超过 Runner 自身预算，HTTP 这一跳也必须终止等待。
  expect(requests[1]).toMatchObject({ keepalive: false, redirect: 'error', signal: expect.any(AbortSignal) });
});

test('连接和历史读取的网络故障有界，不把超时伪装成空结果', async () => {
  const fetchImpl = Object.assign(async (_url: string | URL | Request, init?: RequestInit) => {
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    throw new DOMException('request timed out', 'TimeoutError');
  }, { preconnect: fetch.preconnect });
  const client = createSessionClient('http://session', fetchImpl), taskId = 'tsk_0123456789abcdef0123456789abcdef' as TaskId;
  await expect(client.connectionStatus(taskId)).rejects.toMatchObject({ name: 'TimeoutError' });
  await expect(client.listEvents(taskId)).rejects.toMatchObject({ name: 'TimeoutError' });
});
