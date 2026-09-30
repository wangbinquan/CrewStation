import { integer, text, timestamp } from 'drizzle-orm/pg-core';
import { jsonDocument } from '@crewstation/persistence';
import type { NamespaceQuota } from '@crewstation/contracts';
import type { ResourcePolicyReceipt } from '../../ports/resourcePolicies';
import { projectSchema } from './schema';

export const namespaceQuotas = projectSchema.table('namespace_quotas', { projectId: text('project_id').primaryKey(), revision: integer('revision').notNull(), quota: jsonDocument('quota').$type<NamespaceQuota>().notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(), actorId: text('actor_id').notNull() });
export const resourcePolicyReceipts = projectSchema.table('resource_policy_receipts', { operationId: text('operation_id').primaryKey(), projectId: text('project_id').notNull(), body: jsonDocument('body').$type<ResourcePolicyReceipt>().notNull() });
