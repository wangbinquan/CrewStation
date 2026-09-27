import type { TaskId } from '@crewstation/contracts';
import { boolean, integer, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { jsonDocument } from '@crewstation/persistence';
import type { BusinessSubtaskV3Dto, RunnerBusinessReceipt } from '@crewstation/contracts';
import { businessTaskSchema } from '../schema';

export const executionSubtasks = businessTaskSchema.table('execution_subtasks', {
  id: text('id').primaryKey(), serviceId: text('service_id').notNull(), taskId: text('task_id').notNull(), requestKey: text('request_key').notNull(),
  sessionKey: text('session_key').$type<TaskId>(),
  sessionVolumeUid: text('session_volume_uid'),
  runtimeDispatched: boolean('runtime_dispatched').notNull().default(false),
  runtimeAdmitted: boolean('runtime_admitted').notNull().default(false),
  runtimeReleased: boolean('runtime_released').notNull().default(false),
  runtimeTaskId: text('runtime_task_id').$type<TaskId>(),
  requestKind: text('request_kind').notNull().default('submit'), requestParent: text('request_parent').notNull().default(''),
  requestDigest: text('request_digest').notNull(), sealedPayload: text('sealed_payload').notNull(), payloadDigest: text('payload_digest').notNull(),
  fenced: boolean('fenced').notNull(), epoch: integer('epoch'), view: jsonDocument('view').$type<BusinessSubtaskV3Dto>().notNull(),
  dispatch: text('dispatch').notNull(), incarnation: text('incarnation'), receipt: jsonDocument('receipt').$type<RunnerBusinessReceipt>(),
  revision: integer('revision').notNull().default(0), owner: text('owner'), leaseUntil: timestamp('lease_until', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (t) => [uniqueIndex('execution_subtasks_request').on(t.serviceId, t.taskId, t.requestKind, t.requestParent, t.requestKey)]);
