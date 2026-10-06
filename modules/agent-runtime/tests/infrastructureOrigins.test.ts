import { describe, expect, test } from 'bun:test';
import { CreateComputeProfileRequestSchema } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { resourceIdentityDirectory } from '@crewstation/persistence';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { agentRuntimeMigrations } from '../wiring';
import { computeDeletionFixture } from './deletionFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('profile-test public infrastructure origins (actual PG)', () => {
  test('explicit platform context resolves current/legacy IDs; absent, retired and conflicting sources do not infer scope', async () => {
    const f = await computeDeletionFixture();
    try {
      const profile = await f.compute.api.createProfile(f.admin, CreateComputeProfileRequestSchema.parse({ name: 'private-origin-profile', content: {
        image: 'runtime/private:1', launch: { protocol: 'terminal', binaryPath: '/private/cli' },
        terminalTest: { command: ['/private/cli', '--version'], expect: '^cli' },
      } }));
      const id = profile.latestTest!.testId;
      const read = f.compute.api.originalInfrastructureOwnership;
      const origin = await read(id);
      expect(origin).toMatchObject({ complete: true, id, scope: 'platform', projectIds: [] });
      const directory = resourceIdentityDirectory(f.database.db, () => [agentRuntimeMigrations]);
      await directory.bind('agent_runtime', 'profile-test', ['private-old-test'], id);
      expect(await read('private-old-test', 'legacy')).toEqual(origin);
      expect(await read(id, 'legacy')).toEqual(origin);
      expect(await read(newResourceId())).toBeUndefined();
      expect(await read('unknown-test', 'legacy')).toBeUndefined();
      await expect(read('old-test')).rejects.toThrow();
      await expect(read(id, 'unknown' as never)).rejects.toThrow('未登记');
      for (const secret of ['private-origin-profile', 'private-old-test', '/private/cli', 'context', 'stages', 'error']) expect(JSON.stringify(origin)).not.toContain(secret);
      await f.database.db.execute(sql`UPDATE agent_runtime.profile_tests SET error='private output', stages='[]',context='{"kind":"platform-namespace","image":"private-image"}' WHERE test_id=${id}`);
      expect(await read(id)).toEqual(origin);
      await f.database.db.execute(sql`UPDATE agent_runtime.profile_tests SET context='{}' WHERE test_id=${id}`);
      expect(await read(id)).toBeUndefined();
      await f.database.db.execute(sql`UPDATE agent_runtime.profile_tests SET context=jsonb_build_object('kind','platform-namespace','projectId',${f.own.id}::text) WHERE test_id=${id}`);
      await expect(read(id)).rejects.toThrow('归属冲突');
      const retired = newResourceId();
      await f.database.db.execute(sql`INSERT INTO agent_runtime.retired_test_identities(id) VALUES(${retired})`);
      expect(await read(retired)).toBeUndefined();
      await directory.bind('agent_runtime', 'profile-test', ['retained-old-key'], retired);
      const evidence = await f.compute.api.currentProfileTestEvidence(retired);
      expect(evidence).toMatchObject({ complete: true, id: retired, retired: true, active: false, aliases: ['retained-old-key'] });
      expect(await f.compute.api.currentProfileTestEvidence(retired)).toEqual(evidence);
      expect(await f.compute.api.currentProfileTestEvidence(id)).toMatchObject({ retired: false, active: true });
      expect(await f.compute.api.currentProfileTestEvidence(newResourceId())).toMatchObject({ retired: false, active: false, aliases: [] });
      await directory.bind('agent_runtime', 'profile-test', [id], newResourceId());
      await expect(read(id)).rejects.toThrow('目录冲突');
    } finally { await f.database.drop(); }
  });
});
