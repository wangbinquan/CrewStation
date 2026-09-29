import { expect, test } from 'bun:test';
import { RunnerCommandSchema, type RunnerHello } from '@crewstation/contracts';
import { assertLaunchSupported } from './runtimeNegotiation';
import { terminalViewCommand } from './terminalViews';

const capabilities: RunnerHello['capabilities'] = { protocols: ['opencode'], preview: false, pty: true };
const key = { executionId: '019f0000-0000-7000-8000-000000000003', journalId: crypto.randomUUID(), incarnation: crypto.randomUUID(), payloadDigest: 'a'.repeat(64) };

test('numeric info/read/ack negotiate before sending to legacy runners and cannot be issued by browser views', () => {
  const inputs = [{ type: 'developmentUsageInfo', key }, { type: 'readDevelopmentUsageEvents', key, after: 0 }, { type: 'ackDevelopmentUsageEvents', key, through: 1 }];
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
