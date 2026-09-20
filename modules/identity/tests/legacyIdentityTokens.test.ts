import { describe, expect, test } from 'bun:test';
import type { ProjectId } from '@crewstation/contracts';
import { TOKEN_CLAIMS } from '@crewstation/contracts';
import { newResourceId, systemClock } from '@crewstation/kernel';
import { resourceIdentityDirectory } from '@crewstation/persistence';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { drizzleKeyStore } from '../adapters/persistence/drizzleKeyStore';
import { keyRingTokenService } from '../adapters/jwt/keyRingTokenService';
import { identityMigrations } from '../wiring';
import { identityModuleFor, seedLocalUser } from './identityFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('verified legacy token identities', () => {
  test('old browser and MCP tokens resolve canonical resources after signature verification and retain live access checks', async () => {
    const tdb = await createTestDatabase([identityMigrations]);
    try {
      const user = await seedLocalUser(tdb.db, { username: 'uuid-admin', isAdmin: true });
      const task = newResourceId(), project = newResourceId() as ProjectId, service = newResourceId();
      const directory = resourceIdentityDirectory(tdb.db, () => [identityMigrations]);
      const old = { user: 'usr_11111111111111111111111111111111', task: 'tsk_11111111111111111111111111111111', project: 'prj_11111111111111111111111111111111', service: 'svc_11111111111111111111111111111111' };
      for (const [kind, canonical] of Object.entries({ user, task, project, service })) await directory.bind('identity', kind, [old[kind as keyof typeof old]], canonical);
      let active = true;
      const module = identityModuleFor(tdb.db, { legacyIds: directory, devSessionState: { activeSession: async (id) => active && id === task ? { projectId: project } : undefined } });
      const tokens = keyRingTokenService({ keyStore: drizzleKeyStore(tdb.db), issuer: TOKEN_CLAIMS.issuer, clock: systemClock });
      const subject = `${TOKEN_CLAIMS.subjectPrefixUser}${old.user}`;
      const browser = await tokens.sign({ subject, audience: 'session', expiresInSeconds: 60, claims: { cs_kind: 'session' } });
      expect((await module.api.resolveSession(browser))?.id).toBe(user);
      expect(await module.api.resolveSession(`${browser.slice(0, -8)}invalid!`)).toBeUndefined();
      const mcp = await tokens.sign({ subject, audience: TOKEN_CLAIMS.audienceDevSession, expiresInSeconds: 60, claims: { [TOKEN_CLAIMS.kind]: TOKEN_CLAIMS.kindDevSession, [TOKEN_CLAIMS.taskId]: old.task, [TOKEN_CLAIMS.project]: old.project, [TOKEN_CLAIMS.service]: old.service } });
      expect(await module.api.resolveDevSessionToken(mcp)).toMatchObject({ taskId: task, projectId: project, serviceId: service, userId: user });
      expect(await module.api.resolveSession(mcp)).toBeUndefined();
      active = false;
      expect(await module.api.resolveDevSessionToken(mcp)).toBeUndefined();
    } finally { await tdb.drop(); }
  });
});
