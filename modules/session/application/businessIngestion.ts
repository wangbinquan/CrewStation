import type { RunnerCommand, TaskId } from '@crewstation/contracts';
import { BusinessExecutionReceiptSchema, RunnerResultPayloads } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import type { Logger } from '@crewstation/kernel';
import { noopLogger } from '@crewstation/kernel';
import type { AgentCallSink } from '../ports/agentCallSink';
import type { BusinessExecutionStore, StoredBusinessExecution } from '../ports/businessExecutions';
import { forwardBusinessEvents } from './agentCallForwarding';

export interface BusinessIngestionDeps {
  store: BusinessExecutionStore;
  send(taskId: TaskId, command: RunnerCommand): Promise<unknown>;
  /** RFC-034 v2：业务 Agent 的执行快照与终态交给观测。 */
  agentCalls?: AgentCallSink;
  logger?: Logger;
}

/** 先提交 session PG，再确认 Runner；断线和丢确认都从持久水位重入。 */
export async function ingestBusinessExecution(deps: BusinessIngestionDeps, stream: StoredBusinessExecution): Promise<void> {
  const executionId = stream.receipt.executionId, taskId = stream.taskId;
  const receipt = BusinessExecutionReceiptSchema.parse(await deps.send(taskId, { id: newResourceId(), type: 'getBusinessExecution', executionId }));
  const observed = await deps.store.ingest(taskId, receipt, []);
  if (observed.persistedThrough < receipt.lastSequence) {
    const events = RunnerResultPayloads.businessExecutionEvents.parse(await deps.send(taskId, { id: newResourceId(), type: 'readBusinessExecutionEvents', executionId, after: observed.persistedThrough, limit: 1000 }));
    await deps.store.ingest(taskId, receipt, events);
    // 先提交 session PG，再转交观测；崩溃后从持久水位重入时重复转交是幂等的。
    await forwardBusinessEvents(deps.agentCalls, deps.logger ?? noopLogger, taskId, events);
  }
  const current = (await deps.store.get(taskId, executionId))!;
  if (current.persistedThrough > current.acknowledgedThrough) {
    await deps.send(taskId, { id: newResourceId(), type: 'ackBusinessExecutionEvents', executionId, through: current.persistedThrough });
    await deps.store.acknowledge(taskId, executionId, current.persistedThrough);
  }
}
