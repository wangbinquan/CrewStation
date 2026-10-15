import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { noopLogger } from '@crewstation/kernel';
import type { AgentEvent } from '@crewstation/contracts';
import type { AgentProcess } from '../src/agents/driver';
import { createEventQueue } from '../src/agents/eventQueue';
import { ExecutionJournal } from '../src/exec/executionJournal';
import { BusinessAgentSupervisor } from '../src/agents/businessAgentSupervisor';

const roots: string[] = [], journals: ExecutionJournal[] = [];
afterEach(async () => { for (const journal of journals.splice(0)) journal.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const identity = { executionId: 'agent-execution', attempt: 1, payloadDigest: 'a'.repeat(64) };
const event = (type: AgentEvent['type'], fields: Partial<AgentEvent> = {}): AgentEvent => ({ agentId: 'agent', seq: 1, at: new Date().toISOString(), type, ...fields });
async function fixture(outputBytes = 1024, eventBytes = 1024) {
  const root = await mkdtemp(join(tmpdir(), 'business-agent-')); roots.push(root);
  const journal = new ExecutionJournal(root, 'one', { outputBytes, spoolBytes: 4096, eventBytes }); journals.push(journal);
  return { root, journal, supervisor: new BusinessAgentSupervisor(journal, noopLogger) };
}

test('duplicate start constructs one Agent; final output, tools and usage remain replayable across journal reopening', async () => {
  const f = await fixture(), events = createEventQueue<AgentEvent>(); let starts = 0;
  const create = async (): Promise<AgentProcess> => { starts++; return { events, send: async () => {}, cancel: async () => {} }; };
  f.supervisor.start(identity, create); f.supervisor.start(identity, create); expect(starts).toBe(1);
  events.push(event('text', { text: 'hello', raw: 'private raw protocol' }));
  events.push(event('tool-start', { tool: { name: 'Read', callId: 'call' } }));
  events.push(event('completed', { result: { exitCode: 0 } })); events.close();
  expect(await f.supervisor.settled(identity.executionId)).toMatchObject({ phase: 'finished', outputBytes: 5, result: { reason: 'exited', exitCode: 0 } });
  const reopened = new ExecutionJournal(f.root, 'two', { outputBytes: 1024, spoolBytes: 4096, eventBytes: 1024 }); journals.push(reopened);
  expect(new BusinessAgentSupervisor(reopened, noopLogger).start(identity, create).phase).toBe('finished'); expect(starts).toBe(1);
  expect(JSON.stringify(reopened.replay(identity.executionId, 0))).not.toContain('private raw');
  expect(reopened.replay(identity.executionId, 0).map((entry) => entry.frame.type)).toEqual(['state', 'agent', 'agent', 'agent', 'result']);
});

test('cancel receipt stays cancelling until driver confirms termination; event iterator failure stays unknown', async () => {
  const f = await fixture(), events = createEventQueue<AgentEvent>(); let finishCancel!: () => void;
  const stopped = new Promise<void>((resolve) => { finishCancel = resolve; });
  f.supervisor.start(identity, async () => ({ events, send: async () => {}, cancel: async () => { await stopped; events.push(event('cancelled')); events.close(); } }));
  expect(f.supervisor.cancel(identity.executionId).phase).toBe('cancelling');
  expect(f.journal.get(identity.executionId)?.result).toBeNull(); finishCancel();
  expect(await f.supervisor.settled(identity.executionId)).toMatchObject({ phase: 'finished', result: { reason: 'cancelled' } });
  const broken = { ...identity, executionId: 'broken' };
  f.supervisor.start(broken, async () => ({ send: async () => {}, cancel: async () => {}, events: { async *[Symbol.asyncIterator]() { throw new Error('reader gone'); } } }));
  expect(await f.supervisor.settled(broken.executionId)).toMatchObject({ phase: 'unknown', result: null });
  expect(() => f.supervisor.cancel(broken.executionId)).toThrow('无法证明');
});

test('output capacity cancels execution and records explicit failure; preparing failure never constructs a second attempt', async () => {
  const f = await fixture(2), events = createEventQueue<AgentEvent>(); let cancelled = 0;
  f.supervisor.start(identity, async () => ({ events, send: async () => {}, cancel: async () => { cancelled++; events.push(event('cancelled')); events.close(); } }));
  events.push(event('text', { text: 'too big' }));
  expect(await f.supervisor.settled(identity.executionId)).toMatchObject({ phase: 'finished', result: { reason: 'output_limit' } }); expect(cancelled).toBe(1);
  let starts = 0; const failed = { ...identity, executionId: 'prepare-failed' };
  const create = async (): Promise<AgentProcess> => { starts++; throw new Error('invalid cwd'); };
  f.supervisor.start(failed, create); await f.supervisor.settled(failed.executionId); f.supervisor.start(failed, create);
  expect(starts).toBe(1); expect(f.journal.get(failed.executionId)).toMatchObject({ result: { reason: 'spawn_failed' } });
});


// RFC-034 v2：执行快照随业务 usage 帧原样持久化与重放，托管应用据此记账；raw 仍被剥掉。
test('the execution usage snapshot is durably replayed unchanged with the business usage frame', async () => {
  const f = await fixture(1024, 4096), events = createEventQueue<AgentEvent>();
  const usageSnapshot: NonNullable<AgentEvent['usageSnapshot']> = { state: 'partial', models: [{ model: 'zhipu/glm-5', input: 9, cacheRead: 2, cacheWrite: 0, output: 3, reasoning: 1 }] };
  f.supervisor.start(identity, async () => ({ events, send: async () => {}, cancel: async () => {} }));
  events.push(event('usage', { raw: 'private raw', usageSnapshot, usage: { measurementId: 'run:1', scope: 'run', mode: 'cumulative', inputTokens: 9, outputTokens: 3, cacheReadTokens: 2, cacheWriteTokens: 0, complete: false, snapshot: usageSnapshot } }));
  events.push(event('completed', { result: { exitCode: 0 }, usageSnapshot })); events.close();
  expect((await f.supervisor.settled(identity.executionId)).result?.reason).toBe('exited');
  const reopened = new ExecutionJournal(f.root, 'two', { outputBytes: 1024, spoolBytes: 4096, eventBytes: 4096 }); journals.push(reopened);
  const frames = reopened.replay(identity.executionId, 0).map(({ frame }) => frame);
  const usage = frames.find((frame) => frame.type === 'agent' && frame.event.type === 'usage')!;
  expect(usage.type === 'agent' && usage.event.usageSnapshot).toEqual(usageSnapshot);
  expect(usage.type === 'agent' && usage.event.usage?.snapshot).toEqual(usageSnapshot);
  const completed = frames.find((frame) => frame.type === 'agent' && frame.event.type === 'completed')!;
  expect(completed.type === 'agent' && completed.event.usageSnapshot).toEqual(usageSnapshot);
  expect(JSON.stringify(usage)).not.toContain('private raw');
});


test('managed event queue rejects unconsumed receipts and acknowledges only completed consumer handling', async () => {
  for (const consumed of [false, true]) {
    const queue = createEventQueue<string>(10), iterator = queue[Symbol.asyncIterator]();
    const receipt = queue.writeProcessed('abcd').then(() => null, (error: unknown) => error);
    if (consumed) expect((await iterator.next()).value).toBe('abcd');
    const waiting = queue.writeProcessed('efgh').then(() => null, (error: unknown) => error);
    const blocked = queue.writeProcessed('ijkl').then(() => null, (error: unknown) => error);
    await iterator.return?.();
    for (const result of [receipt, waiting, blocked]) expect(await result).toBeInstanceOf(Error);
  }
});
