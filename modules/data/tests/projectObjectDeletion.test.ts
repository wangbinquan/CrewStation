import { describe, expect, test } from 'bun:test';
import { PROJECT_DELETION_PHASES, ProjectIdSchema, ServiceIdSchema, TaskIdSchema } from '@crewstation/contracts';
import type { ProjectDeletionContext, ProjectDeletionTarget } from '@crewstation/contracts';
import { generateSecretKey } from '@crewstation/secretbox';
import { jsonHash } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createDataModule, createDataObjectDeletionPhysics, dataMigrations } from '../wiring';
import type { DataDeletionPhysics } from '../ports/deletion/projectDeletion';
import { backendFixture, spaceFixture, storageNow } from './objectFixtures';
import { garageMetadataFixture, pack } from '../../../packages/filesystem-metrics/garage/fixture';
import { garageRowKey } from '../../../packages/filesystem-metrics/garage/rows';
import { observeGarageInventory } from '../../../packages/filesystem-metrics/garage/inventory';

const available = await testDatabaseAvailable(), project = ProjectIdSchema.parse(Bun.randomUUIDv7()), other = ProjectIdSchema.parse(Bun.randomUUIDv7());
const service = ServiceIdSchema.parse(Bun.randomUUIDv7()), task = TaskIdSchema.parse(Bun.randomUUIDv7());
const target: ProjectDeletionTarget = { id: project,serviceId: service,slug: 'object-delete',name: 'Object deletion',namespace: 'cs-object-delete',kind: 'DigitalWorker',state: 'active',revision: '1',prodHost: 'object.local',previewHost: 'preview.object.local',serviceHost: 'object.svc.local' };
async function fixture(physics?: DataDeletionPhysics, referencesKnown = true) {
  const db = await createTestDatabase([dataMigrations]);
  const data = createDataModule({ db: db.db,authorizer: { authorize: async () => undefined },isAdmin: async () => true,services: { resolveServiceById: async () => ({ projectId: project,slug: target.slug }) },
    settings: { defaultPlan: 'db-small',secretKeyBase64: generateSecretKey(),postgres: { adminUrl: db.url,visibleHost: 'unused',visiblePort: 5432 } },
    deletion: { sources: { resolve: async (kind,key) => ({ complete: true,id: key,projectId: kind === 'project' ? ProjectIdSchema.parse(key) : key === service || key === task ? project : other }),...(referencesKnown ? { reference: async (_kind: string,id: string) => ({ complete: true as const,id,projectId: project }) } : {}),assertGrant: async () => undefined },...(physics ? { physics } : {}) } });
  return { db,owner: data.api.deletionOwner! };
}
async function seedObjects(db: TestDatabase) {
  const backend = backendFixture({ reservedBytes: 25,health: 'ready' }), space = spaceFixture(backend.id,{ projectId: project,serviceId: service,env: 'production',fenced: false },{ usedBytes: 5,objectCount: 1 });
  await db.db.execute(sql`INSERT INTO data.object_backends VALUES(${backend.id},${backend.requestKey},${JSON.stringify(backend)}::jsonb)`);
  await db.db.execute(sql`INSERT INTO data.object_spaces VALUES(${space.id},${project},${service},'production',${backend.id},${JSON.stringify(space)}::jsonb)`);
  const uploadId = Bun.randomUUIDv7(), attemptId = Bun.randomUUIDv7(), key = `spaces/${space.id}/attempts/${attemptId}`;
  const upload = { id: uploadId,spaceId: space.id,size: 5,state: 'ready',objectId: uploadId,currentAttemptId: attemptId,readyAttemptId: attemptId };
  const attempt = { id: attemptId,spaceId: space.id,uploadId,backendId: backend.id,placementRevision: 1,key,size: 5,state: 'verified',writerEndedAt: storageNow };
  const object = { id: uploadId,spaceId: space.id,uploadId,attemptId,backendId: backend.id,placementRevision: 1,key,size: 5,state: 'ready' };
  await db.db.execute(sql`INSERT INTO data.object_uploads VALUES(${uploadId},${space.id},'original-upload','ready',${JSON.stringify(upload)}::jsonb,now())`);
  await db.db.execute(sql`INSERT INTO data.object_upload_attempts VALUES(${attemptId},${uploadId},${space.id},${backend.id},'verified',now(),${JSON.stringify(attempt)}::jsonb)`);
  await db.db.execute(sql`INSERT INTO data.objects VALUES(${uploadId},${space.id},'ready',${JSON.stringify(object)}::jsonb)`);
  await db.db.execute(sql`INSERT INTO data.object_references VALUES(${uploadId},'task',${task},1,'{"state":"active"}')`);
  const bindingId = Bun.randomUUIDv7(), grantId = Bun.randomUUIDv7(), planId = Bun.randomUUIDv7();
  await db.db.execute(sql`INSERT INTO data.archive_plans VALUES(${planId},${task},${space.id},'original-plan','{}')`);
  await db.db.execute(sql`INSERT INTO data.finalization_bindings VALUES(${bindingId},${task},${space.id},'completed','{}')`);
  await db.db.execute(sql`INSERT INTO data.archive_binding_revisions VALUES(${bindingId},1,'original-revision','{}')`);
  await db.db.execute(sql`INSERT INTO data.archive_helper_grants VALUES(${grantId},${bindingId},1,'{"closedAt":"original-time"}')`);
  await db.db.execute(sql`INSERT INTO data.archive_helper_closures VALUES(${grantId})`);
  await db.db.execute(sql`INSERT INTO data.archive_file_results VALUES(${bindingId},1,'output.txt','{}')`);
  const inputs = { taskId: task,projectId: project,serviceId: service,spaceId: space.id };
  await db.db.execute(sql`INSERT INTO data.task_object_inputs VALUES(${task},${JSON.stringify(inputs)}::jsonb)`);
  await db.db.execute(sql`INSERT INTO data.task_input_grants VALUES(${Bun.randomUUIDv7()},${task},${JSON.stringify({ taskId: task })}::jsonb)`);
  await db.db.execute(sql`INSERT INTO data.object_mutations VALUES(${space.id},'original-mutation','{}')`);
  await db.db.execute(sql`INSERT INTO data.object_read_transfers VALUES(${Bun.randomUUIDv7()},${uploadId},${space.id},${backend.id},${JSON.stringify({ backendId: backend.id,endedAt: storageNow })}::jsonb)`);
  await db.db.execute(sql`INSERT INTO data.object_write_control VALUES(${service},'{}')`);
  return { backend,space,uploadId,attemptId,bindingId,grantId,key };
}

