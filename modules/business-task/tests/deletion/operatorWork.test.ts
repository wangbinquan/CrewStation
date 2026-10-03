import { describe, expect, test } from 'bun:test';
import { forbidden, newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { finalizationOperations } from '../../adapters/persistence/finalization/repository';
import type { FinalizationPreparation } from '../../ports/storage/preparation';
import { executionCommandFixture } from '../executionCommandFixture';
import { businessWorkFixture } from './workFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('administrative business writes retain their original request (actual HTTP/PostgreSQL)', () => {
  test('authorization precedes birth; a late archive preflight cannot accept a finalization after connection loss and seal', async () => {
    const f = await businessWorkFixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    let pending: Promise<Response> | undefined;
    try {
      const business = await executionCommandFixture(f.database.db); f.bind(business.serviceId, business.projectId);
      await f.database.db.execute(sql`UPDATE business_task.execution_operations SET intent=jsonb_set(intent,'{task,completionPolicy}','"archive-and-delete"') WHERE service_id=${business.serviceId}`);
      const user = newResourceId(), ports: FinalizationPreparation = {
        operatorArchive: { preflight: async () => { entered.resolve(); await release.promise; return { spaceId: newResourceId() }; }, createPlan: async () => { throw new Error('not expected'); } },
        archive: { bind: async () => { throw new Error('not expected'); }, commitArchive: async () => { throw new Error('not expected'); }, observe: async () => true },
        runtime: { freezeBusinessStorage: async () => {}, stopBusinessStorage: async () => { throw new Error('not expected'); } },
      };
      const mounted = business.make({ finalizationPreparation: ports, deletionWorkSources: { ...f.sources, assertGrant: async () => undefined },
        authorizer: { authorize: async (actor) => { if (actor.userId !== user) throw forbidden(); return 'owner'; } } });
      mounted.app.route('/', mounted.module.http.user);
      const path = `/v3/object-storage/tasks/${business.task.id}/finalize`, input = { requestKey: 'operator-original', expectedGeneration: 1, outcome: 'cancelled', reason: 'Operator reviewed the original workspace', confirmation: 'finalize', archive: { noArtifactsReason: 'No output' } };
      expect((await mounted.request(path, input, 'trusted', { 'x-cs-user-id': newResourceId() })).status).toBe(403);
      expect(await mounted.module.projectWork!.history(business.projectId)).toEqual([]);
      pending = Promise.resolve(mounted.request(path, input, 'trusted', { 'x-cs-user-id': user })); await entered.promise;
      const [birth] = await mounted.module.projectWork!.history(business.projectId);
      expect(birth).toMatchObject({ kind: 'service-api', reference: business.task.id });
      await f.database.db.execute(sql`SELECT pg_terminate_backend(${birth!.backendPid})`); expect((await pending).status).toBe(500);
      const context = f.context();
      expect(await mounted.module.projectWork!.seal({ ...context, target: { ...context.target, id: business.projectId, serviceId: business.serviceId } })).toEqual({ pending: [birth!.id] });
      release.resolve(); await f.waitExit(birth!.id);
      expect(await finalizationOperations(f.database.db).forTask(business.serviceId, business.task.id)).toBeUndefined();
    } finally { release.resolve(); await pending?.catch(() => undefined); await f.drop(); }
  });
});
