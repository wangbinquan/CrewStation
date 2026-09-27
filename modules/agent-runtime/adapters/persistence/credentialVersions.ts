import { and, eq } from 'drizzle-orm';
import { boolean, integer, primaryKey, text } from 'drizzle-orm/pg-core';
import type { Executor } from '@crewstation/persistence';
import { jsonDocument } from '@crewstation/persistence';
import type { CredentialVersion } from '../../domain/credentialVersion';
import type { CredentialVersions } from '../../ports/credentialVersions';
import { agentRuntimeSchema } from './schema';

export const credentialVersions = agentRuntimeSchema.table('credential_versions', {
  profileId: text('profile_id').notNull(), revision: integer('revision').notNull(), stamp: text('stamp').notNull(),
  credentials: jsonDocument('credentials').$type<CredentialVersion['credentials']>().notNull(), revoked: boolean('revoked').notNull().default(false),
}, (t) => [primaryKey({ columns: [t.profileId, t.revision, t.stamp] })]);
export function drizzleCredentialVersions(db: Executor): CredentialVersions {
  return {
    get: async (id, revision, stamp) => (await db.select().from(credentialVersions).where(and(eq(credentialVersions.profileId, id), eq(credentialVersions.revision, revision), eq(credentialVersions.stamp, stamp))))[0],
    save: async (version) => { await db.insert(credentialVersions).values(version).onConflictDoNothing(); },
  };
}
