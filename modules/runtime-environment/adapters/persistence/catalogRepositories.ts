import type { Executor } from '@crewstation/persistence';
import { and, desc, eq, lt, max, or } from 'drizzle-orm';
import type { ImageRepository, RevisionRepository, VersionRepository } from '../../ports/repositories';
import { imageRevisions, imageVersions, runtimeImages } from './tables';

export function imageRepository(db: Executor): ImageRepository {
  return {
    listAll: async (page) => (await db.select().from(runtimeImages).where(page.before ? lt(runtimeImages.id, page.before) : undefined).orderBy(desc(runtimeImages.id)).limit(page.limit)).map((row) => row.payload),
    get: async (id, lock) => { const q = db.select().from(runtimeImages).where(eq(runtimeImages.id, id)); return (await (lock ? q.for('update') : q))[0]?.payload; },
    list: async (projectId, page, includeShared = false) => (await db.select().from(runtimeImages).where(and(
      includeShared ? or(eq(runtimeImages.projectId, projectId), eq(runtimeImages.scope, 'shared')) : eq(runtimeImages.projectId, projectId),
      page.before ? lt(runtimeImages.id, page.before) : undefined,
    )).orderBy(desc(runtimeImages.id)).limit(page.limit)).map((row) => row.payload),
    insert: async (v) => { await db.insert(runtimeImages).values({ id: v.id, projectId: v.projectId, name: v.name, scope: v.scope, enabled: v.enabled, payload: v }); },
    update: async (v) => { await db.update(runtimeImages).set({ name: v.name, scope: v.scope, enabled: v.enabled, payload: v }).where(eq(runtimeImages.id, v.id)); },
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
    get: async (id, lock) => { const q = db.select().from(imageVersions).where(eq(imageVersions.id, id)); return (await (lock ? q.for('update') : q))[0]?.payload; },
    insert: async (v) => { await db.insert(imageVersions).values({ id: v.id, imageId: v.imageId, projectId: v.projectId, buildId: v.buildId, repository: v.repository, digest: v.digest, state: v.state, payload: v }); },
    update: async (v) => { await db.update(imageVersions).set({ state: v.state, payload: v }).where(eq(imageVersions.id, v.id)); },
    list: async (imageId, page) => (await db.select().from(imageVersions).where(and(eq(imageVersions.imageId, imageId), page.before ? lt(imageVersions.id, page.before) : undefined)).orderBy(desc(imageVersions.id)).limit(page.limit)).map((r) => r.payload),
    byBuild: async (buildId) => (await db.select().from(imageVersions).where(eq(imageVersions.buildId, buildId)))[0]?.payload,
    byDigest: async (repository, digest) => (await db.select().from(imageVersions).where(and(eq(imageVersions.repository, repository), eq(imageVersions.digest, digest)))).map((r) => r.payload),
  };
}
