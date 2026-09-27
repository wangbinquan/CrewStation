import type { Executor } from '@crewstation/persistence';
import { and, asc, count, desc, eq, inArray, isNull, lt, lte, notInArray, or } from 'drizzle-orm';
import type { BuildRepository, ValidationRepository } from '../../ports/repositories';
import { imageBuilds, imageValidations } from './tables';

export function buildRepository(db: Executor): BuildRepository {
  return {
    get: async (id, lock) => { const q = db.select().from(imageBuilds).where(eq(imageBuilds.id, id)); return (await (lock ? q.for('update') : q))[0]?.payload; },
    findRequest: async (imageId, actorId, key) => (await db.select().from(imageBuilds).where(and(eq(imageBuilds.imageId, imageId), eq(imageBuilds.actorId, actorId), eq(imageBuilds.requestKey, key))))[0]?.payload,
    insert: async (v) => { await db.insert(imageBuilds).values({ id: v.id, imageId: v.imageId, projectId: v.projectId, actorId: v.createdBy, requestKey: v.requestKey, state: v.state, payload: v }); },
    update: async (v) => { await db.update(imageBuilds).set({ state: v.state, leaseUntil: v.leaseUntil ? new Date(v.leaseUntil) : null, payload: v }).where(eq(imageBuilds.id, v.id)); },
    list: async (imageId, page) => (await db.select().from(imageBuilds).where(and(eq(imageBuilds.imageId, imageId), page.before ? lt(imageBuilds.id, page.before) : undefined)).orderBy(desc(imageBuilds.id)).limit(page.limit)).map((r) => r.payload),
    activeCount: async (projectId) => (await db.select({ n: count() }).from(imageBuilds).where(and(projectId ? eq(imageBuilds.projectId, projectId) : undefined, notInArray(imageBuilds.state, ['succeeded', 'failed', 'cancelled']))))[0]!.n,
    runnable: async (at, limit) => (await db.select().from(imageBuilds).where(and(notInArray(imageBuilds.state, ['succeeded', 'failed', 'cancelled']), or(isNull(imageBuilds.leaseUntil), lte(imageBuilds.leaseUntil, new Date(at))))).orderBy(asc(imageBuilds.id)).limit(limit)).map((r) => r.payload),
  };
}
export function validationRepository(db: Executor): ValidationRepository {
  return {
    get: async (id, lock) => { const q = db.select().from(imageValidations).where(eq(imageValidations.id, id)); return (await (lock ? q.for('update') : q))[0]?.payload; },
    insert: async (v) => { await db.insert(imageValidations).values({ id: v.id, versionId: v.versionId, actorId: v.createdBy, requestKey: v.requestKey, contractDigest: v.contractDigest, state: v.state, payload: v }); },
    update: async (v) => { await db.update(imageValidations).set({ state: v.state, leaseUntil: v.leaseUntil ? new Date(v.leaseUntil) : null, payload: v }).where(eq(imageValidations.id, v.id)); },
    list: async (versionId) => (await db.select().from(imageValidations).where(eq(imageValidations.versionId, versionId)).orderBy(desc(imageValidations.id))).map((r) => r.payload),
    findRequest: async (versionId, actorId, key) => (await db.select().from(imageValidations).where(and(eq(imageValidations.versionId, versionId), eq(imageValidations.actorId, actorId), eq(imageValidations.requestKey, key))))[0]?.payload,
    findPassed: async (versionId, contractDigest) => (await db.select().from(imageValidations).where(and(eq(imageValidations.versionId, versionId), eq(imageValidations.contractDigest, contractDigest), eq(imageValidations.state, 'passed'))).orderBy(desc(imageValidations.id)).limit(1))[0]?.payload,
    runnable: async (at, limit) => (await db.select().from(imageValidations).where(and(inArray(imageValidations.state, ['queued', 'running', 'cancelling']), or(isNull(imageValidations.leaseUntil), lte(imageValidations.leaseUntil, new Date(at))))).orderBy(asc(imageValidations.id)).limit(limit)).map((r) => r.payload),
  };
}
