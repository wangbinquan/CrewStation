// An actual original owner record is required even when the published Task has no ledger render.
import { afterEach, describe, expect, test } from 'bun:test';
import { Resources } from '@crewstation/k8s';
import { testDatabaseAvailable } from '@crewstation/testkit';
import type { Worker } from '@crewstation/queue';
import { sql } from 'drizzle-orm';
import { kubernetesRebuildProvisioner } from '../adapters/k8s/rebuildProvisioner';
import type { RebuildRendering } from '../ports/rebuildRendering';
import { developmentParentPhysicalFixture } from './developmentParentPhysicalFixture';
import type { DevelopmentParentPhysicalFixture } from './developmentParentPhysicalFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('missing original rebuild record cannot become legacy (real PG)', () => {
  let f: DevelopmentParentPhysicalFixture;
  afterEach(async () => { await f?.close(); });
  for (const mode of ['native', 'ledger'] as const) test(mode + ': actual authenticated Runner waits when the accepted source record is missing', async () => {
    f = await developmentParentPhysicalFixture(mode);
    const check = await f.runtime.api.inspectRebuild(f.projectId, true), profile = check.profiles[0]!;
    const accepted = await f.runtime.api.requestRebuild(f.projectId, { requestId: crypto.randomUUID(), expectedTaskId: f.parent.id,
      expectedUpdatedAt: check.updatedAt, expectedPodUid: check.podUid, expectedVolumeUid: check.volume.uid, reason: 'administrator-restart',
      profile: { id: profile.id, name: profile.name, cpu: profile.cpu, memory: profile.memory, storage: profile.storage } });
    const controller = f.controller(); controller.observer.start();
    try { await f.runEnding(); await f.parentPhysical.waitRemoved(); } finally { await controller.observer.stop(); }
    await f.retry(); await f.tdb.db.execute(sql`UPDATE platform_infra.jobs SET run_at=clock_timestamp()-interval '1 second'`);
    await (f.runtime.workers[0] as Worker).runOnce();
    if (mode === 'ledger') {
      const record = (await f.uow.read.rebuilds.get(accepted.id))!, env = await f.load(f.parent.id);
      const provisioner = kubernetesRebuildProvisioner(f.k8s, f.deps.settings.workerUid, (target) => f.runtime.api.inspectDevelopmentRemoval(target));
      const spec = { env, image: record.image, envVars: {}, envSecretName: record.secretName, resources: record.input.profile,
        ...(record.nodeName ? { nodeName: record.nodeName } : {}) };
      const operations: RebuildRendering = {
        prepareSecret: (values, secretUid) => provisioner.prepareSecret({ ...record, ...(secretUid ? { secretUid } : {}) }, values),
        ensurePod: (podUid) => provisioner.ensurePod({ ...record, ...(podUid ? { podUid } : {}) }, spec),
        ensurePreview: () => provisioner.ensurePreview(record, spec), cleanup: (instances) => provisioner.cleanup({ ...record, ...instances }),
      };
      await f.runtime.api.reconcileRebuild(f.parent.id, accepted.id, operations, async () => true);
    }
    const before = await f.load(f.parent.id), record = (await f.uow.read.rebuilds.get(accepted.id))!;
    expect(before.state).toBe('creating'); expect(before.rebuildId).toBe(accepted.id); expect(record.state).toBe('starting');
    expect(Object.hasOwn(before, 'render')).toBe(mode === 'ledger');
    const secret = (await f.k8s.get(Resources.Secret!, before.podName + '-runner', before.namespace))!;
    const token = (secret['stringData'] as Record<string, string>)['CS_RUNNER_TOKEN']!;
    await f.tdb.db.execute(sql`DELETE FROM task_runtime.environment_rebuilds WHERE id=${accepted.id}`);
    expect(await f.uow.read.rebuilds.get(accepted.id)).toBeUndefined();
    expect(await f.runtime.api.onRunnerConnected(before.id, token)).toBe(false);
    const after = await f.load(before.id);
    expect(after.state).toBe('creating'); expect(after.connected).toBe(before.connected);
    expect(after.runnerTokenHash).toBe(before.runnerTokenHash); expect(after.podUid).toBe(before.podUid);
    expect(after.render).toEqual(before.render); expect(after.rebuildId).toBe(accepted.id);
    // Reinstall the same original SQL record, never fabricate a replacement request or epoch.
    await f.uow.run((scope) => scope.rebuilds.insert(record));
    expect(await f.runtime.api.onRunnerConnected(before.id, token)).toBe(true);
    expect((await f.runtime.api.getRebuild(before.id))?.state).toBe('ready');
    expect((await f.load(before.id)).runnerTokenHash).toBe(before.runnerTokenHash);
  }, 20000);
});
