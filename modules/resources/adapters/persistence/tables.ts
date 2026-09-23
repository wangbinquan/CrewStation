import { jsonDocument } from '@crewstation/persistence';
import { bigint, bigserial, boolean, integer, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { resourcesSchema } from './schema';

const at = (name: string) => timestamp(name, { withTimezone: true });

export const records = resourcesSchema.table('records', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  projectId: text('project_id'),
  ownerModule: text('owner_module').notNull(),
  ownerRef: text('owner_ref').notNull(),
  parentId: text('parent_id'),
  purpose: text('purpose'),
  desired: text('desired').notNull(),
  spec: jsonDocument('spec').notNull(),
  generation: integer('generation').notNull(),
  observedGeneration: integer('observed_generation').notNull(),
  releaseReason: jsonDocument('release_reason'),
  status: jsonDocument('status').notNull(),
  phase: text('phase').notNull(),
  phaseSince: at('phase_since').notNull(),
  idleSince: at('idle_since'),
  retainUntil: at('retain_until'),
  version: bigint('version', { mode: 'number' }).notNull(),
  createdAt: at('created_at').notNull(),
  updatedAt: at('updated_at').notNull(),
  compactedAt: at('compacted_at'),
});

export const children = resourcesSchema.table('children', {
  resourceId: text('resource_id').notNull(),
  kind: text('kind').notNull(),
  namespace: text('namespace').notNull(),
  name: text('name').notNull(),
  uid: text('uid'),
  expected: boolean('expected').notNull(),
  observed: jsonDocument('observed'),
  observedAt: at('observed_at'),
}, (t) => [primaryKey({ columns: [t.resourceId, t.kind, t.namespace, t.name] })]);

export const changes = resourcesSchema.table('changes', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  seq: bigint('seq', { mode: 'number' }),
  projectId: text('project_id'),
  resourceId: text('resource_id').notNull(),
  version: bigint('version', { mode: 'number' }).notNull(),
  change: text('change').notNull(),
  at: at('at').notNull().defaultNow(),
});

export const leases = resourcesSchema.table('leases', {
  resourceId: text('resource_id').primaryKey(),
  holder: text('holder').notNull(),
  expiresAt: at('expires_at').notNull(),
});

export const aliases = resourcesSchema.table('aliases', {
  source: text('source').notNull(),
  alias: text('alias').notNull(),
  resourceId: text('resource_id').notNull(),
}, (t) => [primaryKey({ columns: [t.source, t.alias] })]);

export const projectLocks = resourcesSchema.table('project_locks', {
  projectId: text('project_id').primaryKey(),
});
