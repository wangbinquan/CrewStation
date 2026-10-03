import { describe, expect, test } from 'bun:test';
import { newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { finalizationOperations } from '../../adapters/persistence/finalization/repository';
import { finalizationCompletion } from '../../adapters/persistence/finalization/completion';
import { prepareFinalizations } from '../../application/finalization/preparation';
import { scopedFinalizationPorts } from '../../application/execution/deletion/finalizationWork';
import type { FinalizationPreparation } from '../../ports/storage/preparation';
import { executionCommandFixture } from '../executionCommandFixture';
import { businessWorkFixture } from './workFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('finalization worker retains its original callback (actual PostgreSQL)', () => {
  test('late freeze after backend loss and seal cannot bind an archive or advance the frozen operation', async () => {
    const f = await businessWorkFixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    let pending: Promise<unknown> | undefined;
    try {
      const business = await executionCommandFixture(f.database.db); f.bind(business.serviceId, business.projectId);
      await f.database.db.execute(sql`UPDATE business_task.execution_operations SET intent=jsonb_set(intent,'{task,completionPolicy}','"archive-and-delete"') WHERE service_id=${business.serviceId}`);
      const store = finalizationOperations(f.database.db), op = await store.accept(business.serviceId, business.task.id,
        { requestKey: 'finish-original', expectedGeneration: 1, outcome: 'succeeded', archive: { noArtifactsReason: 'No output' }, fence: business.fence },
        { spaceId: newResourceId(), volumeUid: newResourceId(), authorization: { fence: business.fence, source: { ...business.sources.get('trusted')!.source, role: 'prod' } } });
      let bindings = 0;
      const ports: FinalizationPreparation = {
        runtime: { freezeBusinessStorage: async () => { entered.resolve(); await release.promise; }, stopBusinessStorage: async () => { throw new Error('not expected'); } },
        archive: { bind: async () => { bindings++; return { id: op.id, revision: 1, taskId: business.task.id, taskGeneration: op.view.taskGeneration, volumeUid: op.volumeUid }; },
          observe: async () => true, commitArchive: async () => { throw new Error('not expected'); } },
      };
      const mounted = business.make({ deletionWorkSources: { ...f.sources, assertGrant: async () => undefined } }), work = mounted.module.projectWork!;
      const guarded = scopedFinalizationPorts(ports, work)!;
      pending = prepareFinalizations(store, finalizationCompletion(f.database.db), guarded, business.runner, work)(op.id);
      const rejected = pending.catch((error: unknown) => error); await entered.promise;
      const [birth] = (await work.history(business.projectId)).filter((row) => !row.exited);
      expect(birth).toMatchObject({ kind: 'lifecycle', reference: op.id });
      await f.database.db.execute(sql`SELECT pg_terminate_backend(${birth!.backendPid})`); expect(await rejected).toBeInstanceOf(Error);
      const context = f.context();
      expect(await work.seal({ ...context, target: { ...context.target, id: business.projectId, serviceId: business.serviceId } })).toEqual({ pending: [birth!.id] });
      const frozen = await store.get(op.id); release.resolve(); await f.waitExit(birth!.id);
      expect(bindings).toBe(0); expect(await store.get(op.id)).toEqual(frozen);
      expect((await work.history(business.projectId))[0]).toMatchObject({ exited: true, recoveryDigest: null });
    } finally { release.resolve(); await pending?.catch(() => undefined); await f.drop(); }
  });
});
