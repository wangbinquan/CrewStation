// Real selected source and K8s provisioner with a controlled asynchronous preview boundary; readiness is the actual Runner API.
import { afterEach, describe, expect, test } from 'bun:test';
import { Resources } from '@crewstation/k8s';
import { testDatabaseAvailable } from '@crewstation/testkit';
import type { Worker } from '@crewstation/queue';
import { sql } from 'drizzle-orm';
import { kubernetesRebuildProvisioner } from '../adapters/k8s/rebuildProvisioner';
import type { RebuildRendering } from '../ports/rebuildRendering';
import { developmentParentPhysicalFixture } from './developmentParentPhysicalFixture';
import type { DevelopmentParentPhysicalFixture } from './developmentParentPhysicalFixture';
import { endingCheckpoint } from './developmentParentEndingLeaseFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('selected parent strict Runner readiness (real PG)', () => {
  let f: DevelopmentParentPhysicalFixture;
  afterEach(async () => { await f?.close(); });
  const prepare = async () => {
    f = await developmentParentPhysicalFixture('ledger');
    const check = await f.runtime.api.inspectRebuild(f.projectId, true), profile = check.profiles[0]!;
    const accepted = await f.runtime.api.requestRebuild(f.projectId, { requestId: crypto.randomUUID(), expectedTaskId: f.parent.id,
      expectedUpdatedAt: check.updatedAt, expectedPodUid: check.podUid, expectedVolumeUid: check.volume.uid, reason: 'administrator-restart',
      profile: { id: profile.id, name: profile.name, cpu: profile.cpu, memory: profile.memory, storage: profile.storage } });
    const controller = f.controller(); controller.observer.start();
    try { await f.runEnding(); await f.parentPhysical.waitRemoved(); } finally { await controller.observer.stop(); }
    await f.retry(); await f.tdb.db.execute(sql`UPDATE platform_infra.jobs SET run_at=clock_timestamp()-interval '1 second'`);
    await (f.runtime.workers[0] as Worker).runOnce();
    const record = (await f.uow.read.rebuilds.get(accepted.id))!, env = await f.load(f.parent.id);
    const provisioner = kubernetesRebuildProvisioner(f.k8s, f.deps.settings.workerUid, (target) => f.runtime.api.inspectDevelopmentRemoval(target));
    const spec = { env, image: record.image, envVars: {}, envSecretName: record.secretName, resources: record.input.profile, ...(record.nodeName ? { nodeName: record.nodeName } : {}) };
    const ops: RebuildRendering = { prepareSecret: (values, secretUid) => provisioner.prepareSecret({ ...record, ...(secretUid ? { secretUid } : {}) }, values),
      ensurePod: (podUid) => provisioner.ensurePod({ ...record, ...(podUid ? { podUid } : {}) }, spec),
      ensurePreview: () => provisioner.ensurePreview(record, spec), cleanup: (instances) => provisioner.cleanup({ ...record, ...instances }) };
    return { accepted, ops };
  };
  const token = async () => {
    const env = await f.load(f.parent.id), secret = (await f.k8s.get(Resources.Secret!, env.podName + '-runner', env.namespace))!;
    return (secret['stringData'] as Record<string, string>)['CS_RUNNER_TOKEN']!;
  };
  test('an older actual preparation cannot downgrade a later starting/ready result after its external preview returns', async () => {
    const { accepted, ops } = await prepare(), entered = endingCheckpoint(), resume = endingCheckpoint();
    const delayed = { ...ops, ensurePreview: async (...args: Parameters<typeof ops.ensurePreview>) => { await ops.ensurePreview(...args); entered.resolve(); await resume.promise; } };
    const first = f.runtime.api.reconcileRebuild(f.parent.id, accepted.id, delayed, async () => true);
    try {
      await entered.promise; expect((await f.uow.read.rebuilds.get(accepted.id))?.state).toBe('replacing');
      expect(await f.runtime.api.onRunnerConnected(f.parent.id, await token())).toBe(false);
      await f.runtime.api.reconcileRebuild(f.parent.id, accepted.id, ops, async () => true);
      expect((await f.uow.read.rebuilds.get(accepted.id))?.state).toBe('starting');
      expect(await f.runtime.api.onRunnerConnected(f.parent.id, await token())).toBe(true);
      const ready = await f.load(f.parent.id); resume.resolve(); await first;
      expect((await f.uow.read.rebuilds.get(accepted.id))?.state).toBe('ready'); expect((await f.load(f.parent.id)).state).toBe('running');
      expect((await f.load(f.parent.id)).runnerTokenHash).toBe(ready.runnerTokenHash); expect((await f.load(f.parent.id)).podUid).toBe(ready.podUid);
      expect((await f.load(f.parent.id)).render?.start).toBe(1);
    } finally { resume.resolve(); await first; }
  }, 20000);
  test('explicit malformed original binding cannot promote a real authenticated Runner into readiness', async () => {
    const { accepted, ops } = await prepare(); await f.runtime.api.reconcileRebuild(f.parent.id, accepted.id, ops, async () => true);
    const before = await f.load(f.parent.id), record = (await f.uow.read.rebuilds.get(accepted.id))!, originalToken = await token();
    for (const malformed of [false, null, { version: 1, kind: 'pending-ending' }]) {
      await f.tdb.db.execute(sql`UPDATE task_runtime.environment_rebuilds SET development_parent_binding=${JSON.stringify(malformed)}::jsonb WHERE id=${accepted.id}`);
      await expect(f.runtime.api.onRunnerConnected(before.id, originalToken)).rejects.toThrow();
      expect((await f.load(before.id)).state).toBe('creating'); expect((await f.load(before.id)).runnerTokenHash).toBe(before.runnerTokenHash);
      expect((await f.uow.read.rebuilds.get(accepted.id))?.state).toBe('starting');
    }
    await f.tdb.db.execute(sql`UPDATE task_runtime.environment_rebuilds SET development_parent_binding=${JSON.stringify(record.developmentParentBinding)}::jsonb WHERE id=${accepted.id}`);
    expect(await f.runtime.api.onRunnerConnected(before.id, originalToken)).toBe(true); expect((await f.runtime.api.getRebuild(before.id))?.state).toBe('ready');
  }, 20000);
});
