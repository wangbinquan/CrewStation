import { describe, expect, test } from 'bun:test';
import { ServiceIdSchema, UserIdSchema, type SessionCredentialDto } from '@crewstation/contracts';
import { assertSharedDatabaseAdmissionActive, withSharedDatabaseAdmission } from '@crewstation/persistence';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { developmentSourceControl } from '../application/deletion/developmentSources';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('Development publish callback across original SCM admission', () => {
  for (const failed of [false, true]) test(`${failed ? 'failed' : 'successful'} push retains its caller authority while SCM owns credential revocation`, async () => {
    const database = await createTestDatabase(), db = database.db;
    const service = ServiceIdSchema.parse(Bun.randomUUIDv7()), actor = { userId: UserIdSchema.parse(Bun.randomUUIDv7()), isAdmin: false };
    const development = 'dev-session.project-admission:original', scm = 'scm.project-admission:original';
    let revoked = false, called = false;
    const port = developmentSourceControl({ listBranches: async () => [], readFile: async () => undefined,
      issueSessionCredential: async () => { throw Error('ordinary developer credential must not be issued'); },
      withPublishCredential: <T>(_id: typeof service, publish: (credential: SessionCredentialDto) => Promise<T>) =>
        withSharedDatabaseAdmission(db, scm, async () => {
          try {
            assertSharedDatabaseAdmissionActive(db, scm);
            return await publish({ token: 'publish/?', expiresAt: '2026-10-15T12:00:00Z', httpUrlWithCredentialTemplate: 'https://oauth2:{token}@git.example/game.git' });
          } finally {
            assertSharedDatabaseAdmissionActive(db, scm);
            revoked = true;
          }
        }),
    }, actor);
    try {
      // Live publication failed when SCM's scope replaced the callback's
      // still-held Development authority before the Runner push was dispatched.
      const publishing = withSharedDatabaseAdmission(db, development, () => port.withPublishUrl(service, async url => {
        assertSharedDatabaseAdmissionActive(db, development);
        expect(() => assertSharedDatabaseAdmissionActive(db, scm)).toThrow('has exited');
        expect(url).toBe('https://oauth2:publish%2F%3F@git.example/game.git');
        expect(revoked).toBe(false); called = true;
        const [held] = await db.execute<{ count: number }>(sql`SELECT count(*)::integer AS count FROM pg_locks
          WHERE locktype='advisory' AND mode='ShareLock' AND granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`);
        expect(held?.count).toBe(2);
        if (failed) throw Error('push rejected');
        return 'confirmed-sha-pushed';
      }));
      if (failed) await expect(publishing).rejects.toThrow('push rejected');
      else expect(await publishing).toBe('confirmed-sha-pushed');
      expect(called).toBe(true); expect(revoked).toBe(true);
      expect(() => assertSharedDatabaseAdmissionActive(db, development)).toThrow('has exited');
      expect(() => assertSharedDatabaseAdmissionActive(db, scm)).toThrow('has exited');
    } finally { await database.drop(); }
  });
});
