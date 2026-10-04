import { expect, test } from 'bun:test';
import { ProjectDeletionContextSchema, ProjectIdSchema, RunnerCommandSchema, ServiceIdSchema, StoredDevelopmentUsageSchema, TaskIdSchema } from '@crewstation/contracts';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import type { SessionCleanupTask } from '../../ports/sessionCleanup';
import { developmentDeletionSession } from './developmentSession';

function fixture() {
  const taskId = TaskIdSchema.parse(newResourceId()), projectId = ProjectIdSchema.parse(newResourceId());
  const context = ProjectDeletionContextSchema.parse({ operationId: newResourceId(), generation: 1, phase: 'stop',
    target: { id: projectId, serviceId: ServiceIdSchema.parse(newResourceId()), slug: 'original', name: 'Original', namespace: 'cs-original', kind: 'DigitalWorker', state: 'active', revision: '1',
      prodHost: 'original.test.invalid', previewHost: 'preview.original.test.invalid', serviceHost: 'original.service.test.invalid' },
    confirmed: { participant: 'dev-session', complete: true, resources: [], references: [], blockers: [], revision: jsonHash('original developer') } });
  const sessionContext = ProjectDeletionContextSchema.parse({ ...context, confirmed: { ...context.confirmed, participant: 'session', revision: jsonHash('original Session') } });
  const registration = { runtimeTaskId: taskId, key: { executionId: taskId, journalId: crypto.randomUUID(), incarnation: crypto.randomUUID(), payloadDigest: 'a'.repeat(64) },
    podUid: crypto.randomUUID(), identity: { sourceKind: 'development-agent', projectId, taskId, executionId: taskId, executionGeneration: 1, agentId: newResourceId() }, profileId: newResourceId(), profileRevision: 1 };
  const { runtimeTaskId: _task, ...header } = registration;
  let stored = StoredDevelopmentUsageSchema.parse({ registration, receipt: { ...header, phase: 'running', lastSequence: 7, acknowledgedSequence: 0, finalThrough: null, result: null, interruption: null },
    persistedThrough: 0, runnerAcknowledgedThrough: 0, sourceAcknowledgedThrough: 0, offeredThrough: 0, complete: false, drainReason: null, loss: null, closure: null });
  const calls: unknown[] = [], transport = { id: newResourceId(), taskId, replica: 'http://original-session.test.invalid' };
  const control = { multiple: false, registered: true }, unused = async () => { throw new Error('Unexpected ordinary consumer operation'); };
  const session: SessionCleanupTask = {
    transports: async () => control.multiple ? [transport, { ...transport, id: newResourceId() }] : [transport],
    send: async (selected, command) => {
      expect(selected).toEqual(transport); calls.push(command);
      if (command.type === 'readDevelopmentUsageEvents') stored = { ...stored, persistedThrough: 5 };
      if (command.type === 'ackDevelopmentUsageEvents') { expect(command.through).toBe(5); stored = { ...stored, runnerAcknowledgedThrough: command.through }; }
      return { originalReply: command.type };
    },
    lookupDevelopmentUsage: async () => control.registered ? { version: 1, runtimeTaskId: taskId, kind: 'registered', stored } : { version: 1, runtimeTaskId: taskId, kind: 'absent' },
    getDevelopmentUsage: async () => stored,
    registerDevelopmentUsage: unused, requestDevelopmentUsageDrain: unused,
  };
  const project = { projectDeletionParticipantContext: async (raw: typeof context, participant: 'session') => {
    expect(raw).toEqual(context); expect(participant).toBe('session'); calls.push('stored-session-context'); return sessionContext;
  } };
  const bind = (raw: typeof context, id: typeof taskId) => { expect(raw).toEqual(sessionContext); expect(id).toBe(taskId); return session; };
  const command = RunnerCommandSchema.parse({ id: newResourceId(), type: 'stopDevelopmentAgent', podUid: registration.podUid,
    admission: { key: registration.key, digestNonce: 'a'.repeat(64), intent: { version: 1, identity: registration.identity, profileId: registration.profileId,
      profileRevision: 1, launch: { protocol: 'opencode', binaryPath: '/original/opencode', extraArgs: [], isSandbox: false }, permission: 'edit', mode: 'interactive',
      initialPrompt: null, cwd: null, resumeSessionId: null, systemPrompt: null, mcp: [], nativeUsageLineageKey: 'original' } } });
  return { taskId, context, calls, control, project, bind, command, get stored() { return stored; } };
}

test('deletion ending restores the stored Session context and copies a bounded page before acknowledging the original Runner', async () => {
  const f = fixture(), port = await developmentDeletionSession(f.project, f.bind)(f.context, f.taskId);
  const reply = await port.sendCommand(f.taskId, f.command);
  expect(reply).toEqual({ originalReply: 'stopDevelopmentAgent' });
  expect(f.calls[1]).not.toHaveProperty('id', f.command.id);
  expect(f.calls).toMatchObject(['stored-session-context', { type: 'stopDevelopmentAgent' }, { type: 'developmentUsageInfo' },
    { type: 'readDevelopmentUsageEvents', after: 0, limit: 5 }, { type: 'ackDevelopmentUsageEvents', through: 5 }]);
  expect(f.stored.persistedThrough).toBe(5); expect(f.stored.runnerAcknowledgedThrough).toBe(5);
});

test('another task, ambiguous original transports and an absent independent journal cannot be treated as completed stopping', async () => {
  const f = fixture(), port = await developmentDeletionSession(f.project, f.bind)(f.context, f.taskId);
  const command = f.command;
  await expect(port.sendCommand(TaskIdSchema.parse(newResourceId()), command)).rejects.toThrow('原任务');
  f.control.multiple = true; await expect(port.sendCommand(f.taskId, command)).rejects.toThrow('唯一确定'); expect(f.calls).toEqual(['stored-session-context']);
  f.control.multiple = false; f.control.registered = false;
  await expect(port.sendCommand(f.taskId, command)).rejects.toThrow('独立数字登记');
  expect(f.calls).toMatchObject(['stored-session-context', { type: 'stopDevelopmentAgent' }]);
  f.control.registered = true;
  expect(await port.sendCommand(f.taskId, { id: newResourceId(), type: 'developmentUsageInfo', key: f.stored.registration.key })).toEqual({ originalReply: 'developmentUsageInfo' });
});
