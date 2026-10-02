// Real selected ledger source, actual Runner connection and initialization API; the external status read races the final SQL commit.
import { afterEach, describe, expect, test } from 'bun:test';
import { Resources } from '@crewstation/k8s';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { developmentParentPhysicalFixture } from './developmentParentPhysicalFixture';
import type { DevelopmentParentPhysicalFixture } from './developmentParentPhysicalFixture';
import { imageSnapshot } from './runtimeImageFixture';
import { acceptParentRebuild, stopParentForRebuild, deliverParentRebuild, bindSelectedLedgerRebuild, connectSelectedRebuild } from './developmentParentRebuildFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('selected initialization final source recheck (real PG)', () => {
  let f: DevelopmentParentPhysicalFixture;
  afterEach(async () => { await f?.close(); });
  for (const damage of ['missing-record', 'malformed-binding'] as const) test(damage + ': a prior accepted connection cannot publish readiness after the original source changes', async () => {
    f = await developmentParentPhysicalFixture('ledger'); const image = imageSnapshot(), parent = await f.load(f.parent.id);
    const pod = (await f.k8s.get(Resources.Pod!, parent.podName, parent.namespace))!;
    const containers = (pod.spec as { containers: Array<Record<string, unknown>> }).containers.map((c) => ({ ...c, image: image.image }));
    await f.k8s.mergePatch(Resources.Pod!, parent.podName, parent.namespace, { spec: { containers } });
    // Controlled original image selection before admission, with matching actual Pod image; no completion or source is forged.
    await f.uow.run((scope) => scope.environments.update({ ...parent, render: { image: image.image, workerUid: f.deps.settings.workerUid,
      resources: f.profiles[0]!, start: 1, runtimeImage: image } }));
    const accepted = await acceptParentRebuild(f); await stopParentForRebuild(f); await deliverParentRebuild(f); await bindSelectedLedgerRebuild(f, accepted.id);
    expect(await connectSelectedRebuild(f)).toBe(true); const before = await f.load(parent.id), original = (await f.uow.read.rebuilds.get(accepted.id))!;
    expect(before.state).toBe('creating'); expect(before.connected).toBe(true); expect(before.render?.start).toBe(2); expect(original.state).toBe('starting');
    let damageSource = true;
    f.replace({ testRunner: { listEvents: async () => [], connectionStatus: async () => ({ connected: true, capabilities: { protocols: [], pty: false, preview: false, runtimeInitialization: 1 } }),
      sendCommand: async (id) => {
        const current = await f.load(id), containerIdentity = `${current.podUid}/1234`;
        const executionId = new Bun.CryptoHasher('sha256').update(`${id}/${current.render!.start}/${containerIdentity}/${image.versionId}/${image.initializerDigest}`).digest('hex');
        if (damageSource) {
          if (damage === 'missing-record') await f.tdb.db.execute(sql`DELETE FROM task_runtime.environment_rebuilds WHERE id=${accepted.id}`);
          else await f.tdb.db.execute(sql`UPDATE task_runtime.environment_rebuilds SET development_parent_binding='false'::jsonb WHERE id=${accepted.id}`);
        }
        return { enabled: true, state: 'succeeded', executionId, containerIdentity, versionId: image.versionId, steps: [], checks: [] };
      } } });
    if (damage === 'missing-record') expect(await f.runtime.api.reconcile()).toBe(0);
    else await expect(f.runtime.api.reconcile()).rejects.toThrow();
    const after = await f.load(parent.id); expect(after.state).toBe('creating'); expect(after.runnerTokenHash).toBe(before.runnerTokenHash);
    expect(after.runtimeInitialization).toEqual(before.runtimeInitialization); expect(after.render).toEqual(before.render); expect(after.podUid).toBe(before.podUid);
    damageSource = false;
    if (damage === 'missing-record') await f.uow.run((scope) => scope.rebuilds.insert(original));
    else await f.tdb.db.execute(sql`UPDATE task_runtime.environment_rebuilds SET development_parent_binding=${JSON.stringify(original.developmentParentBinding)}::jsonb WHERE id=${accepted.id}`);
    expect(await f.runtime.api.reconcile()).toBe(1); expect((await f.load(parent.id)).state).toBe('running');
    expect((await f.uow.read.rebuilds.get(accepted.id))?.state).toBe('ready'); expect((await f.load(parent.id)).runnerTokenHash).toBe(before.runnerTokenHash);
  }, 25000);
});
