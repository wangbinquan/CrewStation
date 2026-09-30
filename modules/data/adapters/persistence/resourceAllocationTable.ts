import { text } from 'drizzle-orm/pg-core';
import { jsonDocument } from '@crewstation/persistence';
import type { ObjectResourceReceipt } from '../../domain/resourceAllocation';
import { dataSchema } from './schema';

export const resourceAllocations = dataSchema.table('resource_allocations', { operationId: text('operation_id').primaryKey(), projectId: text('project_id').notNull(), body: jsonDocument('body').$type<ObjectResourceReceipt>().notNull() });
