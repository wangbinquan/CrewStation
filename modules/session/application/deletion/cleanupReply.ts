import type { RunnerCommand, TaskId } from '@crewstation/contracts';
import { BusinessExecutionReceiptSchema, RunnerResultPayloads } from '@crewstation/contracts';
import type { SessionCleanupOriginal } from '../../domain/deletion/cleanupCommand';
import type { BusinessExecutionStore } from '../../ports/businessExecutions';
import { z } from 'zod';

const businessAck = z.strictObject({});

/** Real replies are copied to PG before the private caller can advance to another page or ACK. */
export async function persistSessionCleanupReply(business: BusinessExecutionStore,
  taskId: TaskId, command: RunnerCommand, original: SessionCleanupOriginal, payload: unknown) {
  switch (command.type) {
    case 'getBusinessExecution': case 'cancelBusinessExecution':
      await business.ingest(taskId, BusinessExecutionReceiptSchema.parse(payload), []); return;
    case 'readBusinessExecutionEvents':
      await business.ingest(taskId, original.business!.receipt, RunnerResultPayloads.businessExecutionEvents.parse(payload)); return;
    case 'ackBusinessExecutionEvents': {
      // The actual Runner ACK returns {}; its original command ID and committed watermark are fenced by the private wire.
      businessAck.parse(payload);
      await business.acknowledge(taskId, command.executionId, command.through); return;
    }
    default: return;
  }
}
