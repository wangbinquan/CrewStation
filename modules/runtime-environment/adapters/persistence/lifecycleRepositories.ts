import type { Executor } from '@crewstation/persistence';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import type { DevelopmentPolicyRepository, LogRepository, ReferenceRepository } from '../../ports/repositories';
import { developmentImagePolicies, imageLogs, imageReferences } from './tables';

export function referenceRepository(db: Executor): ReferenceRepository {
  return {
    scan: async (after, limit) => (await db.select().from(imageReferences).where(after ? gt(imageReferences.id, after) : undefined).orderBy(asc(imageReferences.id)).limit(limit)).map((row) => row.payload),
    get: async (versionId, ownerType, ownerId) => (await db.select().from(imageReferences).where(and(eq(imageReferences.versionId, versionId), eq(imageReferences.ownerType, ownerType), eq(imageReferences.ownerId, ownerId))))[0]?.payload,
    insert: async (v) => { await db.insert(imageReferences).values({ id: v.id, versionId: v.versionId, projectId: v.projectId, ownerType: v.ownerType, ownerId: v.ownerId, payload: v }); },
    update: async (v) => { await db.update(imageReferences).set({ payload: v }).where(eq(imageReferences.id, v.id)); },
    remove: async (id) => { await db.delete(imageReferences).where(eq(imageReferences.id, id)); },
    list: async (versionId) => (await db.select().from(imageReferences).where(eq(imageReferences.versionId, versionId)).orderBy(asc(imageReferences.id))).map((r) => r.payload),
  };
}
export function logRepository(db: Executor): LogRepository {
  return {
    append: async (buildId, chunk) => { await db.insert(imageLogs).values({ buildId, stage: chunk.stage, text: chunk.text, createdAt: new Date(chunk.createdAt) }); },
    page: async (buildId, after, limit) => (await db.select().from(imageLogs).where(and(eq(imageLogs.buildId, buildId), gt(imageLogs.sequence, after))).orderBy(asc(imageLogs.sequence)).limit(limit)).map((r) => ({ sequence: r.sequence, stage: r.stage, text: r.text, createdAt: r.createdAt.toISOString() })),
    bytes: async (buildId) => Number((await db.select({ n: sql<string>`coalesce(sum(octet_length(${imageLogs.text})), 0)` }).from(imageLogs).where(eq(imageLogs.buildId, buildId)))[0]!.n),
  };
}
export function developmentPolicyRepository(db: Executor): DevelopmentPolicyRepository {
  return {
    get: async (projectId) => (await db.select().from(developmentImagePolicies).where(eq(developmentImagePolicies.projectId, projectId)))[0]?.payload,
    save: async (v) => { await db.insert(developmentImagePolicies).values({ projectId: v.projectId, payload: v }).onConflictDoUpdate({ target: developmentImagePolicies.projectId, set: { payload: v } }); },
  };
}
