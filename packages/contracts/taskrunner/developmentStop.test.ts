import { expect, test } from 'bun:test';
import { DevelopmentUsageStopReceiptSchema } from './developmentUsage';
import { RunnerHelloSchema } from './protocol';

const id = '019f0000-0000-7000-8000-000000000001';
const receipt = { key: { executionId: id, journalId: '00000000-0000-4000-8000-000000000001', incarnation: '00000000-0000-4000-8000-000000000002', payloadDigest: 'a'.repeat(64) }, podUid: 'fixture',
  identity: { sourceKind: 'development-agent', projectId: id, taskId: id, executionId: id, executionGeneration: 1, agentId: id }, profileId: id, profileRevision: 1,
  phase: 'finished', result: 'cancelled', interruption: null, lastSequence: 0, acknowledgedSequence: 0, finalThrough: 0 };
test('new stop states are strict and interrupted finished cannot assert exit', () => {
  expect(DevelopmentUsageStopReceiptSchema.parse({ version: 1, state: 'prevented', receipt })).toMatchObject({ state: 'prevented' });
  expect(DevelopmentUsageStopReceiptSchema.safeParse({ version: 1, state: 'stopping', receipt }).success).toBe(false);
  const interrupted = { ...receipt, result: 'error', interruption: 'journal-unavailable', finalThrough: null };
  expect(DevelopmentUsageStopReceiptSchema.safeParse({ version: 1, state: 'finished', receipt: interrupted }).success).toBe(false);
  expect(DevelopmentUsageStopReceiptSchema.safeParse({ version: 1, state: 'unknown', receipt: interrupted }).success).toBe(true);
  expect(DevelopmentUsageStopReceiptSchema.safeParse({ version: 1, state: 'unknown', receipt, exitProven: true }).success).toBe(false);
});
test('the optional stop capability depends on a numeric store and leaves old hello shapes intact', () => {
  const hello = { type: 'hello', protocolVersion: 3, taskId: id, runnerToken: 'fixture', workdir: '/work', capabilities: { protocols: ['opencode' as const], pty: false, preview: false } };
  expect(RunnerHelloSchema.parse(hello).capabilities).toEqual(hello.capabilities);
  expect(RunnerHelloSchema.safeParse({ ...hello, capabilities: { ...hello.capabilities, developmentUsageStopV1: 1 } }).success).toBe(false);
  expect(RunnerHelloSchema.safeParse({ ...hello, capabilities: { ...hello.capabilities, developmentUsageStopV1: 1, developmentUsageV1: 1, usageObservationsV1: 1 } }).success).toBe(true);
});
