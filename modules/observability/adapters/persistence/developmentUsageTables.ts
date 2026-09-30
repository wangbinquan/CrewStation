import { bigint, text, primaryKey } from 'drizzle-orm/pg-core';
import { jsonDocument } from '@crewstation/persistence';
import type { DevelopmentModelEvidence } from '../../domain/developmentModelEvidence';
import { observabilitySchema } from './schema';

/** Numeric evidence and prices remain in their existing tables. */
export const developmentModelEvidence = observabilitySchema.table('development_model_evidence', {
  meterKey: text('meter_key').notNull(), revision: bigint('revision', { mode: 'number' }).notNull(),
  fingerprint: text('fingerprint').notNull(), document: jsonDocument('document').$type<DevelopmentModelEvidence>().notNull(),
}, (t) => [primaryKey({ columns: [t.meterKey, t.revision] })]);
