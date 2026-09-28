import { integer, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { jsonDocument } from '@crewstation/persistence';
import type { FinalizationOperation } from '../../../domain/finalization/operation';
import type { FinalizationRevision } from '../../../domain/finalization/revision';
import { businessTaskSchema } from '../schema';

export const finalizations = businessTaskSchema.table('finalizations', {
  id: text('id').primaryKey(), serviceId: text('service_id').notNull(), taskId: text('task_id').notNull(),
  body: jsonDocument('body').$type<FinalizationOperation>().notNull(), phase: text('phase').notNull(),
  sequence: integer('sequence').notNull().default(0), leaseOwner: text('lease_owner'), leaseUntil: timestamp('lease_until', { withTimezone: true }),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('finalizations_task').on(t.taskId)]);

export const finalizationRevisions = businessTaskSchema.table('finalization_revisions', {
  id: text('id').primaryKey(), finalizationId: text('finalization_id').notNull(), requestKey: text('request_key').notNull(), body: jsonDocument('body').$type<FinalizationRevision>().notNull(),
}, (t) => [uniqueIndex('finalization_revisions_request').on(t.finalizationId, t.requestKey)]);
