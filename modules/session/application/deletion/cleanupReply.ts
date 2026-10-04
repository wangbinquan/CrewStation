import type { RunnerCommand, TaskId } from '@crewstation/contracts';
import { BusinessExecutionReceiptSchema, DevelopmentUsagePageSchema, RunnerResultPayloads } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { SessionCleanupOriginal } from '../../domain/deletion/cleanupCommand';
import type { BusinessExecutionStore } from '../../ports/businessExecutions';
import type { DevelopmentUsageStore } from '../../ports/developmentUsage';
import { persistDevelopmentReply } from '../developmentCommandReceipt';
import { z } from 'zod';

const businessAck = z.strictObject({});

/** Real replies are copied to PG before the private caller can advance to another page or ACK. */
export async function persistSessionCleanupReply(business: BusinessExecutionStore, development: DevelopmentUsageStore,
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
    case 'readDevelopmentUsageEvents': {
      const stored = await development.get(taskId, original.development!.registration.key);
      if (!stored?.receipt) throw precondition('会话清理尚未持久读取原开发数字回执');
      await development.ingest(taskId, stored.receipt, DevelopmentUsagePageSchema.parse(payload)); return;
    }
    default: await persistDevelopmentReply(development, taskId, command, payload);
  }
}
