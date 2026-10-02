// Real worker attempts exhaust their own queue lease while provisioning, then a recreated module resumes the same published request.
import { afterEach, describe, expect, test } from 'bun:test';
import { Resources } from '@crewstation/k8s';
import { testDatabaseAvailable } from '@crewstation/testkit';
import type { Worker } from '@crewstation/queue';
import type { Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { REBUILD_JOB_KIND } from '../ports/rebuilds';
import { DevelopmentParentRebuildBindingSchema } from '../domain/development/parentRebuildBinding';
import { readDevelopmentParentEnding } from '../domain/development/parentEnding';
import { developmentParentPhysicalFixture } from './developmentParentPhysicalFixture';
import type { DevelopmentParentPhysicalFixture } from './developmentParentPhysicalFixture';
import { acceptParentRebuild, stopParentForRebuild, deliverParentRebuild, connectSelectedRebuild } from './developmentParentRebuildFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('published request durable mounted recovery (real PG)', () => {
  let f: DevelopmentParentPhysicalFixture;
  afterEach(async () => { await f?.close(); });
  const jobs = (id: string) => f.tdb.db.execute<{ id: number; state: string; attempts: number; max_attempts: number; fencing_token: number }>(sql`SELECT id,state,attempts,max_attempts,fencing_token
    FROM platform_infra.jobs WHERE kind=${REBUILD_JOB_KIND} AND dedup_key=${id} ORDER BY id`);
  for (const sourceKind of ['pending-ending', 'completed-ending'] as const) test(sourceKind + ': a dead actual owner job is refilled after factory recreation without rotating the published epoch', async () => {
    f = await developmentParentPhysicalFixture('native'); const first = await acceptParentRebuild(f); await stopParentForRebuild(f);
    let selected = first;
    if (sourceKind === 'completed-ending') {
      await deliverParentRebuild(f); const physical = await f.rebuiltPhysical();
      await f.runtime.api.markFailed(f.parent.id, 'controlled new epoch failure before second acceptance'); await stopParentForRebuild(f, physical);
      expect((await f.load(f.parent.id)).state).toBe('failed'); selected = await acceptParentRebuild(f, false);
    }
    f.replace({ ledger: { ...f.ledger, within: (executor) => {
      const tx = executor as Executor, writer = f.ledger.within(tx as object);
      return { ...writer, flushDeferredChanges: async () => {
        await writer.flushDeferredChanges!();
        // Expire this actual running job only after the new Pod binding is staged in its SQL transaction.
        // The production wall-clock/fence check rejects and rolls back that binding; no fake callback proof is supplied.
        await tx.execute(sql`UPDATE platform_infra.jobs AS job SET lease_until=clock_timestamp()-interval '1 second'
          FROM task_runtime.environment_rebuilds AS request,task_runtime.environments AS current
          WHERE job.kind=${REBUILD_JOB_KIND} AND job.dedup_key=${selected.id} AND job.state='running'
            AND request.id=${selected.id} AND request.pod_uid IS NOT NULL AND current.id=request.task_id
            AND current.rebuild_id=request.id AND current.state='creating' AND current.parent_ending IS NULL`);
      } };
    } } });
    for (let attempt = 0; attempt < 5; attempt++) expect(await deliverParentRebuild(f)).toBe(1);
    f.replace();
    const dead = await jobs(selected.id), before = await f.load(f.parent.id), record = (await f.uow.read.rebuilds.get(selected.id))!;
    expect(dead.at(-1)).toMatchObject({ state: 'dead', attempts: 5, max_attempts: 5 }); expect(record.state).toBe('replacing');
    expect(record.failureReason).toBeUndefined(); expect(record.secretUid).toBeTruthy(); expect(record.podUid).toBeUndefined();
    expect(readDevelopmentParentEnding(before)).toBeUndefined(); expect(Object.hasOwn(before, 'render')).toBe(false);
    const binding = DevelopmentParentRebuildBindingSchema.parse(record.developmentParentBinding), source = (await f.uow.read.parentEnding!.endings.get(binding.endingId))!;
    expect(binding.kind).toBe(sourceKind); expect(source.phase).toBe('complete');
    const claim = await f.uow.read.parentEnding!.claims.get(source.id);
    if (sourceKind === 'completed-ending') expect(claim).toMatchObject({ state: 'published', currentRebuildId: selected.id }); else expect(claim).toBeUndefined();
    f.replace(); await (f.runtime.workers[5] as Worker).runOnce();
    const queued = await jobs(selected.id); expect(queued).toHaveLength(dead.length + 1);
    expect(queued.at(-1)).toMatchObject({ state: 'pending', attempts: 0, max_attempts: 5 }); expect(queued.at(-1)?.id).not.toBe(dead.at(-1)?.id);
    expect(await f.load(f.parent.id)).toEqual(before); expect((await f.uow.read.parentEnding!.endings.get(source.id))?.completionWitness).toEqual(source.completionWitness);
    await deliverParentRebuild(f); expect((await f.uow.read.rebuilds.get(selected.id))?.state).toBe('starting');
    expect(await connectSelectedRebuild(f)).toBe(true); const ready = await f.load(f.parent.id);
    expect(ready.state).toBe('running'); expect(ready.rebuildId).toBe(selected.id); expect(ready.runnerTokenHash).toBe(before.runnerTokenHash); expect(ready.render).toBeUndefined();
    expect((await f.uow.read.parentEnding!.endings.get(source.id))?.completionWitness).toEqual(source.completionWitness);
    expect((await f.k8s.get(Resources.PersistentVolumeClaim!, ready.pvcName, ready.namespace))?.metadata.uid).toBe(f.pvc.metadata.uid);
    await (f.runtime.workers[5] as Worker).runOnce(); expect(await jobs(selected.id)).toHaveLength(queued.length);
  }, 35000);
});
