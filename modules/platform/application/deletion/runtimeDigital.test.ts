import { expect, test } from 'bun:test';
import { ProjectDeletionContextSchema, TaskIdSchema } from '@crewstation/contracts';
import type { RunnerBusinessReceipt, RunnerCommand } from '@crewstation/contracts';
import { jsonHash, newResourceId, precondition } from '@crewstation/kernel';
import type { RuntimeSessionCopies } from '../../ports/runtimeSession';
import { runtimeDigitalStops } from './runtimeDigital';

function fixture() {
  const taskId = TaskIdSchema.parse(newResourceId());
  const context = ProjectDeletionContextSchema.parse({ operationId: newResourceId(), generation: 1, phase: 'stop',
    target: { id: newResourceId(), serviceId: newResourceId(), slug: 'original', name: 'Original', namespace: 'cs-original', kind: 'DigitalWorker', state: 'deleting', revision: '1',
      prodHost: 'original.invalid', previewHost: 'preview.original.invalid', serviceHost: 'original.service.invalid' },
    confirmed: { participant: 'task-runtime', complete: true, resources: [], references: [], blockers: [], revision: jsonHash('original runtime') } });
  const sessionContext = ProjectDeletionContextSchema.parse({ ...context, confirmed: { ...context.confirmed, participant: 'session' } });
  const receipt: RunnerBusinessReceipt = { executionId: crypto.randomUUID(), attempt: 1, incarnation: crypto.randomUUID(), payloadDigest: 'a'.repeat(64),
    phase: 'running', lastSequence: 0, acknowledgedSequence: 0, outputBytes: 0, result: null };
  const transport = { id: newResourceId(), taskId, replica: 'http://original-session.invalid' };
  const state = { receipt, persistedThrough: 0, acknowledgedThrough: 0, complete: false }, calls: RunnerCommand[] = [], selected: string[] = [];
  const flags = { connected: true, ambiguous: false, original: true, granted: true };
  const session: RuntimeSessionCopies = { transports: async () => flags.ambiguous ? [transport, { ...transport, id: newResourceId() }] : flags.connected ? [transport] : [],
    originalBusiness: async (after) => flags.original && after === null ? [state.receipt] : [], lookupDevelopmentUsage: async () => ({ version: 1, runtimeTaskId: taskId, kind: 'absent' }),
    getBusinessExecution: async () => ({ ...state }), send: async (source, command) => {
      expect(source).toEqual(transport); calls.push(command);
      if (command.type === 'cancelBusinessExecution') state.receipt = { ...state.receipt, phase: 'finished', lastSequence: 7, result: { reason: 'cancelled', exitCode: null, durationMs: 0 } };
      if (command.type === 'readBusinessExecutionEvents') { expect(command.after).toBe(state.persistedThrough); state.persistedThrough = Math.min(7, state.persistedThrough + command.limit); state.complete = state.persistedThrough === 7; }
      if (command.type === 'ackBusinessExecutionEvents') { expect(command.through).toBeLessThanOrEqual(state.persistedThrough); state.acknowledgedThrough = command.through; }
      return undefined;
    } };
  const project = { projectDeletionParticipantContext: async (received: typeof context, participant: string) => {
    expect(received).toEqual(context); expect(participant).toBe('session'); return sessionContext;
  }, assertProjectDeletionGrant: async () => { if (!flags.granted) throw precondition('controlled Root grant expired'); } };
  const digital = runtimeDigitalStops(project, (grant, id) => { expect(grant).toEqual(sessionContext); selected.push(id); return session; });
  return { context, sessionContext, taskId, state, flags, calls, selected, session, digital, project };
}
test('original business cancellation copies bounded pages before ACK and cannot finish on a terminal receipt alone', async () => {
  const f = fixture();
  expect((await f.digital(f.context, { id: f.taskId })).kind).toBe('waiting');
  expect(f.calls.map((command) => command.type)).toEqual(['cancelBusinessExecution', 'getBusinessExecution', 'readBusinessExecutionEvents', 'ackBusinessExecutionEvents']);
  expect(f.calls[0]).toMatchObject({ executionId: f.state.receipt.executionId, registration: { attempt: 1, incarnation: f.state.receipt.incarnation, payloadDigest: 'a'.repeat(64) } });
  expect(f.state.persistedThrough).toBe(5); expect(f.state.complete).toBe(false);
  expect((await f.digital(f.context, { id: f.taskId })).kind).toBe('ready');
  expect(f.state.persistedThrough).toBe(7); expect(f.state.acknowledgedThrough).toBe(7);
  expect(new Set(f.calls.map((command) => command.id)).size).toBe(f.calls.length);
});
test('lost or ambiguous original connections cannot stop a running execution or fabricate digital completion', async () => {
  const f = fixture(); f.flags.connected = false;
  expect((await f.digital(f.context, { id: f.taskId })).kind).toBe('waiting'); expect(f.calls).toEqual([]);
  f.flags.ambiguous = true;
  expect((await f.digital(f.context, { id: f.taskId })).kind).toBe('waiting'); expect(f.calls).toEqual([]);
  f.flags.ambiguous = false; f.flags.original = false;
  expect((await f.digital(f.context, { id: f.taskId })).kind).toBe('ready');
  f.flags.granted = false;
  await expect(f.digital(f.context, { id: f.taskId })).rejects.toMatchObject({ kind: 'precondition' });
});
test('the original receipts on later pages participate in the barrier', async () => {
  const f = fixture(), ids: string[] = Array.from({ length: 101 }, () => crypto.randomUUID());
  f.state.receipt = { ...f.state.receipt, phase: 'finished', lastSequence: 7, result: { reason: 'cancelled', exitCode: null, durationMs: 0 } };
  f.state.persistedThrough = 7; f.state.acknowledgedThrough = 7;
  f.session.originalBusiness = async (after) => ids.slice(after === null ? 0 : ids.indexOf(after!) + 1, after === null ? 100 : 101).map((executionId) => ({ ...f.state.receipt, executionId }));
  f.flags.connected = false; let reads = 0;
  f.session.getBusinessExecution = async (_task, id) => { reads++; return { ...f.state, receipt: { ...f.state.receipt, executionId: id }, complete: id !== ids[100] }; };
  expect((await f.digital(f.context, { id: f.taskId })).kind).toBe('waiting'); expect(reads).toBe(101);
});
