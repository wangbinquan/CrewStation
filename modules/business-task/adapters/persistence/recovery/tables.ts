import { bigint, text, timestamp } from 'drizzle-orm/pg-core';
import { jsonDocument } from '@crewstation/persistence';
import type { BusinessRecoveryRequest, BusinessRecoveryTarget } from '@crewstation/contracts';
import { BusinessRecoveryRequestSchema } from '@crewstation/contracts';
import { businessTaskSchema } from '../schema';

export const recoveryRequests = businessTaskSchema.table('recovery_requests', {
  id: text('id').primaryKey(), serviceId: text('service_id').notNull(), projectId: text('project_id').notNull(), taskId: text('task_id').notNull(),
  targetKey: text('target_key').notNull(), requestKey: text('request_key').notNull(), requestDigest: text('request_digest').notNull(), requestedBy: text('requested_by').notNull(),
  target: jsonDocument('target').$type<BusinessRecoveryTarget>().notNull(), assessmentDigest: text('assessment_digest').notNull(),
  state: text('state').$type<BusinessRecoveryRequest['state']>().notNull(), claimId: text('claim_id'), claimEpoch: bigint('claim_epoch', { mode: 'number' }), claimHolder: text('claim_holder'), claimPodUid: text('claim_pod_uid'), leaseUntil: timestamp('lease_until', { withTimezone: true }),
  operationId: text('operation_id'), resultTaskId: text('result_task_id'), resultSubtaskId: text('result_subtask_id'), reason: text('reason'),
  observedAt: timestamp('observed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});
export const recoveryAudit = businessTaskSchema.table('recovery_audit', {
  id: text('id').primaryKey(), requestId: text('request_id').notNull(), event: text('event').notNull(), actor: text('actor').notNull(),
  epoch: bigint('epoch', { mode: 'number' }), at: timestamp('at', { withTimezone: true }).notNull(),
});
export function recoveryView(row: typeof recoveryRequests.$inferSelect): BusinessRecoveryRequest {
  return BusinessRecoveryRequestSchema.parse({ id: row.id, serviceId: row.serviceId, projectId: row.projectId, requestedBy: row.requestedBy, requestKey: row.requestKey, target: row.target,
    assessmentDigest: row.assessmentDigest, state: row.state, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    ...(row.operationId ? { operationId: row.operationId } : {}), ...(row.resultTaskId ? { resultTaskId: row.resultTaskId } : {}),
    ...(row.resultSubtaskId ? { resultSubtaskId: row.resultSubtaskId } : {}), ...(row.reason ? { reason: row.reason } : {}),
  });
}
