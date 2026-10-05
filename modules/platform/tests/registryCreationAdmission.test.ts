import { describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { NATIVE_REGISTRY_ADMISSION, ProjectIdSchema } from '@crewstation/contracts';
import type { ProjectId } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { withExclusiveDatabaseAdmission } from '@crewstation/persistence';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { createResourcesModule, resourcesMigrations } from '@crewstation/module-resources';
import { runtimeEnvironmentMigrations } from '@crewstation/module-runtime-environment';
import { releaseImageFixture } from '../../release/tests/runtimeImageFixture';
import { k8sBuildFixture } from '../../runtime-environment/tests/k8sBuildFixture';
import { runtimeImageBuildCreationWork, runtimeImageBuildSecretValues } from '../../runtime-environment/application/buildSecretValues';
import { runtimeImageProjectAdmissions } from '../../runtime-environment/adapters/persistence/unitOfWork';
import { registryCreationAdmission } from '../adapters/registryCreationAdmission';

const native = { podUid: '91754092-388a-4131-a452-f9d4b75f0766', nodeUid: '8acdd9b0-3dd8-4a8a-afdf-a1d90a17cf1a', nodeName: 'controlled-test', containerId: 'containerd://' + 'a'.repeat(64), pid: process.pid, pidNamespace: '1000', bootId: '8acdd9b0-3dd8-4a8a-afdf-a1d90a17cf1a', startTicks: '123' };
const available = await testDatabaseAvailable();
async function fixture() {
  const f = await releaseImageFixture(true, () => ({ projectAdmission: { protectCurrent: async () => native, assertAvailable: async () => {} } }));
  Reflect.deleteProperty(f.state.manifest.spec.service, 'runtimeImageVersionId');
  const release = await f.runtime.api.publish(f.actor, f.serviceId, { branch: 'main', version: 'patch' });
  await f.runtime.api.runPipelineStep(release.id);
  const record = (await f.resources.api.list({ kind: 'build-job' }))[0]!; expect(record).toBeDefined();
  const admit = registryCreationAdmission({ db: f.db, resources: f.resources.api.projectDeletion, release: f.runtime,
    images: { withBuildCreationAdmission: async () => { throw Error('Release must not dispatch through another owner'); } } });
  return { ...f, release, record, admit };
}
describe.skipIf(!available)('native creation interval through actual owners and PostgreSQL', () => {
  test('a multi-project image build keeps the actual original callback and source resource admission through the entire Pod apply', async () => {
    const tdb = await createTestDatabase([resourcesMigrations, runtimeEnvironmentMigrations]), f = k8sBuildFixture(), other = newResourceId();
    const projectId = ProjectIdSchema.parse(f.plan.projectId);
    const revision = { ...f.revision, initializerProjectId: other }, entered = Promise.withResolvers<void>(), exit = Promise.withResolvers<void>();
    const resources = createResourcesModule({ db: tdb.db, quotas: { limitFor: async () => 4 }, authorizer: { projectAccess: async () => ({ operate: true }) }, isAdmin: async () => true });
    const admissions = runtimeImageProjectAdmissions({ db: tdb.db, protectCurrent: async () => ({ podUid: native.podUid, nodeUid: native.nodeUid, nodeName: native.nodeName, containerId: native.containerId }), assertAvailable: async () => {} });
    f.update({ resourcePlan: f.plan });
    const values = runtimeImageBuildSecretValues(f.intents, f.credentials, async () => revision, admissions);
    const admit = registryCreationAdmission({ db: tdb.db, resources: resources.api.projectDeletion,
      images: { withBuildCreationAdmission: runtimeImageBuildCreationWork(f.intents, async () => revision, admissions) },
      release: { withResourceCreationAdmission: async () => { throw Error('Image build must dispatch through its actual owner'); } } });
    let applied = false;
    try {
      const pending = admit(projectId, async () => {
        expect((await values({ recordId: f.plan.resourceId, buildId: f.plan.buildId, executionEpoch: f.plan.executionEpoch }))['git-token']).toBe('git-secret');
        const callbacks = await tdb.db.execute<{ original_project_ids: string[] }>(sql`SELECT original_project_ids FROM runtime_environment.deletion_callbacks WHERE exited_at IS NULL`);
        expect(callbacks).toHaveLength(1); expect(callbacks[0]!.original_project_ids).toEqual([projectId, other].sort());
        expect(await resources.api.projectDeletion.withAdmission(other as ProjectId, async () => {})).toBe(true);
        entered.resolve(); await exit.promise; applied = true;
      }, { id: f.plan.resourceId, kind: 'build-job', projectId, owner: { module: 'runtime-environment', ref: f.plan.buildId }, spec: { runtimeImageBuild: f.plan } });
      await entered.promise; let eraserEntered = false;
      const eraser = withExclusiveDatabaseAdmission(tdb.db, 'resources.project-admission:' + other, async () => { eraserEntered = true; expect(applied).toBe(true); });
      const deadline = Date.now() + 3000;
      while (!(await tdb.db.execute<{ waiting: boolean }>(sql`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted) AS waiting`))[0]!.waiting) {
        if (Date.now() > deadline) throw Error('Source resource lock never queued'); await Bun.sleep(10);
      }
      expect(eraserEntered).toBe(false); exit.resolve(); expect(await pending).toBe(true); await eraser;
      expect(await tdb.db.execute(sql`SELECT id FROM runtime_environment.deletion_callbacks WHERE exited_at IS NULL`)).toHaveLength(0);
    } finally { exit.resolve(); await tdb.drop(); }
  }, 15_000);
  test('after actual Git credential rendering returns, the original callback and both real locks remain through the later Job apply', async () => {
    const f = await fixture(), entered = Promise.withResolvers<void>(), exit = Promise.withResolvers<void>(); let jobApplied = false;
    try {
      const pending = f.admit(f.projectId, async () => {
        expect(await f.runtime.api.jobEnvValues({ recordId: f.record.id, releaseId: f.release.id, purpose: 'build' })).toEqual({ GIT_TOKEN: 'git' });
        const active = await f.db.execute<{ backend_pid: number; kind: string; consumer_id: string }>(sql`SELECT backend_pid,kind,consumer_id FROM release.deletion_callbacks WHERE exited_at IS NULL`);
        expect(active).toHaveLength(1); expect(active[0]).toMatchObject({ kind: 'pipeline', consumer_id: f.release.id });
        const held = await f.db.execute<{ held: boolean }>(sql`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=${active[0]!.backend_pid} AND locktype='advisory' AND mode='ShareLock' AND granted
          AND classid=((hashtextextended(${NATIVE_REGISTRY_ADMISSION},0)>>32)&4294967295)::oid AND objid=(hashtextextended(${NATIVE_REGISTRY_ADMISSION},0)&4294967295)::oid) AS held`);
        expect(held[0]!.held).toBe(true); entered.resolve(); await exit.promise; jobApplied = true;
      }, f.record);
      await entered.promise;
      let eraserEntered = false;
      const eraser = withExclusiveDatabaseAdmission(f.db, NATIVE_REGISTRY_ADMISSION, async () => { eraserEntered = true; expect(jobApplied).toBe(true); });
      const deadline = Date.now() + 3000;
      while (!(await f.db.execute<{ waiting: boolean }>(sql`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted) AS waiting`))[0]!.waiting) {
        if (Date.now() > deadline) throw Error('Original native eraser did not reach the actual lock'); await Bun.sleep(10);
      }
      expect(eraserEntered).toBe(false); expect(jobApplied).toBe(false);
      expect(await f.db.execute(sql`SELECT id FROM release.deletion_callbacks WHERE exited_at IS NULL`)).toHaveLength(1);
      exit.resolve(); expect(await pending).toBe(true); await eraser;
      expect(await f.db.execute(sql`SELECT id FROM release.deletion_callbacks WHERE exited_at IS NULL`)).toHaveLength(0);
      const completed = await f.db.execute<{ exit_digest: string }>(sql`SELECT exit_digest FROM release.deletion_callbacks WHERE consumer_id=${f.release.id} AND kind='pipeline' ORDER BY entered_at DESC LIMIT 1`);
      expect(completed[0]!.exit_digest).toMatch(/^[a-f0-9]{64}$/);
    } finally { exit.resolve(); await f.close(); }
  }, 15_000);
  test('a closed resource admission or substituted owner/project cannot create a native object or reinterpret the original release', async () => {
    const f = await fixture(); let mutations = 0;
    try {
      await expect(f.admit(newResourceId(), async () => { mutations++; }, f.record)).rejects.toThrow('项目身份');
      await expect(f.admit(f.projectId, async () => { mutations++; }, { ...f.record, owner: { ...f.record.owner, module: 'runtime-environment' } })).rejects.toThrow('台账归属');
      await expect(f.admit(f.projectId, async () => { mutations++; }, { ...f.record, owner: { ...f.record.owner, ref: newResourceId() + '/build' } })).rejects.toThrow('台账归属');
      await withExclusiveDatabaseAdmission(f.db, 'resources.project-admission:' + f.projectId, async tx => {
        await tx.execute(sql`INSERT INTO resources.deletion_fences(project_id,operation_id,generation) VALUES(${f.projectId},${newResourceId()},1)`);
      });
      expect(await f.admit(f.projectId, async () => { mutations++; }, f.record)).toBe(false); expect(mutations).toBe(0);
      expect(await f.db.execute(sql`SELECT id FROM release.deletion_callbacks WHERE exited_at IS NULL`)).toHaveLength(0);
    } finally { await f.close(); }
  }, 15_000);
});
