import { index, integer, text } from 'drizzle-orm/pg-core';
import { jsonDocument } from '@crewstation/persistence';
import type { DevelopmentEndingJob } from '../../../domain/developmentEnding';
import { devSessionSchema } from '../schema';

export const developmentAgentEndings = devSessionSchema.table('development_agent_endings', {
  executionTaskId: text('execution_task_id').primaryKey(), firstReason: text('first_reason').$type<DevelopmentEndingJob['firstReason']>().notNull(),
  observedAt: text('observed_at').notNull(), logicalResult: text('logical_result').$type<DevelopmentEndingJob['logicalResult']>(),
  actualEndedAt: text('actual_ended_at').$type<null>(), version: integer('version').notNull(), fence: integer('fence').notNull(),
  leaseUntil: text('lease_until'), lastAttemptAt: text('last_attempt_at').notNull(),
  stop: jsonDocument('stop').$type<DevelopmentEndingJob['stop']>(), closure: jsonDocument('closure').$type<DevelopmentEndingJob['closure']>(),
  stage: text('stage').$type<DevelopmentEndingJob['stage']>().notNull(),
}, (t) => [index('development_agent_endings_pending').on(t.stage, t.lastAttemptAt, t.executionTaskId)]);
