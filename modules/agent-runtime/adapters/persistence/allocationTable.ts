import { text } from 'drizzle-orm/pg-core';
import { jsonDocument } from '@crewstation/persistence';
import type { ComputeAllocationReceipt } from '../../domain/resourceAllocation';
import { agentRuntimeSchema } from './schema';

export const allocationReceipts = agentRuntimeSchema.table('allocation_receipts', { operationId: text('operation_id').primaryKey(), projectId: text('project_id').notNull(), body: jsonDocument('body').$type<ComputeAllocationReceipt>().notNull() });
