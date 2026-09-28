import { and, eq } from 'drizzle-orm';
import { integer as pgInteger, primaryKey, text } from 'drizzle-orm/pg-core';
import type { Executor } from '@crewstation/persistence';
import { jsonDocument } from '@crewstation/persistence';
import { conflict } from '@crewstation/kernel';
import type { ObjectEndpointStore, StoredObjectEndpoint } from '../../ports/objectPlane';
import { dataControlSchema } from './schema';

const endpoints = dataControlSchema.table('object_endpoints', {
  backendId: text('backend_id').notNull(), placementRevision: pgInteger('placement_revision').notNull(),
  body: jsonDocument('body').$type<StoredObjectEndpoint>().notNull(),
}, (t) => [primaryKey({ columns: [t.backendId, t.placementRevision] })]);

export function objectEndpointStore(db: Executor): ObjectEndpointStore {
  const predicate = (id: string, revision: number) => and(eq(endpoints.backendId, id), eq(endpoints.placementRevision, revision));
  return {
    get: async (id, revision) => (await db.select().from(endpoints).where(predicate(id, revision)))[0]?.body,
    put: (record) => db.transaction(async (tx) => {
      if (record.credentialRevision === 1) await tx.insert(endpoints).values({ backendId: record.backendId, placementRevision: record.placementRevision, body: record }).onConflictDoNothing();
      const original = (await tx.select().from(endpoints).where(predicate(record.backendId, record.placementRevision)).for('update'))[0]?.body;
      if (!original) throw conflict('对象后端尚未安装首个凭据版本');
      if (record.credentialRevision < original.credentialRevision) throw conflict('对象凭据版本已更新');
      if (record.endpoint !== original.endpoint || record.region !== original.region || record.bucket !== original.bucket) throw conflict('对象位置不能随凭据轮换改变');
      if (record.credentialRevision === original.credentialRevision) return original;
      if (record.credentialRevision !== original.credentialRevision + 1) throw conflict('对象凭据版本不连续');
      await tx.update(endpoints).set({ body: record }).where(predicate(record.backendId, record.placementRevision));
      return record;
    }),
  };
}
