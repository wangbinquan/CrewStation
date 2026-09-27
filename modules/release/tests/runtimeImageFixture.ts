import type { Actor, ProjectId, ReleaseId, RuntimeImageExecutionSnapshot, ServiceId, UserId, TasksSpec } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { createFakeK8sClient } from '@crewstation/k8s';
import { createResourcesModule, resourcesMigrations } from '@crewstation/module-resources';
import { queueMigrations } from '@crewstation/queue';
import { createTestDatabase } from '@crewstation/testkit';
import { drizzleUnitOfWork } from '../adapters/persistence/drizzleUnitOfWork';
import { createReleaseModule, releaseMigrations } from '../wiring';

export async function releaseImageFixture(ledger = false) {
  const tdb = await createTestDatabase([eventbusMigrations, queueMigrations, resourcesMigrations, releaseMigrations]);
  const k8s = createFakeK8sClient(), userId = newResourceId() as UserId, actor: Actor = { userId, isAdmin: true };
  const projectId = newResourceId() as ProjectId, serviceId = newResourceId() as ServiceId, plan = newResourceId();
  const snapshot: RuntimeImageExecutionSnapshot = { versionId: newResourceId(), image: `registry/runtime@sha256:${'a'.repeat(64)}`, digest: `sha256:${'a'.repeat(64)}`, architecture: 'linux/arm64', validationId: newResourceId(), initializerDigest: `sha256:${'b'.repeat(64)}`, initializer: { steps: [], env: {}, secrets: [] }, tools: [], selectionSource: 'configuration' };
  const resources = createResourcesModule({ db: tdb.db, quotas: { limitFor: async () => 4 }, authorizer: { projectAccess: async () => ({ operate: true }) }, isAdmin: async () => true });
  const state = { tasks: undefined as TasksSpec | undefined, taskReservations: [] as unknown[], taskConfirmations: [] as unknown[], refuseTaskImages: false, manifest: { apiVersion: 'crewstation/v3', kind: 'DigitalWorker', spec: { service: { command: ['app'], port: 3000, servicePlanId: plan, runtimeImageVersionId: snapshot.versionId, probes: { readiness: { path: '/ready' } } }, release: { migrationCommand: ['app', 'migrate'] } } }, reads: [] as string[], builds: [] as unknown[], migrations: [] as unknown[], deployed: [] as unknown[], reservations: [] as unknown[], confirmations: [] as unknown[], refuse: false };
  let counter = 0;
  const runtime = createReleaseModule({
    db: tdb.db, k8s, isAdmin: async () => true, authorizer: { authorize: async () => {} },
    ...(ledger ? { ledger: { within: (tx: unknown) => resources.api.owner('release').within(tx as object) }, creation: 'ledger' as const, renderer: { dryRun: async () => {} } } : {}),
    tagger: { createReleaseTag: async () => ({ tag: `v0.0.${++counter}`, commitSha: 'c'.repeat(40) }) },
    repo: { readFile: async (_id, ref) => { state.reads.push(ref); return Bun.YAML.stringify({ ...state.manifest, spec: { ...state.manifest.spec, ...(state.tasks ? { tasks: state.tasks } : {}) } }); }, repositoryUrl: async () => ({ httpUrl: 'http://git/repo', credentialSecretName: 'git' }), buildSource: async () => ({ httpUrl: 'http://git/repo' }), buildToken: async () => ({ token: 'git' }) },
    runtimeImages: { reserveTaskImages: async (input) => {
      state.taskReservations.push(input);
      if (state.refuseTaskImages) throw new Error('task image validation failed');
      return [{ versionId: input.tasks.runtimeImageVersionId!, ownerId: `${input.releaseId}:task` }];
    }, confirmTaskImages: async (references) => {
      const releaseId = references[0]!.ownerId.split(':')[0]!;
      const saved = await drizzleUnitOfWork(tdb.db).read.releases.getById(releaseId as ReleaseId);
      if (!saved?.pipeline.runtimeImageSelections || jsonHash(saved.pipeline.runtimeImageSelections) !== jsonHash(references)) throw new Error('task references confirmed before release snapshot');
      state.taskConfirmations.push(references);
    }, reserve: async (input) => { state.reservations.push(input); if (state.refuse) throw new Error('unvalidated'); return snapshot; }, confirm: async (version, id) => { const saved = await drizzleUnitOfWork(tdb.db).read.releases.getById(id); if (saved?.pipeline.runtimeImage?.versionId !== version) throw new Error('reference confirmed before release snapshot'); state.confirmations.push([version, id]); } },
    delivery: { builder: { start: async (input) => { state.builds.push(input); return { buildRef: 'build' }; }, status: async () => ({ state: 'succeeded' }) }, migrator: { start: async (input) => { state.migrations.push(input); return { migrationRef: 'migration' }; }, status: async () => ({ state: 'succeeded' }) }, deployer: { dryRun: async () => {}, remove: async () => {}, removeWorkload: async () => true, deploy: async (input) => { state.deployed.push(input); }, status: async () => ({ state: 'ready', replicas: 1, readyReplicas: 1 }) } },
    services: { resolveServiceById: async () => ({ projectId, slug: 'image', name: 'image', namespace: 'cs-image' }) },
    plans: { getServicePlan: async () => ({ id: plan, name: 'small', cpu: '1', memory: '1Gi', maxReplicas: 3, description: '' }), lookupComputeProfile: async () => undefined, listComputeProfiles: async () => [] },
    config: { render: async () => ({ values: {}, version: 1 }), validate: async () => ({ missing: [] }) }, data: { envFor: async () => ({}) },
    hosts: { prodHost: () => 'prod.invalid', previewHost: () => 'preview.invalid' }, maintenance: { open: async () => false }, owners: { ownerOf: async () => userId }, notifier: { notify: async () => {} },
    settings: { registryBase: 'registry', buildTimeoutSeconds: 600, deployTimeoutSeconds: 300, builderImage: 'builder', buildkitAddress: 'tcp://buildkitd:1234', workerOwner: 'image-test', serviceDomain: 'svc.internal', userDomain: 'user.invalid' },
  });
  return { runtime, actor, serviceId, projectId, snapshot, state, resources, uow: drizzleUnitOfWork(tdb.db), close: () => tdb.drop() };
}
