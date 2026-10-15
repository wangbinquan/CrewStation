import { describe, expect, test } from 'bun:test';
import { createProjectDeletionSessionClient } from '../../../../packages/session-client';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sessionDeletionFixture } from './fixture';
import { loopbackRequest } from './request';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('original sealed Session directory (real PG and HTTP)', () => {
  test('pages all original tasks, excludes another project and later sources, and closes with the actual stop proof', async () => {
    const f = await sessionDeletionFixture();
    try {
      const ids = Array.from({ length: 403 }, () => f.task()).sort(), other = f.task(f.otherProject);
      const context = await f.context(), client = createProjectDeletionSessionClient(f.first.address, loopbackRequest);
      expect((await f.first.module.api.deletionOwner!.run(context)).kind).toBe('done'); f.deleting();
      const late = f.task(), first = await client.tasks(context), second = await client.tasks(context, first.at(-1)!);
      const last = await client.tasks(context, second.at(-1)!);
      expect([first.length, second.length, last.length]).toEqual([200, 200, 3]);
      expect([...first, ...second, ...last]).toEqual(ids);
      expect([...first, ...second, ...last]).not.toContain(other); expect([...first, ...second, ...last]).not.toContain(late);
      expect(await client.tasks(context, last.at(-1)!)).toEqual([]);
      const stopped = { ...context, phase: 'stop' as const };
      expect(await client.tasks(stopped)).toEqual(first);
      await expect(client.tasks({ ...context, phase: 'metadata' })).rejects.toThrow('封写或停止许可');
      f.permit(false); await expect(client.tasks(stopped)).rejects.toThrow('grant unavailable'); f.permit(true);
      expect((await f.first.module.api.deletionOwner!.run(stopped)).kind).toBe('done');
      await expect(client.tasks(stopped)).rejects.toThrow('原停止已经完成');
    } finally { f.permit(true); await f.drop(); }
  }, 20_000);
});
