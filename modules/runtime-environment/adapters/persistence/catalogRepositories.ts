import { readAdminCatalog } from './catalogSummary';
import type { Executor } from '@crewstation/persistence';
import { and, desc, eq, lt, max, or, inArray, sql, exists } from 'drizzle-orm';
import type { ImageRepository, RevisionRepository, VersionRepository } from '../../ports/repositories';
import { imageRevisions, imageVersions, runtimeImages, imageProjectGrants, projectImagePolicies } from './tables';

export function imageRepository(db: Executor): ImageRepository {
  return {
    listAll: (page) => readAdminCatalog(db, page),
    get: async (id, lock) => { const q = db.select().from(runtimeImages).where(eq(runtimeImages.id, id)); return (await (lock ? q.for('update') : q))[0]?.payload; },
    list: async (projectId, page, includeShared = false, policy) => (await db.select().from(runtimeImages).where(and(
      policy?.mode === 'restricted' ? (policy.allowedImageIds.length ? inArray(runtimeImages.id, policy.allowedImageIds) : sql`false`) : or(includeShared ? eq(runtimeImages.defaultVisible, true) : undefined, exists(db.select().from(imageProjectGrants).where(and(eq(imageProjectGrants.imageId, runtimeImages.id), eq(imageProjectGrants.projectId, projectId))))),
      page.search ? sql`strpos(lower(${runtimeImages.name} || ' ' || (${runtimeImages.payload}->>'description')), lower(${page.search})) > 0` : undefined,
      page.before ? lt(runtimeImages.id, page.before) : undefined,
    )).orderBy(desc(runtimeImages.id)).limit(page.limit)).map((row) => row.payload),
    insert: async (v) => { await db.insert(runtimeImages).values({ id: v.id, name: v.name, defaultVisible: v.defaultVisible, enabled: v.enabled, payload: v }); },
    update: async (v) => { await db.update(runtimeImages).set({ name: v.name, defaultVisible: v.defaultVisible, enabled: v.enabled, payload: v }).where(eq(runtimeImages.id, v.id)); },
    grant: async (imageId, projectId) => { await db.insert(imageProjectGrants).values({ imageId, projectId }).onConflictDoNothing(); },
    granted: async (imageId, projectId) => (await db.select().from(imageProjectGrants).where(and(eq(imageProjectGrants.imageId, imageId), eq(imageProjectGrants.projectId, projectId))).limit(1)).length > 0,
    grants: async (imageId) => {
      const retained = await db.select().from(imageProjectGrants).where(eq(imageProjectGrants.imageId, imageId));
      const policies = await db.select().from(projectImagePolicies).where(sql`${projectImagePolicies.payload}->'policy'->>'mode' = 'restricted'`);
      return { retainedProjectIds: retained.map((row) => row.projectId as typeof policies[number]['payload']['projectId']), overrides: policies.map(({ payload }) => ({ projectId: payload.projectId, allowed: payload.policy.allowedImageIds.includes(imageId) })) };
    },
  };
}
export function revisionRepository(db: Executor): RevisionRepository {
  return {
    get: async (id) => (await db.select().from(imageRevisions).where(eq(imageRevisions.id, id)))[0]?.payload,
    list: async (imageId, page) => (await db.select().from(imageRevisions).where(and(eq(imageRevisions.imageId, imageId), page.before ? lt(imageRevisions.id, page.before) : undefined)).orderBy(desc(imageRevisions.id)).limit(page.limit)).map((r) => r.payload),
    insert: async (v) => { await db.insert(imageRevisions).values({ id: v.id, imageId: v.imageId, revision: v.revision, payload: v }); },
    next: async (imageId) => ((await db.select({ n: max(imageRevisions.revision) }).from(imageRevisions).where(eq(imageRevisions.imageId, imageId)))[0]?.n ?? 0) + 1,
  };
}
export function versionRepository(db: Executor): VersionRepository {
  return {
    ids: async (imageId) => (await db.select({ id: imageVersions.id }).from(imageVersions).where(eq(imageVersions.imageId, imageId))).map((r) => r.id),
    get: async (id, lock) => { const q = db.select().from(imageVersions).where(eq(imageVersions.id, id)); return (await (lock ? q.for('update') : q))[0]?.payload; },
    insert: async (v) => { await db.insert(imageVersions).values({ id: v.id, imageId: v.imageId, buildId: v.buildId, repository: v.repository, digest: v.digest, state: v.state, payload: v }); },
    update: async (v) => { await db.update(imageVersions).set({ state: v.state, payload: v }).where(eq(imageVersions.id, v.id)); },
    list: async (imageId, page) => (await db.select().from(imageVersions).where(and(eq(imageVersions.imageId, imageId), page.before ? lt(imageVersions.id, page.before) : undefined)).orderBy(desc(imageVersions.id)).limit(page.limit)).map((r) => r.payload),
    byBuild: async (buildId) => (await db.select().from(imageVersions).where(eq(imageVersions.buildId, buildId)))[0]?.payload,
    byDigest: async (repository, digest) => (await db.select().from(imageVersions).where(and(eq(imageVersions.repository, repository), eq(imageVersions.digest, digest)))).map((r) => r.payload),
  };
}
