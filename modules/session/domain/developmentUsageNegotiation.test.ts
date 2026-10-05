import { expect, test } from 'bun:test';
import { StartAgentCommandSchema, RunnerCommandSchema, type RunnerHello } from '@crewstation/contracts';
import { assertLaunchSupported } from './runtimeNegotiation';
import { terminalViewCommand } from './terminalViews';

const capabilities: RunnerHello['capabilities'] = { protocols: ['opencode'], preview: false, pty: true };
const key = { executionId: '019f0000-0000-7000-8000-000000000003', journalId: crypto.randomUUID(), incarnation: crypto.randomUUID(), payloadDigest: 'a'.repeat(64) };

test('numeric info/read/ack negotiate before sending to legacy runners and cannot be issued by browser views', () => {
  const inputs = [{ type: 'developmentUsageInfo', key }, { type: 'readDevelopmentUsageEvents', key, after: 0 }, { type: 'readDevelopmentNativePage', key, passId: 'original', ordinal: '0', afterByte: 0 }, { type: 'ackDevelopmentUsageEvents', key, through: 1 }];
  for (const input of inputs) {
    const command = RunnerCommandSchema.parse({ id: 'cmd', ...input });
    expect(() => assertLaunchSupported(command, capabilities)).toThrow('开发数值日志能力');
    expect(() => assertLaunchSupported(command, { ...capabilities, usageObservationsV1: 1, developmentUsageV1: 1 })).not.toThrow();
    expect(() => terminalViewCommand(command, 'browser-view')).toThrow('持久采集服务');
  }
  const old = RunnerCommandSchema.parse({ id: 'ordinary', type: 'exec', execId: 'old', command: ['true'] });
  expect(assertLaunchSupported(old, capabilities)).toBeUndefined();
  expect(terminalViewCommand(old, 'browser-view')).toEqual(old);
});

test('selected source capability is checked before launch while omitted source keeps legacy numeric negotiation', () => {
  const id = '019f0000-0000-7000-8000-000000000004', profile = '019f0000-0000-7000-8000-000000000005';
  const launch = { protocol: 'opencode' as const, binaryPath: '/bin/opencode', extraArgs: [], isSandbox: false };
  const intent = { version: 1, identity: { sourceKind: 'development-agent', projectId: '019f0000-0000-7000-8000-000000000001', taskId: '019f0000-0000-7000-8000-000000000002', executionId: key.executionId, executionGeneration: 1, agentId: id }, profileId: profile, profileRevision: 1, launch, permission: 'full', mode: 'oneshot', initialPrompt: 'private', cwd: null, resumeSessionId: null, systemPrompt: null, mcp: [], nativeUsageLineageKey: 'expected', nativeSource: { version: 1 } };
  const command = StartAgentCommandSchema.parse({ id: 'selected', type: 'startAgent', agentId: id, compute: 'named compute', profileRevision: 1, launch, permission: 'full', mode: 'oneshot', initialPrompt: 'private', mcp: [], env: {}, beforeStart: { profile, revision: 1, contentHash: 'hash', steps: [], vars: {}, secrets: {}, configFile: { kind: 'none' }, captureOutput: false }, processAttemptId: 'attempt', developmentUsage: { intent, key, digestNonce: 'a'.repeat(64) } });
  const numeric = { ...capabilities, usageObservationsV1: 1 as const, developmentUsageV1: 1 as const };
  expect(() => assertLaunchSupported(command, numeric)).toThrow('实际原生来源能力');
  expect(() => assertLaunchSupported(command, { ...numeric, developmentNativeSourceV1: 1 })).not.toThrow();
  const { nativeSource: _nativeSource, ...old } = command.developmentUsage!.intent;
  expect(() => assertLaunchSupported({ ...command, developmentUsage: { ...command.developmentUsage!, intent: old } }, numeric)).not.toThrow();
});
