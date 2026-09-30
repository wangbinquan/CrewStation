import { text } from 'drizzle-orm/pg-core';
import { jsonDocument } from '@crewstation/persistence';
import type { ApiAllocationReceipt } from '../../ports/allocations';
import { apiCatalogSchema } from './schema';

export const allocationReceipts = apiCatalogSchema.table('allocation_receipts', { operationId: text('operation_id').primaryKey(), serviceId: text('service_id').notNull(), body: jsonDocument('body').$type<ApiAllocationReceipt>().notNull() });
