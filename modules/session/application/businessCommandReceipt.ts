import type { RunnerCommand, TaskId } from '@crewstation/contracts';
import { BusinessExecutionReceiptSchema } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { BusinessExecutionStore } from '../ports/businessExecutions';

/** 在任何 socket 写入之前登记接收意图；超时或进程重启后仍有可对账的执行 ID。 */
export async function prepareBusinessCommand(store: BusinessExecutionStore | undefined, taskId: TaskId, command: RunnerCommand): Promise<void> {
  if (command.type !== 'startBusinessCommand' && command.type !== 'startBusinessAgent' && command.type !== 'ackBusinessExecutionEvents' && command.type !== 'cancelBusinessExecution') return;
  if (!store) throw precondition('session 未启用可靠业务事件存储', { code: 'unsupported_capability' });
  if ((command.type === 'startBusinessCommand' || command.type === 'startBusinessAgent')) {
    await store.register(taskId, { executionId: command.executionId, attempt: command.attempt, payloadDigest: command.payloadDigest, incarnation: command.incarnation,
      phase: 'registered', lastSequence: 0, acknowledgedSequence: 0, outputBytes: 0, result: null });
  } else if (command.type === 'cancelBusinessExecution') {
    if (command.registration) await store.register(taskId, { executionId: command.executionId, ...command.registration, phase: 'registered', lastSequence: 0, acknowledgedSequence: 0, outputBytes: 0, result: null });
  } else {
    const stream = await store.get(taskId, command.executionId);
    if (!stream || command.through > stream.persistedThrough) throw precondition('不能确认尚未持久化的 Runner 事件');
  }
}

export async function persistBusinessReply(store: BusinessExecutionStore | undefined, taskId: TaskId, command: RunnerCommand, payload: unknown): Promise<void> {
  if (((command.type === 'startBusinessCommand' || command.type === 'startBusinessAgent') || (command.type === 'cancelBusinessExecution' && command.registration)) && store) await store.ingest(taskId, BusinessExecutionReceiptSchema.parse(payload), []);
  if (command.type === 'ackBusinessExecutionEvents' && store) await store.acknowledge(taskId, command.executionId, command.through);
}
