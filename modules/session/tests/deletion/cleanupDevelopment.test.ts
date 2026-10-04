import { describe, expect, test } from 'bun:test';
import { DevelopmentUsageInfoSchema, RunnerCommandSchema } from '@crewstation/contracts';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { cleanupFixture } from './cleanupFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('private Session development cleanup (real PG and actual two-replica HTTP/WS; controlled original Runner replies)', () => {
  test('original stop and info persist the bound receipt, all pages commit before ACK and no new numeric registration is inserted', async () => {
    const f = await cleanupFixture();
    try {
      expect((await f.owner.run({ ...f.context, phase: 'seal' })).kind).toBe('done'); f.deleting();
      const registration = f.registration, receipt = f.developmentReceipt(2);
      const intent = { version: 1, identity: registration.identity, profileId: registration.profileId, profileRevision: registration.profileRevision,
        launch: { protocol: 'opencode', binaryPath: '/fixture/opencode', extraArgs: [], isSandbox: false }, permission: 'edit', mode: 'interactive',
        initialPrompt: null, cwd: null, resumeSessionId: null, systemPrompt: null, mcp: [], nativeUsageLineageKey: 'original' };
      const stop = RunnerCommandSchema.parse({ id: f.commandId(), type: 'stopDevelopmentAgent', podUid: registration.podUid,
        admission: { intent, key: registration.key, digestNonce: 'a'.repeat(64) } });
      await f.exchange(stop, { version: 1, state: 'stopping', receipt });
      const info = DevelopmentUsageInfoSchema.parse({ version: 1, runtimeTaskId: f.task, journalId: registration.key.journalId, incarnation: registration.key.incarnation,
        podUid: registration.podUid, receipt });
      await f.exchange({ id: f.commandId(), type: 'developmentUsageInfo', key: registration.key }, info);
      const before = f.runner.frames.length;
      await expect(f.request({ id: f.commandId(), type: 'ackDevelopmentUsageEvents', key: registration.key, through: 2 })).rejects.toMatchObject({ kind: 'unavailable' });
      expect(f.runner.frames.length).toBe(before);
      for (let i = 0; i < 2; i++) {
        await f.exchange({ id: f.commandId(), type: 'readDevelopmentUsageEvents', key: registration.key, after: i, limit: 1 }, f.developmentPage(i, 1));
        expect(await f.first.module.api.getDevelopmentUsage(f.task, registration.key)).toMatchObject({ persistedThrough: i + 1 });
      }
      await f.exchange({ id: f.commandId(), type: 'ackDevelopmentUsageEvents', key: registration.key, through: 2 }, { ...receipt, acknowledgedSequence: 2 });
      expect(await f.second.module.api.getDevelopmentUsage(f.task, registration.key)).toMatchObject({ persistedThrough: 2, runnerAcknowledgedThrough: 2, registration });
      expect(await f.database.db.execute('SELECT task_id FROM session.development_usage_streams')).toHaveLength(1);
      expect(await f.database.db.execute(sql`SELECT sequence FROM session.development_usage_events WHERE task_id=${f.task}`)).toHaveLength(2);
      await expect(f.second.module.api.registerDevelopmentUsage({ ...registration, key: { ...registration.key, payloadDigest: 'f'.repeat(64) } })).rejects.toMatchObject({ cause: { message: expect.stringContaining('closed') } });
      expect((await f.owner.run(f.context)).kind).toBe('done');
    } finally { await f.drop(); }
  });

  test('a reply from a replaced incarnation and an unproved ACK cannot change original copied data', async () => {
    const f = await cleanupFixture();
    try {
      expect((await f.owner.run({ ...f.context, phase: 'seal' })).kind).toBe('done'); f.deleting();
      const receipt = f.developmentReceipt(1), key = f.registration.key;
      const info = DevelopmentUsageInfoSchema.parse({ version: 1, runtimeTaskId: f.task, journalId: key.journalId, incarnation: key.incarnation, podUid: f.registration.podUid, receipt });
      await f.exchange({ id: f.commandId(), type: 'developmentUsageInfo', key }, info);
      await f.exchange({ id: f.commandId(), type: 'readDevelopmentUsageEvents', key, after: 0, limit: 1 }, f.developmentPage(0, 1));
      const original = await f.first.module.api.getDevelopmentUsage(f.task, key);
      await expect(f.exchange({ id: f.commandId(), type: 'ackDevelopmentUsageEvents', key, through: 1 }, receipt)).rejects.toMatchObject({ kind: 'unavailable' });
      await expect(f.exchange({ id: f.commandId(), type: 'ackDevelopmentUsageEvents', key, through: 1 }, { ...receipt, key: { ...key, incarnation: crypto.randomUUID() }, acknowledgedSequence: 1 })).rejects.toMatchObject({ kind: 'unavailable' });
      expect(await f.first.module.api.getDevelopmentUsage(f.task, key)).toEqual(original);
      expect((await f.owner.run(f.context)).kind).toBe('done');
    } finally { await f.drop(); }
  });
});
