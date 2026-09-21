import { bigint, text, timestamp } from 'drizzle-orm/pg-core';
import { jsonDocument } from '@crewstation/persistence';
import type { ClusterHistoryResource } from '@crewstation/contracts';
import type { MetricsObservation, StorageResult } from '../../domain/observations';
import { clusterManagementSchema as schema } from './schema';

export const metricObservations = schema.table('metric_observations', { id: text('id').primaryKey(), createdAt: timestamp('created_at', { withTimezone: true }).notNull(), body: jsonDocument('body').$type<MetricsObservation>().notNull() });
export const metricCollectors = schema.table('metric_collectors', { kind: text('kind').primaryKey(), requestId: text('request_id').notNull(), fence: bigint('fence', { mode: 'number' }).notNull(), state: text('state').notNull(), requestedAt: timestamp('requested_at', { withTimezone: true }).notNull() });
export const metricStorage = schema.table('metric_storage', { id: text('id').primaryKey(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(), body: jsonDocument('body').$type<StorageResult[]>().notNull() });
export const metricHistory = schema.table('metric_history', { id: text('id').primaryKey(), lastSeen: timestamp('last_seen', { withTimezone: true }).notNull(), body: jsonDocument('body').$type<ClusterHistoryResource>().notNull() });
