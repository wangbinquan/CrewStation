import { expect, test } from 'bun:test';
import type { TaskId } from '@crewstation/contracts';
import { createSessionClient } from './sessionClient';

test('Runner 明确拒绝和通信超时保留不同 code，调用者才能区分启动失败与结果未确认', async () => {
  const fetchImpl = Object.assign(async () => Response.json({ error: 'precondition', message: 'PTY unavailable', details: { code: 'pty_unavailable' } }, { status: 412 }), { preconnect: fetch.preconnect });
  const client = createSessionClient('http://session', fetchImpl);
  await expect(client.sendCommand('tsk_0123456789abcdef0123456789abcdef' as TaskId, { id: 'query', type: 'listAgentTerminals' })).rejects.toMatchObject({ kind: 'precondition', details: { code: 'pty_unavailable' } });
});

test('试调命令关闭连接复用和重定向并有超时；普通 CLI 命令保留既有选项', async () => {
  const requests: Array<RequestInit | undefined> = [];
  const fetchImpl = Object.assign(async (_url: string | URL | Request, init?: RequestInit) => { requests.push(init); return Response.json({ payload: {} }); }, { preconnect: fetch.preconnect });
  const client = createSessionClient('http://session', fetchImpl), taskId = 'tsk_0123456789abcdef0123456789abcdef' as TaskId;
  await client.sendCommand(taskId, { id: 'http', type: 'invokeApi', proxy: 'crm', method: 'GET', path: '/items', query: {}, headers: {} });
  await client.sendCommand(taskId, { id: 'cli', type: 'listAgentTerminals' });
  expect(requests[0]).toMatchObject({ keepalive: false, redirect: 'error', signal: expect.any(AbortSignal) });
  expect(requests[1]).not.toHaveProperty('keepalive');
  expect(requests[1]).not.toHaveProperty('signal');
});
