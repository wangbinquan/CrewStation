import { boolean, index, text } from 'drizzle-orm/pg-core';
import { jsonDocument } from '@crewstation/persistence';
import type { DevelopmentUsagePrepared } from '../../ports/developmentUsage';
import type { DevelopmentUsageDrainReason, DevelopmentUsageRegistration } from '@crewstation/contracts';
import { devSessionSchema } from './schema';

/** Owner-private intent/nonce; Session receives only the original numeric registration. */
export const developmentAgentUsage = devSessionSchema.table('development_agent_usage', {
  executionTaskId: text('execution_task_id').primaryKey(),
  projectId: text('project_id').notNull(), workspaceTaskId: text('workspace_task_id').notNull(), acceptedAt: text('accepted_at').notNull(),
  prepared: jsonDocument('prepared').$type<DevelopmentUsagePrepared>().notNull(),
  binding: jsonDocument('binding').$type<DevelopmentUsageRegistration>(),
  unsupported: boolean('unsupported').notNull().default(false),
  capabilityPodUid: text('capability_pod_uid'),
  /** Durable fair recovery bookkeeping, not part of the original owner payload. */
  endingCheckedAt: text('ending_checked_at'),
  closeReason: text('close_reason').$type<DevelopmentUsageDrainReason>(),
}, (t) => [index('development_agent_usage_cohort').on(t.projectId, t.acceptedAt, t.executionTaskId)]);
