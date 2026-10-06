import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { eventbusMigrations } from '@crewstation/eventbus';
import { PROJECT_DELETION_PHASES, ProjectDeletionTargetSchema } from '@crewstation/contracts';
import type { ProjectDeletionContext, ProjectId, ServiceId } from '@crewstation/contracts';
import { releaseMigrations } from '../wiring';
import { nativeReleaseWorkPhysics } from '../adapters/native/projectWork';
import { releaseDeletionRepository } from '../adapters/persistence/projectDeletion';
import { releaseProjectAdmissions } from '../adapters/persistence/drizzleUnitOfWork';
import { releaseProjectDeletionOwner } from '../application/projectDeletion';
import type { ReleaseNativeWorkSource } from '../ports/nativeProjectWork';
const fixtures: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.drop(); });
const available = await testDatabaseAvailable();
async function setup() {
  const tdb = await createTestDatabase([eventbusMigrations, releaseMigrations]); fixtures.push(tdb);
  const project = newResourceId() as ProjectId, service = newResourceId() as ServiceId;
  const target = ProjectDeletionTargetSchema.parse({ id: project, serviceId: service, slug: 'demo', name: 'Demo', namespace: 'cs-demo', kind: 'DigitalWorker', state: 'active', revision: '1', prodHost: 'demo.test', previewHost: 'preview.demo.test', serviceHost: 'demo' });
  const operationId = newResourceId(), controls = { calls: 0, exit: false, wrongSource: false, native: 0 };
  const assertGrant = async (context: ProjectDeletionContext) => { if (context.operationId !== operationId) throw Error('wrong grant'); };
  const services = { resolveServiceById: async (id: ServiceId) => id === service ? { projectId: project, slug: 'demo', name: 'Demo', namespace: 'cs-demo' } : undefined };
  const native = { identity: jsonHash('native source'), epoch: jsonHash('native epoch'), body: { originalPodUid: 'original-native-pod' }, objects: [] };
  let confirmed: Awaited<ReturnType<typeof owner.inspect>>;
  const context = (phase: ProjectDeletionContext['phase']): ProjectDeletionContext => ({ operationId, target, confirmed, phase, generation: 1 });
  const proof: ReleaseNativeWorkSource['prove'] = async (_context, original) => { controls.calls++; return { kind: 'done', sourceIdentity: controls.wrongSource ? jsonHash('replacement') : original.identity, scopeDigest: jsonHash(original), digest: jsonHash(controls), independent: true, producersClosed: true, consumersStopped: true, nativeRemaining: controls.native, storageRemaining: 0, callbackExits: [] }; };
  const source: ReleaseNativeWorkSource = { capture: async () => ({ native, complete: true, blockers: [], references: [] }), inspect: async () => ({ complete: true, blockers: [], references: [] }), stop: proof, purge: proof, prove: proof, callbackExit: async row => controls.exit ? jsonHash({ actualProcessExit: row.process }) : undefined };
  const repository = releaseDeletionRepository({ db: tdb.db, services, assertGrant }), physics = nativeReleaseWorkPhysics({ db: tdb.db, services, assertGrant, source });
  const owner = releaseProjectDeletionOwner({ repository, physics, assertGrant });
  const admissions = releaseProjectAdmissions({ db: tdb.db, assertAvailable: async () => {}, protectCurrent: async () => ({ podUid: '91754092-388a-4131-a452-f9d4b75f0766', nodeUid: '8acdd9b0-3dd8-4a8a-afdf-a1d90a17cf1a', nodeName: 'original-node', containerId: 'containerd://' + 'a'.repeat(64), pid: process.pid, pidNamespace: '1000', bootId: '8acdd9b0-3dd8-4a8a-afdf-a1d90a17cf1a', startTicks: '123' }) });
  await admissions.run(project, service, { kind: 'pipeline', consumerId: newResourceId(), inputDigest: jsonHash('original input') }, async () => {});
  return { tdb, controls, repository, physics, owner, target, context, native, admissions, project, service, confirm: async () => { confirmed = await owner.inspect(target); return confirmed; } };
}
describe.skipIf(!available)('native release work factory with actual durable module ownership', () => {
  test('complete callback growth updates coverage revision but preserves original epoch; replacing native epoch remains visible', async () => {
    const x = await setup(), before = await x.confirm();
    await x.admissions.run(x.project, x.service, { kind: 'ledger', consumerId: newResourceId(), inputDigest: jsonHash('next original input') }, async () => {});
    x.native.identity = jsonHash('next full selector');
    const after = await x.confirm();
    expect(after.revision).not.toBe(before.revision);
    for (const previous of before.resources.filter(row => row.kind.startsWith('release-coverage:'))) {
      expect(after.resources.find(row => row.kind === previous.kind)?.sourceIdentity).toBe(previous.sourceIdentity);
    }
    x.native.epoch = jsonHash('replacement native origin'); const replaced = await x.confirm();
    expect(replaced.resources.find(row => row.kind.startsWith('release-coverage:'))?.sourceIdentity)
      .not.toBe(after.resources.find(row => row.kind.startsWith('release-coverage:'))?.sourceIdentity);
  });
  test('actual finally and all durable phases survive factory reconstruction; native resources still block replay after metadata', async () => {
    const x = await setup(); expect((await x.confirm()).complete).toBe(true);
    for (const phase of PROJECT_DELETION_PHASES) expect((await x.owner.run(x.context(phase))).kind).toBe('done');
    expect((await x.repository.content(x.target)).rows).toHaveLength(0);
    x.controls.native = 1; expect((await x.owner.run(x.context('verify'))).kind).toBe('waiting');
    x.controls.native = 0; expect((await x.owner.run(x.context('verify'))).kind).toBe('done');
  });
  test('unfinished original callback requires independent process exit; replacing frozen work or native source cannot run a mutation', async () => {
    const x = await setup();
    await x.tdb.db.execute(sql`ALTER TABLE release.deletion_callbacks DISABLE TRIGGER release_project_callback_guard`);
    await x.tdb.db.execute(sql`UPDATE release.deletion_callbacks SET exited_at=NULL,exit_digest=NULL`);
    await x.tdb.db.execute(sql`ALTER TABLE release.deletion_callbacks ENABLE TRIGGER release_project_callback_guard`);
    await x.confirm(); expect((await x.owner.run(x.context('seal'))).kind).toBe('done');
    expect((await x.owner.run(x.context('stop'))).kind).toBe('waiting');
    const original = (await x.repository.retained(x.target))!.physical!, changed = structuredClone(original);
    const body = changed.nativeHistory!.body as { native: { body: unknown } }; body.native.body = { substituted: true }; changed.nativeHistory!.digest = jsonHash(body);
    const calls = x.controls.calls; await expect(x.physics.stop(x.context('stop'), changed)).rejects.toThrow('持久确认'); expect(x.controls.calls).toBe(calls);
    x.controls.wrongSource = true; await expect(x.physics.stop(x.context('stop'), original)).rejects.toThrow('留存工作出生');
    x.controls.wrongSource = false; x.controls.exit = true; expect((await x.owner.run(x.context('stop'))).kind).toBe('done');
  });
});
