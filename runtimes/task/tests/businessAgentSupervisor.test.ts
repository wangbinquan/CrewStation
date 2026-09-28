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


test('RFC-034 numeric evidence is durably replayed unchanged with the legacy usage frame', async () => {
  const f = await fixture(1024, 4096), events = createEventQueue<AgentEvent>();
  const usageCapture: NonNullable<AgentEvent['usageCapture']> = { version: 1, diagnostics: [], measurements: [{
    recordId: 'native-step', revision: 1, occurredAt: null, observedAt: new Date().toISOString(), adapterVersion: 'test@1', actualModel: null,
    reporting: 'delta', inclusion: 'self', coverage: 'complete', validity: 'valid', basis: { kind: 'invocation' }, coveredThroughTurn: null,
    scope: { root: 'native', session: 'native', parentSession: null, ancestors: [], turn: 'turn', turnIndex: 0, level: 'request' },
    usage: { input: '9007199254740993', output: '0', cacheRead: '2', cacheWrite: '0' },
  }] };
  f.supervisor.start(identity, async () => ({ events, send: async () => {}, cancel: async () => {} }));
  events.push(event('usage', { raw: 'private raw', usage: { measurementId: 'legacy', scope: 'legacy', mode: 'cumulative', inputTokens: null, outputTokens: 0, cacheReadTokens: 2, cacheWriteTokens: 0, complete: false }, usageCapture }));
  events.push(event('completed', { result: { exitCode: 0 } })); events.close();
  expect((await f.supervisor.settled(identity.executionId)).result?.reason).toBe('exited');
  const reopened = new ExecutionJournal(f.root, 'two', { outputBytes: 1024, spoolBytes: 4096, eventBytes: 4096 }); journals.push(reopened);
  const frame = reopened.replay(identity.executionId, 0).find(({ frame }) => frame.type === 'agent' && frame.event.type === 'usage')!.frame;
  expect(frame.type === 'agent' && frame.event.usageCapture).toEqual(usageCapture);
  expect(JSON.stringify(frame)).not.toContain('private raw');
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
