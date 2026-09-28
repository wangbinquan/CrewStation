import type { AcceptedExecutionPrice } from '../../ports/tokenPricing';
import { bigint, integer, text, primaryKey, uniqueIndex } from 'drizzle-orm/pg-core';
import { jsonDocument } from '@crewstation/persistence';
import type { TokenPriceVersion, ExecutionCostVisibilityDto } from '@crewstation/contracts';
import { observabilitySchema } from './schema';

export const tokenPriceHeads = observabilitySchema.table('token_price_heads', {
  profileId: text('profile_id').primaryKey(), revision: integer('revision').notNull(),
});
export const tokenPrices = observabilitySchema.table('token_prices', {
  profileId: text('profile_id').notNull(), revision: integer('revision').notNull(),
  id: text('id').notNull(), requestKey: text('request_key').notNull(),
  fingerprint: text('fingerprint').notNull(),
  profileRevision: integer('profile_revision').notNull(), protocol: text('protocol').notNull(),
  provider: text('provider').notNull(), model: text('model').notNull(),
  condition: text('condition'), effectiveFrom: text('effective_from').notNull(),
  document: jsonDocument('document').$type<TokenPriceVersion>().notNull(),
}, (table) => [
  primaryKey({ columns: [table.profileId, table.revision] }),
  uniqueIndex('token_price_request_key').on(table.profileId, table.requestKey),
  uniqueIndex('token_price_id').on(table.id),
]);

export const costVisibility = observabilitySchema.table('cost_visibility', {
  projectId: text('project_id').primaryKey(), revision: bigint('revision', { mode: 'number' }).notNull(),
  document: jsonDocument('document').$type<ExecutionCostVisibilityDto>().notNull(),
});
export const costVisibilityReceipts = observabilitySchema.table('cost_visibility_receipts', {
  projectId: text('project_id').notNull(), requestKey: text('request_key').notNull(), fingerprint: text('fingerprint').notNull(),
  document: jsonDocument('document').$type<ExecutionCostVisibilityDto>().notNull(),
}, (t) => [primaryKey({ columns: [t.projectId, t.requestKey] })]);

export const acceptedExecutionPrices = observabilitySchema.table('accepted_execution_prices', {
  executionId: text('execution_id').notNull(), generation: bigint('generation', { mode: 'number' }).notNull(),
  fingerprint: text('fingerprint').notNull(), document: jsonDocument('document').$type<AcceptedExecutionPrice>().notNull(),
}, (t) => [primaryKey({ columns: [t.executionId, t.generation] })]);
