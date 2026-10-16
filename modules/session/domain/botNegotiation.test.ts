import { expect, test } from 'bun:test';
import type { RunnerHello } from '@crewstation/contracts';
import { assertLaunchSupported } from './runtimeNegotiation';

test('Bot requests are rejected before touching an older Runner socket; ordinary CLI commands remain available', () => {
  const capabilities = { protocols: ['opencode'], pty: true } as RunnerHello['capabilities'];
  const info = { id: 'read', type: 'botContextInfo' as const };
  expect(() => assertLaunchSupported(info, capabilities)).toThrow('持续 Bot 上下文能力');
  expect(() => assertLaunchSupported(info, { ...capabilities, botContextVersion: 1 })).not.toThrow();
  expect(() => assertLaunchSupported({ id: 'old', type: 'sendMessage', agentId: 'existing-agent', content: 'continue' }, capabilities)).not.toThrow();
});
