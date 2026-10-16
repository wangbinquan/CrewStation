import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StartAgentCommandSchema } from '@crewstation/contracts';
import type { BotContextStorage, TaskId } from '@crewstation/contracts';
import type { AgentSupervisor, AgentSupervisorDeps } from '../agents/supervisorContracts';
import { withBotContext } from './supervisor';
import { material } from '../../tests/profileFixtures';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const context: BotContextStorage = { version: 1, ownerTaskId: '01a0bf5d-8f4b-7001-8458-107366e7de39' as TaskId, conversationId: '01a0bf5d-8f4b-7001-8458-107366e7de40', epoch: 1, pvcName: 'bot-01a0bf5d8f4b70018458107366e7de39', volumeUid: 'original-uid', mode: 'create' };
const command = () => StartAgentCommandSchema.parse({ id: 'start', type: 'startAgent', agentId: 'agent', compute: 'profile', profileRevision: 1,
  launch: { protocol: 'opencode', binaryPath: '/usr/bin/opencode' }, mode: 'interactive', permission: 'full', initialPrompt: 'first turn', beforeStart: material(), processAttemptId: 'first-attempt',
  botContext: { version: 1, conversationId: context.conversationId, epoch: 1, requestId: crypto.randomUUID() } });
function recorder() {
  const calls: string[] = [];
  const inner: AgentSupervisor = { start: async () => { calls.push('start'); }, send: async (_id, text) => { calls.push(text); }, cancel: async () => { calls.push('cancel'); }, cancelAll: async () => { calls.push('close'); }, size: 1 };
  return { calls, inner };
}
async function mounted(inner: AgentSupervisor) {
  const root = await mkdtemp(join(tmpdir(), 'cs-bot-supervisor-')); roots.push(root);
  // The wrapper consumes only the private mount binding; the process supervisor is the controlled boundary.
  const deps = { botContext: context, botRoots: { native: root, receipts: root, scratch: root } } as AgentSupervisorDeps;
  return { deps, supervisor: withBotContext(inner, deps) };
}
test('mounted Bot rejects legacy sends and foreign contexts; durable start and message survive supervisor restart without dispatching twice', async () => {
  const f = recorder(), { deps, supervisor } = await mounted(f.inner), start = command();
  await expect(supervisor.start({ ...start, botContext: { ...start.botContext!, epoch: 2 } })).rejects.toThrow('不符');
  await expect(supervisor.send('agent', 'legacy')).rejects.toThrow('稳定');
  await Promise.all([supervisor.start(start), supervisor.start(start)]);
  const request = crypto.randomUUID();
  await Promise.all([supervisor.sendBot!('agent', 'follow-up', request), supervisor.sendBot!('agent', 'follow-up', request)]);
  expect(f.calls).toEqual(['start', 'follow-up']); expect(supervisor.botReceipt!(request)?.state).toBe('accepted');
  expect(supervisor.botContextInfo!()).toEqual({ version: 1, conversationId: context.conversationId, epoch: 1, volumeUid: context.volumeUid });
  expect(supervisor.size).toBe(1); await supervisor.cancel('agent'); await supervisor.cancelAll();
  const reopened = withBotContext(f.inner, deps);
  await reopened.start(start); await reopened.sendBot!('agent', 'follow-up', request);
  expect(f.calls).toEqual(['start', 'follow-up', 'cancel', 'close']);
  await reopened.cancelAll();
});
test('ambiguous initial dispatch is never repeated; unmounted legacy Agents keep their existing operations', async () => {
  const f = recorder(); f.inner.start = async () => { f.calls.push('uncertain'); throw new Error('receipt lost'); };
  const { supervisor } = await mounted(f.inner), start = command();
  await expect(supervisor.start(start)).rejects.toThrow('不会重复发送');
  await expect(supervisor.start(start)).rejects.toThrow('不会重复发送');
  expect(f.calls).toEqual(['uncertain']); expect(supervisor.botReceipt!(start.botContext!.requestId)?.state).toBe('unknown'); await supervisor.cancelAll();
  const legacy = recorder(), plain = withBotContext(legacy.inner, {} as AgentSupervisorDeps);
  await expect(plain.start(start)).rejects.toThrow('未挂载');
  await plain.start({ ...start, botContext: undefined }); await plain.send('agent', 'legacy text'); await plain.cancel('agent'); await plain.cancelAll();
  expect(plain.size).toBe(1); expect(legacy.calls).toEqual(['start', 'legacy text', 'cancel', 'close']);
});
