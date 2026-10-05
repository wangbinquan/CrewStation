import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { PROJECT_DELETION_PHASES, ProjectDeletionTargetSchema } from '@crewstation/contracts';
import type { ProjectDeletionContext } from '@crewstation/contracts';
import { runtimeImageFixture } from './runtimeImageFixture';
import { nativeRuntimeImageWorkPhysics } from '../adapters/native/projectWork';
import { runtimeImageDeletionRepository } from '../adapters/persistence/projectDeletion';
import { runtimeImageProjectAdmissions } from '../adapters/persistence/unitOfWork';
import { runtimeImageProjectDeletionOwner } from '../application/projectDeletion';
import type { RuntimeImageNativeWorkSource } from '../ports/nativeProjectWork';

const fixtures: Awaited<ReturnType<typeof runtimeImageFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.tdb.drop(); });
const available = await testDatabaseAvailable();
async function setup() {
  const f = await runtimeImageFixture(); fixtures.push(f);
  const target = ProjectDeletionTargetSchema.parse({ id: f.project, slug: 'demo', name: 'Demo', namespace: 'cs-demo', kind: 'DigitalWorker', state: 'active', revision: '1', prodHost: 'demo.test', previewHost: 'preview.demo.test', serviceHost: 'demo' });
  const operationId = newResourceId(), native = { identity: jsonHash('native source'), epoch: jsonHash('native epoch'), body: { originalPodUid: 'original-native-pod' }, objects: [] };
  const controls = { calls: 0, exit: false, wrongSource: false, native: 0 };
  const assertGrant = async (context: ProjectDeletionContext) => { if (context.operationId !== operationId) throw Error('wrong grant'); };
  let confirmed: Awaited<ReturnType<typeof owner.inspect>>;
  const context = (phase: ProjectDeletionContext['phase']): ProjectDeletionContext => ({ operationId, target, confirmed, phase, generation: 1 });
  const proof: RuntimeImageNativeWorkSource['prove'] = async (_context, original) => { controls.calls++; return { kind: 'done', sourceIdentity: controls.wrongSource ? jsonHash('replacement') : original.identity, scopeDigest: jsonHash(original), digest: jsonHash(controls), independent: true, producersClosed: true, consumersStopped: true, nativeRemaining: controls.native, storageRemaining: 0, callbackExits: [] }; };
  const source: RuntimeImageNativeWorkSource = { capture: async () => ({ native, complete: true, blockers: [], references: [] }), inspect: async () => ({ complete: true, blockers: [], references: [] }), stop: proof, purge: proof, prove: proof, callbackExit: async row => controls.exit ? jsonHash({ actualProcessExit: row.process }) : undefined };
  const repository = runtimeImageDeletionRepository({ db: f.tdb.db, assertGrant });
  const physics = nativeRuntimeImageWorkPhysics({ db: f.tdb.db, assertGrant, source });
  const owner = runtimeImageProjectDeletionOwner({ repository, physics, assertGrant });
  const admissions = runtimeImageProjectAdmissions({ db: f.tdb.db, assertAvailable: async () => {}, protectCurrent: async () => ({ podUid: '91754092-388a-4131-a452-f9d4b75f0766', nodeUid: '8acdd9b0-3dd8-4a8a-afdf-a1d90a17cf1a', nodeName: 'original-node', containerId: 'containerd://' + 'a'.repeat(64) }) });
  await admissions.run([f.project, f.otherProject], { kind: 'source', id: newResourceId(), inputDigest: jsonHash('original input') }, async () => {});
  return { f, controls, repository, physics, owner, target, context, confirm: async () => { confirmed = await owner.inspect(target); return confirmed; } };
}
describe.skipIf(!available)('native runtime work factory with actual durable module ownership', () => {
  test('all phases read actual finally, retain foreign membership and independently recheck native resources after metadata', async () => {
    const x = await setup(); expect((await x.confirm()).complete).toBe(true);
    for (const phase of PROJECT_DELETION_PHASES) expect((await x.owner.run(x.context(phase))).kind).toBe('done');
    expect((await x.repository.content(x.target)).callbacks).toHaveLength(0);
    expect((await x.f.uow.read.projectContent(x.f.otherProject)).callbacks).toHaveLength(1);
    x.controls.native = 1; expect((await x.owner.run(x.context('verify'))).kind).toBe('waiting');
    x.controls.native = 0; expect((await x.owner.run(x.context('verify'))).kind).toBe('done');
  });
  test('lost DB callbacks do not prove exit; substituted frozen work and acknowledgement source are rejected before mutation', async () => {
    const x = await setup();
    await x.f.tdb.db.execute(sql`ALTER TABLE runtime_environment.deletion_callbacks DISABLE TRIGGER runtime_project_callback_guard`);
    await x.f.tdb.db.execute(sql`UPDATE runtime_environment.deletion_callbacks SET exited_at=NULL,exit_digest=NULL`);
    await x.f.tdb.db.execute(sql`ALTER TABLE runtime_environment.deletion_callbacks ENABLE TRIGGER runtime_project_callback_guard`);
    await x.confirm(); expect((await x.owner.run(x.context('seal'))).kind).toBe('done');
    expect((await x.owner.run(x.context('stop'))).kind).toBe('waiting');
    const original = (await x.repository.retained(x.target))!.physical!; let changed = structuredClone(original);
    const body = changed.nativeHistory!.body as { native: { body: unknown } }; body.native.body = { substituted: true }; changed = { ...changed, nativeHistory: { ...changed.nativeHistory!, digest: jsonHash(body) } };
    const calls = x.controls.calls; await expect(x.physics.stop(x.context('stop'), changed)).rejects.toThrow('持久确认'); expect(x.controls.calls).toBe(calls);
    x.controls.wrongSource = true; await expect(x.physics.stop(x.context('stop'), original)).rejects.toThrow('留存工作出生');
    x.controls.wrongSource = false; x.controls.exit = true; expect((await x.owner.run(x.context('stop'))).kind).toBe('done');
  });
});
