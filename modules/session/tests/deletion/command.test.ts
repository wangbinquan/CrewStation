import { expect, test } from 'bun:test';
import { newResourceId } from '@crewstation/kernel';
import type { RunnerCommand } from '@crewstation/contracts';
import { RunnerCommandSchema } from '@crewstation/contracts';
import { sessionCleanupCommand } from '../../domain/deletion/cleanupCommand';
import { developmentRegistration } from '../developmentUsageFixtures';

function fixture() {
  const registration = developmentRegistration();
  const business = { taskId: registration.runtimeTaskId, persistedThrough: 2, receipt: { executionId: 'original', attempt: 1, incarnation: crypto.randomUUID(),
    payloadDigest: 'b'.repeat(64), phase: 'running' as const, lastSequence: 8, acknowledgedSequence: 0, outputBytes: 0, result: null } };
  const original = { projectId: registration.identity.projectId, taskId: registration.runtimeTaskId, development: { registration, persistedThrough: 2 }, business };
  const intent = { version: 1, identity: registration.identity, profileId: registration.profileId, profileRevision: registration.profileRevision,
    launch: { protocol: 'opencode', binaryPath: '/fixture/opencode', extraArgs: [], isSandbox: false }, permission: 'edit', mode: 'interactive',
    initialPrompt: null, cwd: null, resumeSessionId: null, systemPrompt: null, mcp: [], nativeUsageLineageKey: 'original' };
  const stop = { id: 'stop', type: 'stopDevelopmentAgent', podUid: registration.podUid, admission: { intent, key: registration.key, digestNonce: 'a'.repeat(64) } };
  return { original, registration, stop };
}

test('original registered sources permit stop, contiguous reads and only the committed ACK watermark', () => {
  const f = fixture();
  const commands: RunnerCommand[] = [RunnerCommandSchema.parse(f.stop),
    { id: 'info', type: 'developmentUsageInfo', key: f.registration.key },
    { id: 'read', type: 'readDevelopmentUsageEvents', key: f.registration.key, after: 2, limit: 5 },
    { id: 'ack', type: 'ackDevelopmentUsageEvents', key: f.registration.key, through: 2 },
    { id: 'get', type: 'getBusinessExecution', executionId: 'original' },
    { id: 'cancel', type: 'cancelBusinessExecution', executionId: 'original' },
    { id: 'read', type: 'readBusinessExecutionEvents', executionId: 'original', after: 2, limit: 71 },
    { id: 'ack', type: 'ackBusinessExecutionEvents', executionId: 'original', through: 2 },
  ];
  for (const command of commands) expect(sessionCleanupCommand(command, f.original)).toEqual(command);
  const { attempt, incarnation, payloadDigest } = f.original.business.receipt;
  const registered = { id: 'cancel', type: 'cancelBusinessExecution' as const, executionId: 'original', registration: { attempt, incarnation, payloadDigest } };
  // Preserve the original receipt identity so cancel-before-start can install the Runner's cancellation tombstone.
  expect(sessionCleanupCommand(registered, f.original)).toEqual(registered);
  expect(registered.registration).toEqual({ attempt, incarnation, payloadDigest });
});

test('missing/replaced sources, uncommitted read/ACK watermarks and another incarnation never become cleanup permission', () => {
  const f = fixture();
  expect(() => sessionCleanupCommand(f.stop, { projectId: f.original.projectId, taskId: f.original.taskId })).toThrow('原开发');
  expect(() => sessionCleanupCommand(f.stop, { ...f.original, taskId: newResourceId() as typeof f.original.taskId })).toThrow('原开发');
  expect(() => sessionCleanupCommand(f.stop, { ...f.original, projectId: newResourceId() as typeof f.original.projectId })).toThrow('原开发');
  expect(() => sessionCleanupCommand({ ...f.stop, podUid: 'replacement' }, f.original)).toThrow('原 Pod');
  expect(() => sessionCleanupCommand({ ...f.stop, admission: { ...f.stop.admission, intent: { ...f.stop.admission.intent, profileRevision: 4 } } }, f.original)).toThrow('受理身份');
  expect(() => sessionCleanupCommand({ id: 'info', type: 'developmentUsageInfo' }, f.original)).toThrow('原开发');
  for (const type of ['readDevelopmentUsageEvents', 'ackDevelopmentUsageEvents']) {
    const args = type === 'readDevelopmentUsageEvents' ? { after: 3, limit: 5 } : { through: 3 };
    expect(() => sessionCleanupCommand({ id: 'skip', type, key: f.registration.key, ...args }, f.original)).toThrow('尚未持久');
  }
  for (const type of ['readBusinessExecutionEvents', 'ackBusinessExecutionEvents']) {
    const args = type === 'readBusinessExecutionEvents' ? { after: 3, limit: 1000 } : { through: 3 };
    expect(() => sessionCleanupCommand({ id: 'skip', type, executionId: 'original', ...args }, f.original)).toThrow('尚未持久');
  }
  expect(() => sessionCleanupCommand({ id: 'get', type: 'getBusinessExecution', executionId: 'replacement' }, f.original)).toThrow('原业务');
  expect(() => sessionCleanupCommand({ id: 'get', type: 'getBusinessExecution', executionId: 'original' }, { projectId: f.original.projectId, taskId: f.original.taskId })).toThrow('原业务');
  expect(() => sessionCleanupCommand({ id: 'get', type: 'getBusinessExecution', executionId: 'original' }, { ...f.original, business: { ...f.original.business, taskId: newResourceId() as typeof f.original.taskId } })).toThrow('原业务');
  const { attempt, payloadDigest } = f.original.business.receipt;
  expect(() => sessionCleanupCommand({ id: 'cancel', type: 'cancelBusinessExecution', executionId: 'original', registration: { attempt, payloadDigest, incarnation: crypto.randomUUID() } }, f.original)).toThrow('重新登记');
  expect(() => sessionCleanupCommand(f.stop, { ...f.original, development: { ...f.original.development, persistedThrough: NaN } })).toThrow('持久水位');
});

test('ordinary commands and unbound discovery stay closed; the validated command has independent bytes', () => {
  const f = fixture();
  for (const command of [
    { id: 'probe', type: 'businessExecutionInfo' }, { id: 'preview', type: 'restartPreview' },
    { id: 'exec', type: 'exec', execId: 'new', command: ['sh'], wait: true }, { id: 'file', type: 'writeFile', path: 'file', content: 'new' },
  ]) expect(() => sessionCleanupCommand(command, f.original)).toThrow('不允许启动');
  const command: RunnerCommand = { id: 'read', type: 'readDevelopmentUsageEvents', key: structuredClone(f.registration.key), after: 2, limit: 5 };
  const validated = sessionCleanupCommand(command, f.original);
  command.key.payloadDigest = 'c'.repeat(64);
  expect(validated).toMatchObject({ key: f.registration.key });
  expect(() => sessionCleanupCommand({ ...validated, unsupported: true }, f.original)).toThrow();
});
