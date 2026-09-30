import { text } from 'drizzle-orm/pg-core';
import { jsonDocument } from '@crewstation/persistence';
import type { ImageAllocationReceipt } from '../../domain/allocation';
import { runtimeEnvironmentSchema } from './schema';

export const allocationReceipts = runtimeEnvironmentSchema.table('allocation_receipts', { operationId: text('operation_id').primaryKey(), projectId: text('project_id').notNull(), payload: jsonDocument('payload').$type<ImageAllocationReceipt>().notNull() });
