// Shared actual selected-request preparation; only Kubernetes scheduling and the digital child are controlled.
import { Resources } from '@crewstation/k8s';
import type { Worker } from '@crewstation/queue';
import { sql } from 'drizzle-orm';
import { kubernetesRebuildProvisioner } from '../adapters/k8s/rebuildProvisioner';
import type { RebuildRendering } from '../ports/rebuildRendering';
import type { DevelopmentParentPhysicalFixture } from './developmentParentPhysicalFixture';

export async function acceptParentRebuild(f: DevelopmentParentPhysicalFixture, admin = true) {
  const check = await f.runtime.api.inspectRebuild(f.projectId, admin), profile = check.profiles[0]!;
  return f.runtime.api.requestRebuild(f.projectId, { requestId: crypto.randomUUID(), expectedTaskId: f.parent.id,
    expectedUpdatedAt: check.updatedAt, expectedPodUid: check.podUid, expectedVolumeUid: check.volume.uid,
    ...(admin ? { reason: 'administrator-restart' as const } : {}),
    profile: { id: profile.id, name: profile.name, cpu: profile.cpu, memory: profile.memory, storage: profile.storage } });
}
export async function stopParentForRebuild(f: DevelopmentParentPhysicalFixture, physical = f.parentPhysical) {
  const controller = f.controller(); controller.observer.start();
  try { await f.runEnding(); await physical.waitRemoved(); } finally { await controller.observer.stop(); }
  await f.retry();
}
export async function deliverParentRebuild(f: DevelopmentParentPhysicalFixture) {
  await f.tdb.db.execute(sql`UPDATE platform_infra.jobs SET run_at=clock_timestamp()-interval '1 second'`);
  return (f.runtime.workers[0] as Worker).runOnce();
}
export async function selectedLedgerRebuildOperations(f: DevelopmentParentPhysicalFixture, id: string): Promise<RebuildRendering> {
  const record = (await f.uow.read.rebuilds.get(id))!, env = await f.load(f.parent.id);
  const provisioner = kubernetesRebuildProvisioner(f.k8s, f.deps.settings.workerUid, (target) => f.runtime.api.inspectDevelopmentRemoval(target));
  const spec = { env, image: record.image, envVars: {}, envSecretName: record.secretName, resources: record.input.profile,
    ...(record.nodeName ? { nodeName: record.nodeName } : {}) };
  return { prepareSecret: (values, secretUid) => provisioner.prepareSecret({ ...record, ...(secretUid ? { secretUid } : {}) }, values),
    ensurePod: (podUid) => provisioner.ensurePod({ ...record, ...(podUid ? { podUid } : {}) }, spec),
    ensurePreview: () => provisioner.ensurePreview(record, spec), cleanup: (instances) => provisioner.cleanup({ ...record, ...instances }) };
}
export async function bindSelectedLedgerRebuild(f: DevelopmentParentPhysicalFixture, id: string) {
  await f.runtime.api.reconcileRebuild(f.parent.id, id, await selectedLedgerRebuildOperations(f, id), async () => true);
}
export async function connectSelectedRebuild(f: DevelopmentParentPhysicalFixture) {
  const env = await f.load(f.parent.id), secret = (await f.k8s.get(Resources.Secret!, env.podName + '-runner', env.namespace))!;
  return f.runtime.api.onRunnerConnected(env.id, (secret['stringData'] as Record<string, string>)['CS_RUNNER_TOKEN']!);
}
