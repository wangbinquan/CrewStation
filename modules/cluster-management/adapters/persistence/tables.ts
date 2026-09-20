import { bigserial, bigint, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { jsonDocument } from '@crewstation/persistence';
import type { ClusterInspection, ClusterOperation } from '@crewstation/contracts';
import type { InventorySnapshot } from '../../domain/inventory';
import { clusterManagementSchema as schema } from './schema';
export const snapshots = schema.table('snapshots', { sequence: bigserial('sequence', { mode: 'number' }).notNull(), id: text('id').primaryKey(), createdAt: timestamp('created_at', { withTimezone: true }).notNull(), body: jsonDocument('body').$type<InventorySnapshot>().notNull() });
export const inspections = schema.table('inspections', { id: text('id').primaryKey(), actorId: text('actor_id').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull(), body: jsonDocument('body').$type<ClusterInspection>().notNull() });
export const operations = schema.table('operations', { id: text('id').primaryKey(), actorId: text('actor_id').notNull(), key: text('idempotency_key').notNull(), requestHash: text('request_hash').notNull(), fence: bigint('fence', { mode: 'number' }).default(0).notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull(), body: jsonDocument('body').$type<ClusterOperation>().notNull() }, (t) => [uniqueIndex('operations_actor_key').on(t.actorId, t.key)]);
export const refreshes = schema.table('refreshes', { id: text('id').primaryKey(), requestId: text('request_id').notNull(), requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(), state: text('state').notNull() });

/** Platform identity is persistent; Kubernetes UID remains an external instance key. */
export const resourceIdentities = schema.table('resource_identities', { id: text('id').primaryKey(), uid: text('uid').notNull().unique() });

export const refreshHistory = schema.table('refresh_history', { id: text('id').primaryKey() });
