import type { RunnerCommand, TaskId } from '@crewstation/contracts';
import { BusinessExecutionReceiptSchema, RunnerResultPayloads } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import type { BusinessExecutionStore, StoredBusinessExecution } from '../ports/businessExecutions';

export interface BusinessIngestionDeps {
  store: BusinessExecutionStore;
  send(taskId: TaskId, command: RunnerCommand): Promise<unknown>;
}

/** 先提交 session PG，再确认 Runner；断线和丢确认都从持久水位重入。 */
export async function ingestBusinessExecution(deps: BusinessIngestionDeps, stream: StoredBusinessExecution): Promise<void> {
  const executionId = stream.receipt.executionId, taskId = stream.taskId;
  const receipt = BusinessExecutionReceiptSchema.parse(await deps.send(taskId, { id: newResourceId(), type: 'getBusinessExecution', executionId }));
  const observed = await deps.store.ingest(taskId, receipt, []);
  if (observed.persistedThrough < receipt.lastSequence) {
    const events = RunnerResultPayloads.businessExecutionEvents.parse(await deps.send(taskId, { id: newResourceId(), type: 'readBusinessExecutionEvents', executionId, after: observed.persistedThrough, limit: 1000 }));
    await deps.store.ingest(taskId, receipt, events);
  }
  const current = (await deps.store.get(taskId, executionId))!;
  if (current.persistedThrough > current.acknowledgedThrough) {
    await deps.send(taskId, { id: newResourceId(), type: 'ackBusinessExecutionEvents', executionId, through: current.persistedThrough });
    await deps.store.acknowledge(taskId, executionId, current.persistedThrough);
  }
}
