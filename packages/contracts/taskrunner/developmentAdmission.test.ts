import { expect, test } from 'bun:test';
import { RunnerHelloSchema, TASKRUNNER_PROTOCOL_VERSION } from './protocol';

const hello = { type: 'hello', protocolVersion: TASKRUNNER_PROTOCOL_VERSION, taskId: '019f0000-0000-7000-8000-000000000003',
  runnerToken: 'fixture', workdir: '/work', capabilities: { protocols: ['opencode'], pty: false, preview: false } };

test('the specific StartAgent fence is optional and declares no numeric availability', () => {
  expect(RunnerHelloSchema.parse(hello).capabilities.developmentStartAgentFenceV1).toBeUndefined();
  const parsed = RunnerHelloSchema.parse({ ...hello, capabilities: { ...hello.capabilities, developmentStartAgentFenceV1: 1 } });
  expect(parsed.capabilities.developmentStartAgentFenceV1).toBe(1);
  expect(parsed.capabilities.developmentUsageV1).toBeUndefined();
  expect(parsed.capabilities.usageObservationsV1).toBeUndefined();
  expect(parsed.capabilities.developmentUsageStopV1).toBeUndefined();
});
test('the fence rejects unknown versions without weakening existing numeric dependencies', () => {
  for (const value of [0, 2, true, '1', null]) {
    expect(RunnerHelloSchema.safeParse({ ...hello, capabilities: { ...hello.capabilities, developmentStartAgentFenceV1: value } }).success).toBe(false);
  }
  expect(RunnerHelloSchema.safeParse({ ...hello, capabilities: { ...hello.capabilities, developmentStartAgentFenceV1: 1, developmentUsageV1: 1 } }).success).toBe(false);
  expect(RunnerHelloSchema.safeParse({ ...hello, capabilities: { ...hello.capabilities, developmentUsageV1: 1, usageObservationsV1: 1 } }).success).toBe(true);
});
