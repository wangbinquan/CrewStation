import { integer, text, timestamp } from 'drizzle-orm/pg-core';
import { jsonDocument } from '@crewstation/persistence';
import type { ExecutionHandoffOperation } from '../../../domain/executionHandoff';
import { releaseSchema } from '../schema';

export const executionHandoffs = releaseSchema.table('execution_handoffs', {
  id: text('id').primaryKey(), requestKey: text('request_key').notNull(), serviceId: text('service_id').notNull(), stage: text('stage').notNull(),
  body: jsonDocument('body').$type<ExecutionHandoffOperation>().notNull(), revision: integer('revision').notNull().default(0),
  owner: text('owner'), leaseUntil: timestamp('lease_until', { withTimezone: true }), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
