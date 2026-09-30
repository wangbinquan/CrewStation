import { text } from 'drizzle-orm/pg-core';
import { jsonDocument } from '@crewstation/persistence';
import { gatewaySchema } from './schema';

export const rateLimitReceipts = gatewaySchema.table('rate_limit_receipts', { operationId: text('operation_id').primaryKey(), projectId: text('project_id').notNull(), body: jsonDocument('body').$type<{ hash: string; revision: string; effect: string; applied: boolean }>().notNull() });
