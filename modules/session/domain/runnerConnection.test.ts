import { expect, test } from 'bun:test';
import { TASKRUNNER_PROTOCOL_VERSION, TaskIdSchema } from '@crewstation/contracts';
import { RunnerConnection } from './runnerConnection';

function connection(close = (_code: number, _reason: string) => {}) {
  return new RunnerConnection({ type: 'hello', protocolVersion: TASKRUNNER_PROTOCOL_VERSION,
    taskId: TaskIdSchema.parse('01a0bf5d-8f4b-7418-8a3f-7cbb4a1fd751'), runnerToken: 'private token', workdir: '/private-work',
    capabilities: { protocols: ['terminal'], pty: true, preview: false } }, { send: () => {}, close }, 0, 1000, 0);
}
test('close waits for original message and full command preparation, rejects pending replies and clears credentials', async () => {
  const c = connection(), message = Promise.withResolvers<void>(), command = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  const processing = c.process(async () => { entered.resolve(); await message.promise; });
  const preparing = c.command(async () => { await command.promise; });
  let failed = false, done = false;
  c.pending.add({ id: 'pending', type: 'previewStatus', sentAt: 0, resolve: () => {}, reject: () => { failed = true; } });
  await entered.promise;
  const closing = c.close('deleted').then(() => { done = true; });
  expect(c.closed).toBe(true); expect(failed).toBe(true); expect(done).toBe(false);
  const late = c.process(async () => { throw new Error('late message must not run'); });
  await expect(c.command(async () => undefined)).rejects.toThrow('closed');
  message.resolve(); await processing; await late; expect(done).toBe(false);
  command.resolve(); await preparing; await closing;
  expect(c.hello.runnerToken).toBe(''); expect(c.hello.workdir).toBe(''); expect(c.pending.size).toBe(0);
});
test('a failed socket close still drains callbacks and can retry the actual transport close', async () => {
  let attempts = 0;
  const c = connection(() => { if (++attempts === 1) throw new Error('transport failure'); });
  await expect(c.close('deleted')).rejects.toThrow('transport failure');
  expect(c.hello.runnerToken).toBe('');
  await c.close('deleted'); expect(attempts).toBe(2);
});
