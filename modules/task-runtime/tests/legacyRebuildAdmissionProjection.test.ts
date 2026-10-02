import { describe, expect, test } from 'bun:test';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { REBUILD_JOB_KIND } from '../ports/rebuilds';
import { rebuildFixture } from './rebuildFixture';

const available = await testDatabaseAvailable();
type Fixture = Awaited<ReturnType<typeof rebuildFixture>>;
const jobs = async (f: Fixture) => [...await f.tdb.db.execute(sql`SELECT kind, payload, state FROM platform_infra.jobs ORDER BY id`)];

// Both creators use the real Task/Resources transaction. Kubernetes scheduling remains controlled.
describe.skipIf(!available)('legacy failed workspace rebuild admission with actual ledger (real PG)', () => {
  for (const creator of ['owner', 'ledger'] as const) {
    const fixture = () => rebuildFixture(creator === 'ledger' ? { ledger: true } : { ownerWithLedger: true });
    test(`${creator}: the original rebuild record is readable during quota admission and replays without another job or quota`, async () => {
      const f = await fixture();
      try {
        const input = await f.request(), before = (await f.uow.read.environments.getById(f.env.id))!;
        const objects = structuredClone([...f.k8s.objects]);
        expect(before.state).toBe('failed'); expect(before.parentEnding).toBeUndefined(); expect(before.rebuildId).toBeUndefined();
        expect(await f.resources!.api.occupancy(f.projectId)).toBe(0);
        const record = await f.runtime.api.requestRebuild(f.projectId, input), accepted = (await f.uow.read.environments.getById(f.env.id))!;
        const stored = (await f.uow.read.rebuilds.get(record.id))!;
        expect(record.state).toBe('queued'); expect(stored.taskId).toBe(before.id);
        expect(stored.creation).toBe(creator);
        expect(accepted).toMatchObject({ id: before.id, projectId: before.projectId, state: 'creating', connected: false,
          namespace: before.namespace, pvcName: before.pvcName, podName: stored.podName, rebuildId: stored.id });
        expect(accepted.podName).not.toBe(before.podName); expect(accepted.runnerTokenHash).not.toBe(before.runnerTokenHash);
        expect(await f.resources!.api.occupancy(f.projectId)).toBe(1);
        if (creator === 'ledger') {
          expect(accepted.render?.rebuild?.id).toBe(record.id);
          expect((await f.resources!.api.get(before.id))?.spec['rebuild']).toMatchObject({ id: record.id, volumeUid: input.expectedVolumeUid });
        } else expect(accepted.render).toEqual(before.render);
        const acceptedJobs = await jobs(f);
        expect(acceptedJobs.filter((job) => job.kind === REBUILD_JOB_KIND)).toEqual(creator === 'owner'
          ? [{ kind: REBUILD_JOB_KIND, payload: { requestId: record.id }, state: 'pending' }] : []);
        expect(await f.runtime.api.requestRebuild(f.projectId, input)).toEqual(record);
        expect(await jobs(f)).toEqual(acceptedJobs); expect(await f.resources!.api.occupancy(f.projectId)).toBe(1);
        expect([...f.k8s.objects]).toEqual(objects); expect(f.state.checkoutCalls).toBe(1);
      } finally { await f.close(); }
    });
    test(`${creator}: a real quota rejection rolls back record, Task, Resources and jobs; the same request succeeds after quota recovery`, async () => {
      const f = await fixture();
      try {
        const input = await f.request(), before = (await f.uow.read.environments.getById(f.env.id))!;
        const resource = await f.resources!.api.get(before.id), originalJobs = await jobs(f), objects = structuredClone([...f.k8s.objects]);
        expect(before.state).toBe('failed'); expect(before.parentEnding).toBeUndefined(); expect(before.rebuildId).toBeUndefined();
        expect(await f.resources!.api.occupancy(f.projectId)).toBe(0);
        f.state.quota = 0;
        await expect(f.runtime.api.requestRebuild(f.projectId, input)).rejects.toMatchObject({ kind: 'quota_exceeded' });
        expect(await f.uow.read.rebuilds.findRequest(f.projectId, input.requestId)).toBeUndefined();
        expect(await f.uow.read.environments.getById(before.id)).toEqual(before);
        expect(await f.resources!.api.get(before.id)).toEqual(resource); expect(await f.resources!.api.occupancy(f.projectId)).toBe(0);
        expect(await jobs(f)).toEqual(originalJobs); expect([...f.k8s.objects]).toEqual(objects);
        f.state.quota = 2;
        const recovered = await f.runtime.api.requestRebuild(f.projectId, input), recoveredJobs = await jobs(f);
        expect(recovered.state).toBe('queued'); expect((await f.uow.read.rebuilds.findRequest(f.projectId, input.requestId))?.id).toBe(recovered.id);
        expect(await f.runtime.api.requestRebuild(f.projectId, input)).toEqual(recovered);
        expect(await f.resources!.api.occupancy(f.projectId)).toBe(1); expect(await jobs(f)).toEqual(recoveredJobs);
        expect([...f.k8s.objects]).toEqual(objects); expect(f.state.checkoutCalls).toBe(1);
      } finally { await f.close(); }
    });
  }
});