describe.skipIf(!available)('data object deletion protocol (controlled native source, no production cleanup claim)', () => {
  test('the actual Data factory closes against native SQLite, preserves a foreign object, and rechecks retained origins after metadata deletion', async () => {
    let physics: DataDeletionPhysics | undefined;
    const { db, owner } = await fixture({ inspect: (...args) => physics!.inspect(...args), run: (...args) => physics!.run(...args) });
    const garage = await garageMetadataFixture();
    try {
      const seed = await seedObjects(db); await mkdir(join(garage.root, 'data'));
      const original = { bucket_id: garage.bucket, key: seed.key, versions: [{ uuid: garage.original, timestamp: 1, state: { Complete: { Inline: [{ size: 5 }, Buffer.from('owned')] } } }] };
      const foreign = { bucket_id: garage.bucket, key: `spaces/${garage.sibling}/attempts/foreign`, versions: [{ uuid: garage.foreign, timestamp: 1, state: { Complete: { Inline: [{ size: 7 }, Buffer.from('foreign')] } } }] };
      garage.insert('object', original); garage.insert('object', foreign);
      const foreignRow = () => garage.db.query<{ v: Uint8Array }, [Uint8Array]>('SELECT v FROM tree_object_COLON_table WHERE k=?').get(garageRowKey('object', foreign))!.v;
      const foreignBefore = Buffer.from(foreignRow());
      const origin = { nodeUid: crypto.randomUUID(), nodeName: 'controlled-native-node', volumeUid: crypto.randomUUID() }, identity = jsonHash(origin);
      const consumer = { identity: '9'.repeat(64), nodeUid: origin.nodeUid, nodeName: origin.nodeName, probeUid: crypto.randomUUID(), containerId: 'containerd://' + '1'.repeat(64), imageId: 'probe@sha256:' + '2'.repeat(64), bootId: crypto.randomUUID(), namespace: 'pid:[1]' };
      let observations = 0, removals = 0;
      const observe = async (query: Parameters<typeof observeGarageInventory>[1]['query']) => {
        observations++;
        return { identity, origin, inventory: await observeGarageInventory(garage.root, { key: 'actual-data-owner', rootId: 'local', metadataDirectory: garage.directory, dataDirectory: 'data', query }, AbortSignal.timeout(5000)) };
      };
      physics = createDataObjectDeletionPhysics(db.db, { s3Endpoint: 'http://garage:3900', source: { capture: observe, verify: async (query, retained) => {
        expect(retained.identity).toBe(identity); return observe(query);
      } }, consumers: { capture: async () => ({ source: consumer, complete: true, count: 0, digest: jsonHash('controlled whole-node observer') }), observe: async () => ({ source: consumer, complete: true, count: 0, digest: jsonHash('controlled whole-node observer') }) },
        garage: { cluster: async () => ({ node: '3'.repeat(64), revision: '4'.repeat(64) }), bucket: async () => ({ id: garage.bucket.toString('hex'), created: storageNow }), purgeExclusive: async () => { throw Error('inline object has no native blocks'); } },
        objects: { location: async () => ({ endpoint: 'http://garage:3900', region: 'garage', bucket: 'original' }), remove: async (location, _signal, authorize) => {
          await authorize(); expect(location.key).toBe(seed.key); removals++;
          garage.db.query('UPDATE tree_object_COLON_table SET v=? WHERE k=?').run(Buffer.concat([Buffer.from('G2s3ob'), pack({ ...original, versions: [{ uuid: Buffer.alloc(32, 8), timestamp: 2, state: { Complete: 'DeleteMarker' } }] })]), garageRowKey('object', original));
          await authorize();
        }, abort: async () => { throw Error('no native multipart uploads'); } },
      }, async context => { expect(context.target.id).toBe(project); });
      const report = await owner.inspect(target); expect(report.complete).toBe(true);
      expect(report.resources.find(row => row.kind === 'data-object-source')?.count).toBe(1);
      const ctx: ProjectDeletionContext = { operationId: Bun.randomUUIDv7(), generation: 1, phase: 'seal', target, confirmed: report };
      for (const phase of PROJECT_DELETION_PHASES) expect((await owner.run({ ...ctx, phase })).kind).toBe('done');
      expect(removals).toBe(1); expect(Buffer.from(foreignRow())).toEqual(foreignBefore);
      expect(await db.db.execute(sql`SELECT id FROM data.objects`)).toHaveLength(0);
      const retained = (await db.db.execute<{ body: { nativeHistory: { body: { groups: Array<{ query: { spaceIds: string[] } }> } } } }>(sql`SELECT body FROM data.project_deletions WHERE project_id=${project}`))[0]!.body.nativeHistory;
      expect(retained.body.groups[0]?.query.spaceIds).toEqual([seed.space.id]);
      const before = observations; expect((await owner.run({ ...ctx, phase: 'verify' })).kind).toBe('done'); expect(observations).toBeGreaterThan(before);
      expect((await owner.inspect(target)).resources.every(row => row.count === 0)).toBe(true);
      expect(Buffer.from(foreignRow())).toEqual(foreignBefore);
    } finally { await garage.dispose(); await db.drop(); }
  },15_000);
  test('missing independent source blocks nonempty object history, retaining all original bytes metadata', async () => {
    const { db,owner } = await fixture();
    try {
      await seedObjects(db);
      const report = await owner.inspect(target);
      expect(report.complete).toBe(false); expect(report.blockers[0]?.code).toBe('object-source-unavailable');
      expect(report.resources.find(r => r.id === 'object_upload_attempts')?.count).toBe(1);
      expect(await db.db.execute(sql`SELECT id FROM data.objects`)).toHaveLength(1);
    } finally { await db.drop(); }
  });

  test('a native key outside the original space and attempt cannot be passed to the physical source', async () => {
    let probes = 0;
    const { db,owner } = await fixture({ inspect: async () => { probes++; return { complete: true,identity: 'a'.repeat(64),references: [],blockers: [] }; },run: async () => { throw new Error('must not delete'); } });
    try {
      const seed = await seedObjects(db);
      expect((await owner.inspect(target)).complete).toBe(true);
      const before = probes;
      await db.db.execute(sql`UPDATE data.object_upload_attempts SET body=jsonb_set(body,'{key}','"foreign/project/file"') WHERE id=${seed.attemptId}`);
      await db.db.execute(sql`UPDATE data.objects SET body=jsonb_set(body,'{key}','"foreign/project/file"') WHERE id=${seed.uploadId}`);
      expect((await owner.inspect(target)).complete).toBe(false); expect(probes).toBe(before);
      expect(await db.db.execute(sql`SELECT id FROM data.objects`)).toHaveLength(1);
    } finally { await db.drop(); }
  });

  test('archive references use their actual local binding and space; another or missing parent remains blocked', async () => {
    const { db,owner } = await fixture(undefined,false);
    try {
      const seed = await seedObjects(db);
      await db.db.execute(sql`UPDATE data.object_references SET owner_type='archive-receipt',owner_id=${seed.bindingId}`);
      expect((await owner.inspect(target)).blockers[0]?.code).toBe('object-source-unavailable');
      await db.db.execute(sql`UPDATE data.object_references SET owner_id=${Bun.randomUUIDv7()}`);
      expect((await owner.inspect(target)).blockers[0]?.code).toBe('source-incomplete');
      await db.db.execute(sql`UPDATE data.object_references SET owner_id=${seed.bindingId},body='{"state":"unknown"}'`);
      expect((await owner.inspect(target)).blockers[0]?.code).toBe('source-incomplete');
      expect(await db.db.execute(sql`SELECT id FROM data.objects`)).toHaveLength(1);
    } finally { await db.drop(); }
  });

  test('all object, input and archive records close against captured source; false closure and counters reject, replay retains proofs', async () => {
    const sourceIdentity = 'b'.repeat(64), calls: string[] = [];
    let closed = false, valid = false;
    const originalNative = { bucket: 'd'.repeat(64), versions: ['e'.repeat(64)], blocks: ['f'.repeat(64)], copies: [{ inode: '123', birth: '456' }] };
    const nativeHistory = { version: 1 as const, identity: sourceIdentity, digest: jsonHash(originalNative), body: originalNative };
    let inspectionsAfterMetadata = 0;
    const physics: DataDeletionPhysics = { inspect: async (_target, scope) => {
      if (!scope.contents.length) { expect(scope.nativeHistory).toEqual(nativeHistory); inspectionsAfterMetadata++; }
      return { complete: true,identity: sourceIdentity,references: [],blockers: [], nativeHistory };
    },run: async (context,scope) => {
      expect(scope.nativeHistory).toEqual(nativeHistory);
      calls.push(context.phase);
      if (!closed) return { kind: 'waiting',reason: 'original producer still active' };
      return { kind: 'done',evidence: { kind: 'physical',digest: 'c'.repeat(64),count: scope.locations.length,description: 'controlled original native proof' },sourceIdentity,scopeDigest: scope.digest,producersClosed: true,consumersStopped: valid,independent: true,remaining: context.phase === 'stop' ? 1 : 0 };
    } };
    const { db,owner } = await fixture(physics);
    try {
      const seed = await seedObjects(db), report = await owner.inspect(target);
      expect(report.complete).toBe(true); expect(report.resources.filter(r => r.count > 0)).toHaveLength(17);
      const ctx: ProjectDeletionContext = { operationId: Bun.randomUUIDv7(),generation: 1,target,phase: 'seal',confirmed: report };
      expect((await owner.run(ctx)).kind).toBe('done');
      const retained = (await db.db.execute<{ body: { nativeHistory: unknown } }>(sql`SELECT body FROM data.project_deletions`))[0]!.body.nativeHistory;
      expect(retained).toEqual(nativeHistory);
      expect((await owner.run({ ...ctx,phase: 'stop' })).kind).toBe('waiting');
      closed = true; await expect(owner.run({ ...ctx,phase: 'stop' })).rejects.toThrow('physical evidence');
      expect(await db.db.execute(sql`SELECT id FROM data.objects`)).toHaveLength(1);
      valid = true;
      for (const phase of PROJECT_DELETION_PHASES.slice(1,5)) expect((await owner.run({ ...ctx,phase })).kind).toBe('done');
      await db.db.execute(sql`UPDATE data.object_backends SET body=jsonb_set(body,'{reservedBytes}','4') WHERE id=${seed.backend.id}`);
      await expect(owner.run({ ...ctx,phase: 'metadata' })).rejects.toThrow('reservation cannot be settled');
      expect(await db.db.execute(sql`SELECT id FROM data.objects`)).toHaveLength(1);
      await db.db.execute(sql`UPDATE data.object_backends SET body=jsonb_set(body,'{reservedBytes}','25') WHERE id=${seed.backend.id}`);
      for (const phase of PROJECT_DELETION_PHASES.slice(5)) expect((await owner.run({ ...ctx,generation: 2,phase })).kind).toBe('done');
      expect((await owner.inspect(target)).resources.every(r => r.count === 0)).toBe(true);
      expect(inspectionsAfterMetadata).toBeGreaterThan(0);
      expect((await db.db.execute<{ body: { nativeHistory: unknown } }>(sql`SELECT body FROM data.project_deletions`))[0]!.body.nativeHistory).toEqual(retained);
      const backend = (await db.db.execute<{ body: typeof seed.backend }>(sql`SELECT body FROM data.object_backends WHERE id=${seed.backend.id}`))[0]!.body;
      expect(backend).toEqual({ ...seed.backend,reservedBytes: 20 });
      const proofs = await db.db.execute(sql`SELECT phases FROM data.project_deletions`);
      const before = calls.length;
      expect((await owner.run({ ...ctx,generation: 2,phase: 'verify' })).kind).toBe('done');
      expect(calls.length).toBe(before + 1); expect(calls.at(-1)).toBe('verify'); expect(await db.db.execute(sql`SELECT phases FROM data.project_deletions`)).toEqual(proofs);
      closed = false;
      expect((await owner.run({ ...ctx, generation: 2, phase: 'verify' })).kind).toBe('waiting');
      expect(await db.db.execute(sql`SELECT phases FROM data.project_deletions`)).toEqual(proofs);
      closed = true;
      await expect(db.db.execute(sql`INSERT INTO data.object_uploads VALUES(${Bun.randomUUIDv7()},${seed.space.id},'late','waiting','{}',now())`).then(() => undefined)).rejects.toMatchObject({ cause: { code: '55000' } });
      await expect(db.db.execute(sql`INSERT INTO data.archive_helper_closures VALUES(${seed.grantId})`).then(() => undefined)).rejects.toMatchObject({ cause: { code: '55000' } });
    } finally { await db.drop(); }
  },15_000);
});
