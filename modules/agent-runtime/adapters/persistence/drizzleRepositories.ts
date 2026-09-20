import type { AgentProtocol, ProfileTestId, ProfileTestOutcome, ProfileTestState, UserId } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { and, asc, desc, eq, inArray, lt } from 'drizzle-orm';
import type { ComputeProfile, ProfileCredential, ProfileRevision } from '../../domain/computeProfile';
import type { ProfileTest } from '../../domain/profileTest';
import type { CredentialRepository, ProfileRepository, RevisionRepository, TestRepository } from '../../ports/repositories';
import { profileCredentials, profileRevisions, profileTests, profiles } from './tables';

const json = <T>(v: unknown): T => (typeof v === 'string' ? JSON.parse(v) : v) as T;

const toProfile = (r: typeof profiles.$inferSelect): ComputeProfile => ({
  name: r.name, protocol: r.protocol as AgentProtocol, description: r.description, enabled: r.enabled, isDefault: r.isDefault, defaultVisible: r.defaultVisible, currentRevision: r.currentRevision,
  createdBy: r.createdBy as UserId, createdAt: r.createdAt, updatedBy: r.updatedBy as UserId, updatedAt: r.updatedAt,
});

export function drizzleProfileRepository(db: Executor): ProfileRepository {
  return {
    insert: async (p) => { await db.insert(profiles).values({ ...p }); },
    update: async (p) => { await db.update(profiles).set({ ...p }).where(eq(profiles.name, p.name)); },
    get: async (name) => { const row = (await db.select().from(profiles).where(eq(profiles.name, name)))[0]; return row ? toProfile(row) : undefined; },
    lock: async (name) => { const row = (await db.select().from(profiles).where(eq(profiles.name, name)).for('update'))[0]; return row ? toProfile(row) : undefined; },
    getDefault: async () => { const row = (await db.select().from(profiles).where(eq(profiles.isDefault, true)))[0]; return row ? toProfile(row) : undefined; },
    list: async () => (await db.select().from(profiles).orderBy(asc(profiles.name))).map(toProfile),
    remove: async (name) => { await db.delete(profiles).where(eq(profiles.name, name)); },
    clearDefault: async () => { await db.update(profiles).set({ isDefault: false }).where(eq(profiles.isDefault, true)); },
  };
}

export function drizzleRevisionRepository(db: Executor): RevisionRepository {
  const toRevision = (r: typeof profileRevisions.$inferSelect): ProfileRevision => ({
    profile: r.profile, revision: r.revision, content: json<ProfileRevision['content']>(r.content), imageDigest: r.imageDigest, contentHash: r.contentHash,
    createdBy: r.createdBy as UserId, createdAt: r.createdAt,
  });
  return {
    insert: async (rev) => { await db.insert(profileRevisions).values({ ...rev }); },
    get: async (profile, revision) => { const row = (await db.select().from(profileRevisions).where(and(eq(profileRevisions.profile, profile), eq(profileRevisions.revision, revision))))[0]; return row ? toRevision(row) : undefined; },
    removeAll: async (profile) => { await db.delete(profileRevisions).where(eq(profileRevisions.profile, profile)); },
  };
}

export function drizzleCredentialRepository(db: Executor): CredentialRepository {
  const toCredential = (r: typeof profileCredentials.$inferSelect): ProfileCredential => ({ profile: r.profile, name: r.name, cipherText: r.cipherText, updatedBy: r.updatedBy as UserId, updatedAt: r.updatedAt });
  return {
    list: async (profile) => (await db.select().from(profileCredentials).where(eq(profileCredentials.profile, profile)).orderBy(asc(profileCredentials.name))).map(toCredential),
    upsert: async (c) => { await db.insert(profileCredentials).values({ ...c }).onConflictDoUpdate({ target: [profileCredentials.profile, profileCredentials.name], set: { cipherText: c.cipherText, updatedBy: c.updatedBy, updatedAt: c.updatedAt } }); },
    remove: async (profile, name) => { await db.delete(profileCredentials).where(and(eq(profileCredentials.profile, profile), eq(profileCredentials.name, name))); },
    removeAll: async (profile) => { await db.delete(profileCredentials).where(eq(profileCredentials.profile, profile)); },
  };
}

export function drizzleTestRepository(db: Executor): TestRepository {
  const toTest = (r: typeof profileTests.$inferSelect): ProfileTest => ({
    testId: r.testId as ProfileTestId, profile: r.profile, revision: r.revision, contentHash: r.contentHash, trigger: r.trigger as ProfileTest['trigger'],
    ...(r.clientRequestId ? { clientRequestId: r.clientRequestId } : {}), createdBy: r.createdBy as UserId, state: r.state as ProfileTestState,
    ...(r.outcome ? { outcome: r.outcome as ProfileTestOutcome } : {}), context: json<ProfileTest['context']>(r.context), stages: json<ProfileTest['stages']>(r.stages),
    ...(r.error ? { error: r.error } : {}), createdAt: r.createdAt, ...(r.startedAt ? { startedAt: r.startedAt } : {}), ...(r.endedAt ? { endedAt: r.endedAt } : {}),
  });
  const row = (t: ProfileTest): typeof profileTests.$inferInsert => ({
    ...t, clientRequestId: t.clientRequestId ?? null, outcome: t.outcome ?? null, error: t.error ?? null, startedAt: t.startedAt ?? null, endedAt: t.endedAt ?? null,
  });
  return {
    insert: async (t) => { await db.insert(profileTests).values(row(t)); },
    update: async (t) => { await db.update(profileTests).set(row(t)).where(and(eq(profileTests.testId, t.testId), inArray(profileTests.state, ['queued', 'running']))); },
    get: async (testId) => { const r = (await db.select().from(profileTests).where(eq(profileTests.testId, testId)))[0]; return r ? toTest(r) : undefined; },
    findByRequest: async (profile, createdBy, clientRequestId) => {
      const r = (await db.select().from(profileTests).where(and(eq(profileTests.profile, profile), eq(profileTests.createdBy, createdBy), eq(profileTests.clientRequestId, clientRequestId))))[0];
      return r ? toTest(r) : undefined;
    },
    latestFor: async (profile, revision) => {
      const r = (await db.select().from(profileTests).where(and(eq(profileTests.profile, profile), eq(profileTests.revision, revision))).orderBy(desc(profileTests.createdAt)).limit(1))[0];
      return r ? toTest(r) : undefined;
    },
    supersedeBefore: async (profile, revision, at) => {
      await db.update(profileTests).set({ state: 'superseded', endedAt: at })
        .where(and(eq(profileTests.profile, profile), lt(profileTests.revision, revision), inArray(profileTests.state, ['queued', 'running'])));
    },
    removeAll: async (profile) => { await db.delete(profileTests).where(eq(profileTests.profile, profile)); },
  };
}
