import { expect, test } from 'bun:test';
import type { TaskId } from '@crewstation/contracts';
import { createSessionClient } from './sessionClient';

test('Runner 明确拒绝和通信超时保留不同 code，调用者才能区分启动失败与结果未确认', async () => {
  const fetchImpl = Object.assign(async () => Response.json({ error: 'precondition', message: 'PTY unavailable', details: { code: 'pty_unavailable' } }, { status: 412 }), { preconnect: fetch.preconnect });
  const client = createSessionClient('http://session', fetchImpl);
  await expect(client.sendCommand('tsk_0123456789abcdef0123456789abcdef' as TaskId, { id: 'query', type: 'listAgentTerminals' })).rejects.toMatchObject({ kind: 'precondition', details: { code: 'pty_unavailable' } });
});
