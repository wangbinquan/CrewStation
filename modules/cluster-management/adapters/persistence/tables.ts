import { pgSchema, bigserial, bigint, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { jsonDocument } from '@crewstation/persistence';
import type { ClusterInspection, ClusterOperation, ClusterHistoryResource } from '@crewstation/contracts';
import type { InventorySnapshot, MetricsObservation, StorageResult } from '../../domain/observations';

/** 本模块唯一允许使用的 PostgreSQL schema；所有表都定义在它之下。 */
export const clusterManagementSchema = pgSchema('cluster_management');
const schema = clusterManagementSchema;

export const snapshots = schema.table('snapshots', { sequence: bigserial('sequence', { mode: 'number' }).notNull(), id: text('id').primaryKey(), createdAt: timestamp('created_at', { withTimezone: true }).notNull(), body: jsonDocument('body').$type<InventorySnapshot>().notNull() });
export const inspections = schema.table('inspections', { id: text('id').primaryKey(), actorId: text('actor_id').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull(), body: jsonDocument('body').$type<ClusterInspection>().notNull() });
export const operations = schema.table('operations', { id: text('id').primaryKey(), actorId: text('actor_id').notNull(), key: text('idempotency_key').notNull(), requestHash: text('request_hash').notNull(), fence: bigint('fence', { mode: 'number' }).default(0).notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull(), body: jsonDocument('body').$type<ClusterOperation>().notNull() }, (t) => [uniqueIndex('operations_actor_key').on(t.actorId, t.key)]);
export const refreshes = schema.table('refreshes', { id: text('id').primaryKey(), requestId: text('request_id').notNull(), requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(), state: text('state').notNull() });

/** Platform identity is persistent; Kubernetes UID remains an external instance key. */
export const resourceIdentities = schema.table('resource_identities', { id: text('id').primaryKey(), uid: text('uid').notNull().unique() });

export const refreshHistory = schema.table('refresh_history', { id: text('id').primaryKey() });

export const metricObservations = schema.table('metric_observations', { id: text('id').primaryKey(), createdAt: timestamp('created_at', { withTimezone: true }).notNull(), body: jsonDocument('body').$type<MetricsObservation>().notNull() });
export const metricCollectors = schema.table('metric_collectors', { kind: text('kind').primaryKey(), requestId: text('request_id').notNull(), fence: bigint('fence', { mode: 'number' }).notNull(), state: text('state').notNull(), requestedAt: timestamp('requested_at', { withTimezone: true }).notNull() });
export const metricStorage = schema.table('metric_storage', { id: text('id').primaryKey(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(), body: jsonDocument('body').$type<StorageResult[]>().notNull() });
export const metricHistory = schema.table('metric_history', { id: text('id').primaryKey(), lastSeen: timestamp('last_seen', { withTimezone: true }).notNull(), body: jsonDocument('body').$type<ClusterHistoryResource>().notNull() });
