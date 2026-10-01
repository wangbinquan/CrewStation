import { boolean, index, integer, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core';
import type { WorkloadAdmissionIdentity, WorkloadConsumer, WorkloadStartPermit, WorkloadStopProof, DevelopmentAdmissionState } from '@crewstation/contracts';
import { jsonDocument } from '@crewstation/persistence';
import { resourcesSchema } from '../schema';

export const storageFences = resourcesSchema.table('task_storage_fences', {
  taskId: text('task_id').primaryKey(), finalization: jsonDocument('finalization').$type<{ operationId: string; revision: number }>(),
  sealed: boolean('sealed').notNull().default(false),
});
export const stopScans = resourcesSchema.table('workload_stop_scans', {
  taskId: text('task_id').notNull(), revision: integer('revision').notNull(), scope: text('scope').notNull(),
  body: jsonDocument('body').$type<{ operationId: string; after: string | null; count: number; digest: string; complete: boolean }>().notNull(),
}, (t) => [primaryKey({ columns: [t.taskId, t.revision, t.scope] })]);
export const admissionClosures = resourcesSchema.table('workload_admission_closures', { id: text('id').primaryKey(), identity: jsonDocument('identity').$type<WorkloadAdmissionIdentity>().notNull() });
export const consumers = resourcesSchema.table('workload_consumers', {
  id: text('id').primaryKey(), taskId: text('task_id').notNull(), resourceId: text('resource_id').notNull(), namespace: text('namespace').notNull(), podName: text('pod_name').notNull(),
  consumer: jsonDocument('consumer').$type<WorkloadConsumer>().notNull(), admissionClosed: boolean('admission_closed').notNull().default(false),
  startPermit: jsonDocument('start_permit').$type<WorkloadStartPermit>(),
  developmentAdmission: jsonDocument('development_admission').$type<DevelopmentAdmissionState>(),
}, (t) => [uniqueIndex('workload_consumers_namespace_pod_name_key').on(t.namespace, t.podName), index('workload_consumers_task').on(t.taskId, t.id)]);
export const stopProofs = resourcesSchema.table('workload_stop_proofs', {
  consumerId: text('consumer_id').primaryKey().references(() => consumers.id), record: jsonDocument('record').$type<WorkloadStopProof>().notNull(),
});
