import { expect, test } from 'bun:test';
import type { RunnerHello } from '@crewstation/contracts';
import { RunnerCommandSchema } from '@crewstation/contracts';
import { assertLaunchSupported } from './runtimeNegotiation';

test('全部可靠命令都要求显式能力，旧 exec 保留旧协议', () => {
  const capabilities: RunnerHello['capabilities'] = { protocols: ['opencode'], preview: false, pty: true };
  const commands = [
    { type: 'businessExecutionInfo' },
    { type: 'startBusinessCommand', executionId: 'x', attempt: 1, incarnation: crypto.randomUUID(), payloadDigest: 'a'.repeat(64), command: ['true'] },
    { type: 'getBusinessExecution', executionId: 'x' }, { type: 'cancelBusinessExecution', executionId: 'x' },
    { type: 'readBusinessExecutionEvents', executionId: 'x', after: 0 },
    { type: 'ackBusinessExecutionEvents', executionId: 'x', through: 1 },
    { type: 'readBusinessFile', query: { path: 'result.bin' } }, { type: 'listBusinessFiles', query: {} },
  ];
  for (const input of commands) {
    const command = RunnerCommandSchema.parse({ id: 'request', ...input });
    expect(() => assertLaunchSupported(command, capabilities)).toThrow('未声明');
    expect(() => assertLaunchSupported(command, { ...capabilities, businessExecutionV3: 1 })).not.toThrow();
    expect(RunnerCommandSchema.safeParse({ id: 'request', ...input, ignored: true }).success).toBe(false);
  }
  expect(() => assertLaunchSupported(RunnerCommandSchema.parse({ id: 'legacy', type: 'exec', execId: 'x', command: ['true'] }), capabilities)).not.toThrow();
});
