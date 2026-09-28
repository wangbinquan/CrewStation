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


test('RFC-034 observation negotiation preserves old info shape and refuses opt-in to an old Runner before RPC', () => {
  const caps: RunnerHello['capabilities'] = { protocols: ['opencode'], preview: false, pty: true, businessExecutionV3: 1 };
  const legacy = RunnerCommandSchema.parse({ id: 'old-info', type: 'businessExecutionInfo' });
  const requested = RunnerCommandSchema.parse({ id: 'new-info', type: 'businessExecutionInfo', usageObservationsV1: 1 });
  expect(() => assertLaunchSupported(legacy, caps)).not.toThrow();
  expect(() => assertLaunchSupported(requested, caps)).toThrow('扩展用量');
  expect(() => assertLaunchSupported(requested, { ...caps, usageObservationsV1: 1 })).not.toThrow();
  expect(RunnerCommandSchema.safeParse({ ...requested, usageObservationsV1: 2 }).success).toBe(false);
});
