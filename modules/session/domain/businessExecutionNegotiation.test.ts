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

// RFC-034 v2：业务执行不再协商用量能力；旧的扩展字段一律被协议拒绝（usage 事件本身携带执行快照）。
test('business execution info carries no usage negotiation and rejects the retired v1 fields', () => {
  const caps: RunnerHello['capabilities'] = { protocols: ['opencode'], preview: false, pty: true, businessExecutionV3: 1 };
  expect(() => assertLaunchSupported(RunnerCommandSchema.parse({ id: 'info', type: 'businessExecutionInfo' }), caps)).not.toThrow();
  expect(RunnerCommandSchema.safeParse({ id: 'info', type: 'businessExecutionInfo', usageObservationsV1: 1 }).success).toBe(false);
  expect(RunnerCommandSchema.safeParse({ id: 'info', type: 'businessExecutionInfo', nativeUsageTreeV1: 1 }).success).toBe(false);
});


test('native material, object transfer, inventory and command Secret each require their independent Runner capability', () => {
  const caps: RunnerHello['capabilities'] = { protocols: ['opencode'], preview: false, pty: true, businessExecutionV3: 1 };
  const profile = Bun.randomUUIDv7(), object = { objectId: Bun.randomUUIDv7(), sha256: 'a'.repeat(64), size: 1 };
  const agent = { id: 'a', type: 'startAgent', agentId: 'a', processAttemptId: 'attempt', compute: profile, profileRevision: 1, launch: { protocol: 'opencode', binaryPath: '/bin/agent' }, permission: 'full', mode: 'oneshot', beforeStart: { profile, revision: 1, contentHash: 'h', steps: [], vars: {}, secrets: {}, configFile: { kind: 'none' }, captureOutput: false } };
  for (const [key, patch] of [
    ['nativeConfigVersion', { businessNativeConfig: { version: 1, protocol: 'opencode', agent: { name: 'review', body: 'review', options: {} } } }],
    ['materialObjectsVersion', { businessMaterialDownloads: [{ object, url: 'http://platform.test/object', token: 'scoped', expiresAt: '2099-01-01T00:00:00.000Z' }] }],
    ['startupInventoryVersion', { startupInventoryVersion: 1 }],
  ] as const) {
    const command = RunnerCommandSchema.parse({ ...agent, ...patch });
    expect(() => assertLaunchSupported(command, caps)).toThrow('不支持');
    expect(() => assertLaunchSupported(command, { ...caps, [key]: 1 })).not.toThrow();
  }
  const id = Bun.randomUUIDv7(), command = RunnerCommandSchema.parse({ id: 'request', type: 'startBusinessCommand', executionId: 'execution', attempt: 1, incarnation: crypto.randomUUID(), payloadDigest: 'a'.repeat(64), command: ['git', 'fetch'], env: { GIT_TOKEN: 'rendered' }, secretEnvironment: { version: 1, nonce: 'b'.repeat(64), references: { GIT_TOKEN: id }, versions: [{ definitionId: id, itemId: Bun.randomUUIDv7(), version: 1 }] } });
  expect(() => assertLaunchSupported(command, caps)).toThrow('Secret');
  expect(() => assertLaunchSupported(command, { ...caps, commandSecretEnvVersion: 1 })).not.toThrow();
});
