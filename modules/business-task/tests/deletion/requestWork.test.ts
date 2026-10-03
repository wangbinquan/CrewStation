import { describe, expect, test } from 'bun:test';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { executionCommandFixture } from '../executionCommandFixture';
import { businessWorkFixture } from './workFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('business request preparation retains its original lifetime (actual HTTP/PG)', () => {
  test('a late Runner preparation reply after connection loss and seal cannot accept or start a subtask', async () => {
    const f = await businessWorkFixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    let pending: Promise<Response> | undefined;
    try {
      const business = await executionCommandFixture(f.database.db); f.bind(business.serviceId, business.projectId);
      const mounted = business.make({ deletionWorkSources: { ...f.sources, assertGrant: async () => undefined } });
      const send = business.runner.sendCommand;
      business.runner.sendCommand = async (id, command) => {
        if (command.type === 'businessExecutionInfo') { entered.resolve(); await release.promise; }
        return send(id, command);
      };
      pending = Promise.resolve(mounted.request(business.path, business.input)); await entered.promise;
      const [birth] = (await mounted.module.projectWork!.history(business.projectId)).filter((row) => !row.exited);
      expect(birth).toMatchObject({ kind: 'service-api', reference: business.serviceId });
      await f.database.db.execute(sql`SELECT pg_terminate_backend(${birth!.backendPid})`);
      expect((await pending).status).toBe(500);
      const context = f.context();
      expect(await mounted.module.projectWork!.seal({ ...context, target: { ...context.target, id: business.projectId, serviceId: business.serviceId } })).toEqual({ pending: [birth!.id] });
      expect((await mounted.module.projectWork!.history(business.projectId))[0]?.exited).toBe(false);
      release.resolve(); await f.waitExit(birth!.id);
      // The HTTP promise already failed, but its original awaited body must remain fenced until its own finally.
      expect(business.behavior.starts).toBe(0);
      expect(await f.database.db.execute(sql`SELECT id FROM business_task.execution_subtasks WHERE task_id=${business.task.id}`)).toHaveLength(0);
      expect((await mounted.module.projectWork!.history(business.projectId))[0]).toMatchObject({ exited: true, recoveryDigest: null });
      expect((await mounted.request(business.path, { ...business.input, requestKey: 'after-seal' })).status).toBe(412);
    } finally { release.resolve(); await pending?.catch(() => undefined); await f.drop(); }
  });

  test('untrusted workload tokens cannot create a request birth, and read requests create none', async () => {
    const f = await businessWorkFixture();
    try {
      const business = await executionCommandFixture(f.database.db); f.bind(business.serviceId, business.projectId);
      const mounted = business.make({ deletionWorkSources: f.sources });
      expect((await mounted.request(business.path, business.input, 'untrusted')).status).toBe(403);
      expect((await mounted.request('/v3/business-tasks/' + business.task.id)).status).toBe(200);
      expect(await mounted.module.projectWork!.history(business.projectId)).toHaveLength(0);
    } finally { await f.drop(); }
  });
});
