// Actual mounted publication and K8s provisioner; Resources declares use the same Task Executor and must roll back new-epoch writes.
import { afterEach, describe, expect, test } from 'bun:test';
import { Resources } from '@crewstation/k8s';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import type { EnvironmentLedger } from '../ports/ledger';
import { developmentParentPhysicalFixture } from './developmentParentPhysicalFixture';
import type { DevelopmentParentPhysicalFixture } from './developmentParentPhysicalFixture';
import { acceptParentRebuild, stopParentForRebuild, deliverParentRebuild, bindSelectedLedgerRebuild, connectSelectedRebuild } from './developmentParentRebuildFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('selected owner/ledger projection is atomic (real PG)', () => {
  let f: DevelopmentParentPhysicalFixture;
  afterEach(async () => { await f?.close(); });
  const faultLedger = (fail: () => boolean): EnvironmentLedger => ({ ...f.ledger, within: (executor) => {
    const writer = f.ledger.within(executor as object);
    return { ...writer, declare: async (input) => { if (fail() && input.ref === f.parent.id) throw new Error('controlled selected projection declare failed'); return writer.declare(input); } };
  } });
  for (const mode of ['native', 'ledger'] as const) test(mode + ': original completion and new Pod binding never commit over a failed Resources declaration', async () => {
    f = await developmentParentPhysicalFixture(mode); const original = await f.load(f.parent.id), accepted = await acceptParentRebuild(f);
    f.parentPhysical.state.holdPod = true;
    await stopParentForRebuild(f); expect((await f.ending()).phase).toBe('proved'); await f.parentPhysical.finishDeletion();
    const before = { task: await f.load(original.id), ending: await f.ending(), record: await f.uow.read.rebuilds.get(accepted.id), resource: await f.resources.api.get(original.id) };
    f.replace({ ledger: faultLedger(() => true) });
    await f.tdb.db.execute(sql`UPDATE platform_infra.jobs SET run_at=clock_timestamp()-interval '1 second'`); await f.retry();
    expect(await f.load(original.id)).toEqual(before.task); expect((await f.ending()).phase).toBe('proved'); expect((await f.ending()).completionWitness).toBeNull();
    expect((await f.uow.read.rebuilds.get(accepted.id))?.state).toBe('queued'); expect(await f.resources.api.get(original.id)).toEqual(before.resource);
    f.replace(); await f.tdb.db.execute(sql`UPDATE platform_infra.jobs SET run_at=clock_timestamp()-interval '1 second'`); await f.retry();
    const published = await f.load(original.id), source = (await f.uow.read.parentEnding!.endings.get(before.ending.id))!;
    expect(published.state).toBe('creating'); expect(published.rebuildId).toBe(accepted.id); expect(source.phase).toBe('complete');
    expect(Object.hasOwn(published, 'render')).toBe(mode === 'ledger');
    let fail = false, beforeBinding: { task: Awaited<ReturnType<typeof f.load>>; record: Awaited<ReturnType<typeof f.uow.read.rebuilds.get>>; resource: Awaited<ReturnType<typeof f.resources.api.get>> } | undefined;
    const create = f.k8s.create;
    f.k8s.create = async (...args) => {
      const object = await create(...args);
      if (object.kind === 'Pod' && object.metadata.name === published.podName) {
        beforeBinding = { task: await f.load(original.id), record: await f.uow.read.rebuilds.get(accepted.id), resource: await f.resources.api.get(original.id) }; fail = true;
      }
      return object;
    };
    f.replace({ ledger: faultLedger(() => fail) });
    try {
      await deliverParentRebuild(f);
      if (mode === 'ledger') await expect(bindSelectedLedgerRebuild(f, accepted.id)).rejects.toThrow('原请求继续重试');
      expect(beforeBinding).toBeDefined(); expect(await f.load(original.id)).toEqual(beforeBinding!.task);
      const unbound = (await f.uow.read.rebuilds.get(accepted.id))!;
      expect(unbound.podUid).toBe(beforeBinding!.record?.podUid); expect(unbound.secretUid).toBe(beforeBinding!.record?.secretUid);
      expect(unbound.state).toBe('replacing'); expect(await f.resources.api.get(original.id)).toEqual(beforeBinding!.resource);
      expect((await f.uow.read.parentEnding!.endings.get(source.id))?.completionWitness).toEqual(source.completionWitness);
      expect((await f.k8s.get(Resources.Pod!, published.podName, published.namespace))?.metadata.uid).toBeTruthy();
    } finally { fail = false; f.k8s.create = create; f.replace(); }
    await deliverParentRebuild(f); if (mode === 'ledger') await bindSelectedLedgerRebuild(f, accepted.id);
    expect((await f.uow.read.rebuilds.get(accepted.id))?.state).toBe('starting'); expect(await connectSelectedRebuild(f)).toBe(true);
    const ready = await f.load(original.id); expect(ready.state).toBe('running'); expect(ready.runnerTokenHash).toBe(beforeBinding!.task.runnerTokenHash);
    expect(ready.render?.start ?? null).toBe(mode === 'ledger' ? 1 : null); expect(ready.rebuildId).toBe(accepted.id);
    expect((await f.uow.read.parentEnding!.endings.get(source.id))?.completionWitness).toEqual(source.completionWitness);
    expect((await f.k8s.get(Resources.PersistentVolumeClaim!, original.pvcName, original.namespace))?.metadata.uid).toBe(f.pvc.metadata.uid);
  }, 30000);
});
