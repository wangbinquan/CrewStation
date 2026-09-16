import type { RuntimeCheckId, RuntimeCheckState, RuntimeConfigId, RuntimeDriver, UserId } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { and, asc, desc, eq, gt, ilike } from 'drizzle-orm';
import type { RuntimeCheck } from '../../domain/runtimeCheck';
import type { RuntimeConfig, RuntimeCredential, RuntimeRevision, RuntimeRevisionContent } from '../../domain/runtimeConfig';
import type { RuntimeCheckRepository, RuntimeConfigRepository, RuntimeCredentialRepository, RuntimeRevisionRepository } from '../../ports/repositories';
import { checks, configs, credentials, revisions } from './tables';

const json = <T>(v: unknown): T => (typeof v === 'string' ? JSON.parse(v) : v) as T;

const toConfig = (r: typeof configs.$inferSelect): RuntimeConfig => ({
  id: r.id as RuntimeConfigId, name: r.name, description: r.description, driver: r.driver as RuntimeDriver, draftRevision: r.draftRevision, activeRevision: r.activeRevision,
  enabled: r.enabled, createdBy: r.createdBy as UserId, createdAt: r.createdAt, updatedBy: r.updatedBy as UserId, updatedAt: r.updatedAt,
});
const configRow = (c: RuntimeConfig): typeof configs.$inferInsert => ({ ...c });

export function drizzleRuntimeConfigRepository(db: Executor): RuntimeConfigRepository {
  return {
    insert: async (c) => { await db.insert(configs).values(configRow(c)); },
    update: async (c) => { await db.update(configs).set(configRow(c)).where(eq(configs.id, c.id)); },
    getById: async (id) => { const row = (await db.select().from(configs).where(eq(configs.id, id)))[0]; return row ? toConfig(row) : undefined; },
    lockById: async (id) => { const row = (await db.select().from(configs).where(eq(configs.id, id)).for('update'))[0]; return row ? toConfig(row) : undefined; },
    getByName: async (name) => { const row = (await db.select().from(configs).where(eq(configs.name, name)))[0]; return row ? toConfig(row) : undefined; },
    listPage: async (filter, limit, after) => {
      const where = and(
        filter.name ? ilike(configs.name, `%${filter.name.replace(/[%_]/g, '')}%`) : undefined,
        filter.driver ? eq(configs.driver, filter.driver) : undefined,
        filter.enabled === undefined ? undefined : eq(configs.enabled, filter.enabled),
        after ? gt(configs.name, after) : undefined,
      );
      return (await db.select().from(configs).where(where).orderBy(asc(configs.name)).limit(limit)).map(toConfig);
    },
  };
}

export function drizzleRuntimeRevisionRepository(db: Executor): RuntimeRevisionRepository {
  const toRevision = (r: typeof revisions.$inferSelect): RuntimeRevision => ({ configId: r.configId as RuntimeConfigId, revision: r.revision, ...json<RuntimeRevisionContent>(r.content), contentHash: r.contentHash, createdBy: r.createdBy as UserId, createdAt: r.createdAt });
  return {
    insert: async (rev) => {
      const { configId, revision, contentHash, createdBy, createdAt, ...content } = rev;
      await db.insert(revisions).values({ configId, revision, contentHash, createdBy, createdAt, content });
    },
    get: async (configId, revision) => { const row = (await db.select().from(revisions).where(and(eq(revisions.configId, configId), eq(revisions.revision, revision))))[0]; return row ? toRevision(row) : undefined; },
  };
}

export function drizzleRuntimeCredentialRepository(db: Executor): RuntimeCredentialRepository {
  const toCredential = (r: typeof credentials.$inferSelect): RuntimeCredential => ({ configId: r.configId as RuntimeConfigId, name: r.name, cipherText: r.cipherText, updatedBy: r.updatedBy as UserId, updatedAt: r.updatedAt });
  return {
    list: async (configId) => (await db.select().from(credentials).where(eq(credentials.configId, configId)).orderBy(asc(credentials.name))).map(toCredential),
    upsert: async (c) => { await db.insert(credentials).values({ ...c }).onConflictDoUpdate({ target: [credentials.configId, credentials.name], set: { cipherText: c.cipherText, updatedBy: c.updatedBy, updatedAt: c.updatedAt } }); },
    remove: async (configId, name) => { await db.delete(credentials).where(and(eq(credentials.configId, configId), eq(credentials.name, name))); },
  };
}

export function drizzleRuntimeCheckRepository(db: Executor): RuntimeCheckRepository {
  const toCheck = (r: typeof checks.$inferSelect): RuntimeCheck => ({
    checkId: r.checkId as RuntimeCheckId, configId: r.configId as RuntimeConfigId, revision: r.revision, contentHash: r.contentHash, clientRequestId: r.clientRequestId, createdBy: r.createdBy as UserId,
    ...(r.model ? { model: r.model } : {}), state: r.state as RuntimeCheckState, context: json<RuntimeCheck['context']>(r.context), stages: json<RuntimeCheck['stages']>(r.stages),
    ...(r.error ? { error: r.error } : {}), createdAt: r.createdAt, ...(r.startedAt ? { startedAt: r.startedAt } : {}), ...(r.endedAt ? { endedAt: r.endedAt } : {}),
  });
  const row = (c: RuntimeCheck): typeof checks.$inferInsert => ({ ...c, model: c.model ?? null, error: c.error ?? null, startedAt: c.startedAt ?? null, endedAt: c.endedAt ?? null });
  return {
    insert: async (c) => { await db.insert(checks).values(row(c)); },
    update: async (c) => { await db.update(checks).set(row(c)).where(eq(checks.checkId, c.checkId)); },
    get: async (checkId) => { const r = (await db.select().from(checks).where(eq(checks.checkId, checkId)))[0]; return r ? toCheck(r) : undefined; },
    findByRequest: async (configId, createdBy, clientRequestId) => { const r = (await db.select().from(checks).where(and(eq(checks.configId, configId), eq(checks.createdBy, createdBy), eq(checks.clientRequestId, clientRequestId))))[0]; return r ? toCheck(r) : undefined; },
    latestFor: async (configId, revision, contentHash) => { const r = (await db.select().from(checks).where(and(eq(checks.configId, configId), eq(checks.revision, revision), eq(checks.contentHash, contentHash))).orderBy(desc(checks.createdAt)).limit(1))[0]; return r ? toCheck(r) : undefined; },
  };
}
