import { integer, primaryKey, text } from 'drizzle-orm/pg-core';
import { jsonDocument } from '@crewstation/persistence';
import type { ArchiveFileResult, ArchiveHelperGrant } from '../../../domain/archiveHelper';
import { dataSchema } from '../schema';

export const archiveHelperGrants = dataSchema.table('archive_helper_grants', {
  id: text('id').primaryKey(), bindingId: text('binding_id').notNull(), revision: integer('revision').notNull(),
  body: jsonDocument('body').$type<ArchiveHelperGrant>().notNull(),
});
export const archiveHelperClosures = dataSchema.table('archive_helper_closures', { id: text('id').primaryKey() });
export const archiveFileResults = dataSchema.table('archive_file_results', {
  bindingId: text('binding_id').notNull(), revision: integer('revision').notNull(), path: text('path').notNull(),
  body: jsonDocument('body').$type<ArchiveFileResult>().notNull(),
}, (t) => [primaryKey({ columns: [t.bindingId, t.revision, t.path] })]);
