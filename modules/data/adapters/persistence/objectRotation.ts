import { and, eq } from 'drizzle-orm';
import { primaryKey, text } from 'drizzle-orm/pg-core';
import type { Database } from '@crewstation/persistence';
import { jsonDocument } from '@crewstation/persistence';
import type { ObjectCredentialRotationRecord, ObjectCredentialRotations } from '../../ports/objectRotation';
import { assertSameStorageRequest, assertStorageRevision } from '../../domain/objectStorage';
import { assertObjectStorageUnfrozen, objectStorageTransaction, requireObjectBackend, saveObjectBackend } from './objectCatalog';
import { dataSchema } from './schema';

const rotations = dataSchema.table('object_credential_rotations', {
  backendId: text('backend_id').notNull(), requestKey: text('request_key').notNull(), body: jsonDocument('body').$type<ObjectCredentialRotationRecord>().notNull(),
}, (t) => [primaryKey({ columns: [t.backendId, t.requestKey] })]);
const key = (id: string, request: string) => and(eq(rotations.backendId, id), eq(rotations.requestKey, request));
export function objectCredentialRotations(db: Database): ObjectCredentialRotations {
  return {
    get: async (id, request) => (await db.select().from(rotations).where(key(id, request)))[0]?.body,
    commit: (input, apply) => objectStorageTransaction(db, async (tx, now) => {
      const previous = (await tx.select().from(rotations).where(key(input.backendId, input.requestKey)))[0]?.body;
      if (previous) { assertSameStorageRequest(previous.digest, input.digest); return previous.backend; }
      const original = await requireObjectBackend(tx, input.backendId); assertStorageRevision(original.revision, input.expectedRevision);
      await assertObjectStorageUnfrozen(tx, original.id);
      const backend = { ...original, revision: original.revision + 1, credentialRevision: original.credentialRevision + 1, health: 'unknown' as const, observedAt: null, message: '凭据已更新，等待后端健康观测' };
      await apply(tx, backend.credentialRevision);
      await saveObjectBackend(tx, backend);
      const { expectedRevision: _revision, ...audit } = input;
      await tx.insert(rotations).values({ backendId: input.backendId, requestKey: input.requestKey, body: { ...audit, backend, createdAt: now.toISOString() } });
      return backend;
    }),
  };
}
