// 项目删除的会话清理命令只能停止与排空原业务执行（RFC-034 v2 起不再有开发数值日志命令）。
import { expect, test } from 'bun:test';
import { newResourceId } from '@crewstation/kernel';
import type { RunnerCommand, TaskId, ProjectId } from '@crewstation/contracts';
import { sessionCleanupCommand } from '../../domain/deletion/cleanupCommand';

function fixture() {
  const taskId = newResourceId() as TaskId, projectId = newResourceId() as ProjectId;
  const business = { taskId, persistedThrough: 2, receipt: { executionId: 'original', attempt: 1, incarnation: crypto.randomUUID(),
    payloadDigest: 'b'.repeat(64), phase: 'running' as const, lastSequence: 8, acknowledgedSequence: 0, outputBytes: 0, result: null } };
  return { original: { projectId, taskId, business } };
}

test('original registered business sources permit get, cancel, contiguous reads and only the committed ACK watermark', () => {
  const f = fixture();
  const commands: RunnerCommand[] = [
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
});

test('missing/replaced sources, uncommitted read/ACK watermarks and another incarnation never become cleanup permission', () => {
  const f = fixture();
  for (const type of ['readBusinessExecutionEvents', 'ackBusinessExecutionEvents']) {
    const args = type === 'readBusinessExecutionEvents' ? { after: 3, limit: 1000 } : { through: 3 };
    expect(() => sessionCleanupCommand({ id: 'skip', type, executionId: 'original', ...args }, f.original)).toThrow('尚未持久');
  }
  expect(() => sessionCleanupCommand({ id: 'get', type: 'getBusinessExecution', executionId: 'replacement' }, f.original)).toThrow('原业务');
  expect(() => sessionCleanupCommand({ id: 'get', type: 'getBusinessExecution', executionId: 'original' }, { projectId: f.original.projectId, taskId: f.original.taskId })).toThrow('原业务');
  expect(() => sessionCleanupCommand({ id: 'get', type: 'getBusinessExecution', executionId: 'original' }, { ...f.original, business: { ...f.original.business, taskId: newResourceId() as TaskId } })).toThrow('原业务');
  const { attempt, payloadDigest } = f.original.business.receipt;
  expect(() => sessionCleanupCommand({ id: 'cancel', type: 'cancelBusinessExecution', executionId: 'original', registration: { attempt, payloadDigest, incarnation: crypto.randomUUID() } }, f.original)).toThrow('重新登记');
  expect(() => sessionCleanupCommand({ id: 'get', type: 'getBusinessExecution', executionId: 'original' }, { ...f.original, business: { ...f.original.business, persistedThrough: NaN } })).toThrow('持久水位');
});

test('ordinary commands, retired development usage commands and unbound discovery stay closed', () => {
  const f = fixture();
  for (const command of [
    { id: 'probe', type: 'businessExecutionInfo' }, { id: 'preview', type: 'restartPreview' },
    { id: 'exec', type: 'exec', execId: 'new', command: ['sh'], wait: true }, { id: 'file', type: 'writeFile', path: 'file', content: 'new' },
  ]) expect(() => sessionCleanupCommand(command, f.original)).toThrow('不允许启动');
  expect(() => sessionCleanupCommand({ id: 'info', type: 'developmentUsageInfo', key: {} }, f.original)).toThrow();
  const validated = sessionCleanupCommand({ id: 'read', type: 'readBusinessExecutionEvents', executionId: 'original', after: 2, limit: 5 }, f.original);
  expect(() => sessionCleanupCommand({ ...validated, unsupported: true }, f.original)).toThrow();
});
