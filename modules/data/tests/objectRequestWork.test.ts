import { describe, expect, test } from 'bun:test';
import type { ProjectDeletionContext, ProjectDeletionTarget, ProjectId } from '@crewstation/contracts';
import { PROJECT_DELETION_PHASES } from '@crewstation/contracts';
import { withExclusiveDatabaseAdmission } from '@crewstation/persistence';
import { generateSecretKey } from '@crewstation/secretbox';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { admittedObjectPlane } from '../application/objects/admittedPlane';
import { objectRequestWork } from '../adapters/persistence/objects/requestWork';
import type { ObjectRequestProcesses } from '../ports/deletion/objectWork';
import type { ObjectBackendPlane } from '../ports/objectStorage';
import { createDataModule, dataMigrations } from '../wiring';
import { objectArchiveFixture } from './objectArchiveFixture';
import { objectUploadRepository } from '../adapters/persistence/objectUploads';
import { transferObject } from '../application/objectTransfer';
import { verifyNextObject } from '../application/objectMaintenance';

const available = await testDatabaseAvailable(), digest = 'a'.repeat(64);
const native = { podUid: Bun.randomUUIDv7(),containerId: 'containerd://' + 'c'.repeat(64),nodeUid: Bun.randomUUIDv7(),nodeName: 'controlled-node',pid: 123,startTicks: '456',pidNamespace: '789',bootId: Bun.randomUUIDv7() };
const noSignal = new AbortController().signal;
const rawError = (work: Promise<unknown>) => work.catch(error => { throw error.cause ?? error; });
async function fixture() {
  const db = await createTestDatabase([dataMigrations]);
  const own = await objectArchiveFixture(db.db), foreign = await objectArchiveFixture(db.db), families = [own,foreign];
  let open = true, calls = 0, protectionFails = false;
  let recover: (accept: Parameters<ObjectRequestProcesses['sweep']>[0]) => Promise<void> = async () => undefined;
  const processes: ObjectRequestProcesses = { protectCurrent: async () => { if (protectionFails) throw new Error('original process unavailable'); return native; },sweep: accept => recover(accept) };
  const input = { db: db.db,processes,assertAvailable: async (id: ProjectId) => { if (!open && id === own.source.projectId) throw new Error('project admission closed'); },
    serviceProject: async (id: string) => families.find(f => f.source.serviceId === id)?.source.projectId };
  const work = objectRequestWork(input);
  const result = { size: own.object.size,sha256: own.object.sha256 };
  let read = Promise.withResolvers<typeof result>();
  const base: ObjectBackendPlane = { configure: async () => undefined,metrics: () => 'original metrics',probe: async (backendId,placementRevision) => ({ backendId,placementRevision,credentialRevision: 1,health: 'ready',message: null,observedAt: new Date().toISOString() }),
    prepareRotation: async () => ({ commit: async () => undefined }),inspectWrite: async () => { calls++; return 'unknown'; },
    put: async (_location,value) => { calls++; await new Response(value.body).arrayBuffer(); return result; },
    verify: async () => { calls++; return result; },remove: async () => { calls++; },
    get: async () => { calls++; const completion = read; return { size: result.size,completed: completion.promise,body: new ReadableStream<Uint8Array>({ start: controller => { controller.enqueue(new Uint8Array(result.size)); controller.close(); },cancel: () => { completion.reject(new Error('original byte stream cancelled')); } }) }; },
  };
  const data = createDataModule({ db: db.db,authorizer: { authorize: async () => undefined },isAdmin: async () => true,
    services: { resolveServiceById: async id => { const f = families.find(f => f.source.serviceId === id); return f ? { projectId: f.source.projectId,slug: 'request-work' } : undefined; } },
    settings: { defaultPlan: 'db-small',secretKeyBase64: generateSecretKey(),postgres: { adminUrl: db.url,visibleHost: 'unused',visiblePort: 5432 } },
    objects: { plane: base,exporterToken: '',work: { processes,assertAvailable: input.assertAvailable },sources: { resolve: async () => ({ ...own.source,planId: own.space.planId }) } },
    deletion: { sources: { resolve: async (kind,key) => {
      const f = families.find(f => kind === 'project' ? f.source.projectId === key : kind === 'service' ? f.source.serviceId === key : f.taskId === key);
      return f ? { complete: true,id: key,projectId: f.source.projectId } : undefined;
    },assertGrant: async () => undefined },physics: { inspect: async () => ({ complete: true,identity: digest,references: [],blockers: [] }),run: async (_ctx,scope,sourceIdentity) => ({ kind: 'done',evidence: { kind: 'physical',digest,count: scope.locations.length,description: 'controlled source protocol, no production erasure claim' },sourceIdentity,scopeDigest: scope.digest,producersClosed: true,consumersStopped: true,independent: true,remaining: 0 }) } } });
  const target: ProjectDeletionTarget = { id: own.source.projectId,serviceId: own.source.serviceId,slug: 'object-work',name: 'Original requests',namespace: 'cs-object-work',kind: 'DigitalWorker',state: 'active',revision: '1',prodHost: 'work.local',previewHost: 'preview.work.local',serviceHost: 'work.svc.local' };
  return { db,own,foreign,work,data,base,plane: admittedObjectPlane(base,work),target,result,calls: () => calls,
    close: () => { open = false; },failProtection: () => { protectionFails = true; },finish: () => read.resolve(result),rejectRead: () => read.reject(new Error('upstream GET failed')),newRead: () => { read = Promise.withResolvers<typeof result>(); },
    recoverWith: (run: typeof recover) => { recover = run; } };
}
async function context(f: Awaited<ReturnType<typeof fixture>>): Promise<ProjectDeletionContext> {
  return { operationId: Bun.randomUUIDv7(),generation: 1,target: f.target,phase: 'seal',confirmed: await f.data.api.deletionOwner!.inspect(f.target) };
}
async function waitFinished(f: Awaited<ReturnType<typeof fixture>>) {
  const deadline = Date.now() + 2000;
  while ((await f.work.history.read(f.target.id)).records.some(r => r.state === 'running')) {
    if (Date.now() > deadline) throw new Error('original callback did not durably finish');
    await Bun.sleep(10);
  }
}

describe.skipIf(!available)('actual Data original byte callbacks (controlled byte plane, real PG)', () => {
  for (const phase of ['put','verify'] as const) test(`${phase} includes the real upload metadata finalization and nested bytes use one original birth`, async () => {
    const f = await fixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    let pending: Promise<unknown> | undefined;
    try {
      const uploads = objectUploadRepository(f.db.db);
      const upload = await uploads.reserve(f.own.space.id,Bun.randomUUIDv7(),{ requestKey: Bun.randomUUIDv7(),name: 'original',mediaType: 'application/octet-stream',size: f.result.size,sha256: f.result.sha256 },f.own.authority);
      const claim = await uploads.begin(upload.id,Bun.randomUUIDv7(),Bun.randomUUIDv7(),f.own.authority);
      const bytes = new ReadableStream<Uint8Array>({ start: c => { c.enqueue(new Uint8Array(f.result.size)); c.close(); } });
      if (phase === 'put') pending = transferObject({ uploads: { ...uploads,finish: async (...args) => { entered.resolve(); await release.promise; return uploads.finish(...args); } },plane: f.plane,requests: f.work },claim,bytes,noSignal);
      else {
        await uploads.finish(claim.attempt,{ receivedBytes: f.result.size,sha256: f.result.sha256 }); await uploads.requestCommit(upload.id,f.own.authority);
        pending = verifyNextObject({ uploads: { ...uploads,verified: async (...args) => { entered.resolve(); await release.promise; return uploads.verified(...args); } },plane: f.plane,requests: f.work,owner: Bun.randomUUIDv7() },noSignal);
      }
      void pending.catch(() => undefined); await entered.promise;
      const records = (await f.work.history.read(f.target.id)).records;
      expect(records).toHaveLength(1); expect(records[0]).toMatchObject({ kind: phase,state: 'running',origin: { key: claim.attempt.key } });
      const ctx = await context(f); expect(ctx.confirmed.complete).toBe(true); f.close();
      expect((await f.data.api.deletionOwner!.run(ctx)).kind).toBe('waiting');
      expect(await f.db.db.execute(sql`SELECT project_id FROM data.project_deletions`)).toHaveLength(0);
      release.resolve(); await pending;
      expect((await uploads.get(upload.id))?.state).toBe(phase === 'put' ? 'verifying' : 'ready');
      expect((await f.work.history.read(f.target.id)).records).toHaveLength(1);
      expect((await f.work.history.read(f.target.id)).records[0]?.state).toBe('finished');
      expect((await f.own.catalog.backend(f.own.backend.id))?.activeTransfers).toBe(0);
    } finally { release.resolve(); await pending?.catch(() => undefined); await f.db.drop(); }
  });

  test('actual factory keeps the original download pending while its real metadata finalization waits on a database lock', async () => {
    const f = await fixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), metadataBusy = Promise.withResolvers<void>();
    const transaction = f.db.db.transaction.bind(f.db.db);
    f.db.db.transaction = (effect,config) => transaction(async tx => {
      const execute = tx.execute.bind(tx);
      tx.execute = ((query: Parameters<typeof tx.execute>[0]) => execute(query).then(rows => {
        if ((rows[0] as { acquired?: unknown } | undefined)?.acquired === false) metadataBusy.resolve();
        return rows;
      })) as typeof tx.execute;
      return effect(tx);
    },config);
    let locked: Promise<unknown> | undefined, consuming: Promise<ArrayBuffer> | undefined, sealing: Promise<unknown> | undefined;
    try {
      const download = await f.data.api.objectService!.download({ identity: 'original-service' },f.own.object.id,{ signal: noSignal });
      const ctx = await context(f);
      locked = f.db.db.transaction(async tx => { await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('data.object-storage',0))`); entered.resolve(); await release.promise; });
      await entered.promise; f.finish();
      consuming = new Response(download.body).arrayBuffer(); void consuming.catch(() => undefined);
      await metadataBusy.promise;
      expect(await Promise.race([consuming.then(() => 'finished'),Bun.sleep(100).then(() => 'metadata pending')])).toBe('metadata pending');
      expect((await f.data.api.objectRequestHistory!.read(f.target.id)).records[0]?.state).toBe('running');
      f.close(); sealing = f.data.api.deletionOwner!.run(ctx); void sealing.catch(() => undefined);
      expect(await Promise.race([sealing.then(r => (r as { kind: string }).kind),Bun.sleep(100).then(() => 'waiting on metadata lock')])).toBe('waiting');
      expect(await f.db.db.execute(sql`SELECT project_id FROM data.project_deletions`)).toHaveLength(0);
      release.resolve(); await locked; expect((await consuming).byteLength).toBe(f.result.size);
      await waitFinished(f); expect((await f.own.catalog.space(f.own.space.id))?.activeTransfers).toBe(0);
    } finally { release.resolve(); f.finish(); await locked; await consuming?.catch(() => undefined); await sealing?.catch(() => undefined); await f.db.drop(); }
  },10_000);

  test('downstream body must finish or cancel even after upstream completes; deletion keeps the original callback admitted', async () => {
    const f = await fixture();
    try {
      const stream = await f.plane.get(f.own.object,{ signal: noSignal });
      f.finish();
      const exited = stream.completed.then(() => true);
      expect(await Promise.race([exited,Bun.sleep(100).then(() => false)])).toBe(false);
      expect((await f.work.history.read(f.target.id)).records[0]?.state).toBe('running');
      const ctx = await context(f); f.close(); expect((await f.data.api.deletionOwner!.run(ctx)).kind).toBe('waiting');
      expect((await new Response(stream.body).arrayBuffer()).byteLength).toBe(f.result.size);
      expect(await stream.completed).toEqual(f.result);
      expect((await f.work.history.read(f.target.id)).records[0]?.state).toBe('finished');
    } finally { f.finish(); await f.db.drop(); }
  });

  test('actual factory returns a download before completion and keeps original work pending until upstream finishes', async () => {
    const f = await fixture();
    try {
      const download = await f.data.api.objectService!.download({ identity: 'original-service' },f.own.object.id,{ signal: noSignal });
      const history = await f.data.api.objectRequestHistory!.read(f.target.id);
      expect(history.records).toHaveLength(1); expect(history.records[0]).toMatchObject({ kind: 'get',state: 'running',origin: { key: f.own.object.key,process: native },exitDigest: null });
      expect(JSON.stringify(history)).not.toContain('exit_key');
      const ctx = await context(f); expect(ctx.confirmed.complete).toBe(true); f.close();
      expect((await f.data.api.deletionOwner!.run(ctx)).kind).toBe('waiting');
      expect(await f.db.db.execute(sql`SELECT project_id FROM data.project_deletions`)).toHaveLength(0);
      expect((await f.own.catalog.space(f.own.space.id))?.activeTransfers).toBe(1);
      f.finish(); expect((await new Response(download.body).arrayBuffer()).byteLength).toBe(f.result.size);
      expect((await f.own.catalog.space(f.own.space.id))?.activeTransfers).toBe(0);
      expect((await f.data.api.objectRequestHistory!.read(f.target.id)).records[0]).toMatchObject({ state: 'finished',exitDigest: expect.stringMatching(/^[a-f0-9]{64}$/) });
      const renewed = { ...ctx,generation: 2,confirmed: await f.data.api.deletionOwner!.inspect(f.target) };
      expect((await f.data.api.deletionOwner!.run(renewed)).kind).toBe('done');
      await expect(f.plane.verify(f.own.object,noSignal)).rejects.toThrow('sealed');
      expect(f.calls()).toBe(1);
    } finally { f.finish(); await f.db.drop(); }
  });

  test('cancellation and upstream failure end only their own original callback; all byte methods are admitted', async () => {
    const f = await fixture();
    try {
      const download = await f.plane.get(f.own.object,{ signal: noSignal,range: 'bytes=0-9' });
      await download.body.cancel(); await expect(download.completed).rejects.toThrow('cancelled');
      const body = new ReadableStream<Uint8Array>({ start: c => { c.enqueue(new Uint8Array(f.result.size)); c.close(); } });
      expect(await f.plane.put(f.own.object,{ body,size: f.result.size,sha256: digest,signal: noSignal })).toEqual(f.result);
      expect(await f.plane.verify(f.own.object,noSignal)).toEqual(f.result);
      expect(await f.plane.inspectWrite!(f.own.object,noSignal)).toBe('unknown'); await f.plane.remove(f.own.object,noSignal);
      expect(f.plane.metrics()).toBe('original metrics'); await f.plane.configure('',1,1,{ endpoint: 'http://unused',region: 'test',bucket: 'shared',accessKeyId: 'unused',secretAccessKey: 'unused' });
      expect(await f.plane.probe(f.own.backend.id,1,noSignal)).toMatchObject({ backendId: f.own.backend.id,health: 'ready' });
      await (await f.plane.prepareRotation!({ backendId: f.own.backend.id,placementRevision: 1,credentialRevision: 2,accessKeyId: 'next',secretAccessKey: 'next' },noSignal)).commit({});
      expect((await f.work.history.read(f.target.id)).records.map(r => [r.kind,r.state])).toEqual([['get','finished'],['put','finished'],['verify','finished'],['inspect','finished'],['remove','finished']]);
      const failed = admittedObjectPlane({ ...f.base,verify: async () => { throw new Error('upstream unavailable'); } },f.work);
      await expect(failed.verify(f.own.object,noSignal)).rejects.toThrow('upstream unavailable');
      const failedOpen = admittedObjectPlane({ ...f.base,get: async () => { throw new Error('GET open failed'); } },f.work);
      await expect(failedOpen.get(f.own.object,{ signal: noSignal })).rejects.toThrow('GET open failed');
      f.newRead(); const upstreamFailed = await f.plane.get(f.own.object,{ signal: noSignal });
      f.rejectRead(); await expect(upstreamFailed.completed).rejects.toThrow('upstream GET failed');
      expect((await f.work.history.read(f.target.id)).records.every(r => r.state === 'finished')).toBe(true);
    } finally { f.finish(); await f.db.drop(); }
  });

  test('an original body read failure cannot become a successful completed receipt', async () => {
    const f = await fixture();
    try {
      const bytes = admittedObjectPlane({ ...f.base,get: async () => ({ size: f.result.size,completed: Promise.resolve(f.result),body: new ReadableStream<Uint8Array>({ pull: c => { c.error(new Error('original body failed')); } }) }) },f.work);
      const stream = await bytes.get(f.own.object,{ signal: noSignal });
      await expect(new Response(stream.body).arrayBuffer()).rejects.toThrow('original body failed');
      await expect(stream.completed).rejects.toThrow('original body failed');
      expect((await f.work.history.read(f.target.id)).records[0]?.state).toBe('finished');
    } finally { f.finish(); await f.db.drop(); }
  });

  test('missing original key, wrong placement, service ownership, size or process rejects before byte effects', async () => {
    const f = await fixture();
    try {
      for (const location of [{ ...f.own.object,key: f.foreign.object.key },{ ...f.own.object,placementRevision: 999 }]) await expect(f.plane.remove(location,noSignal)).rejects.toThrow('original attempt');
      const wrong = objectRequestWork({ db: f.db.db,processes: { protectCurrent: async () => native,sweep: async () => undefined },assertAvailable: async () => undefined,serviceProject: async () => f.foreign.source.projectId });
      await expect(wrong.run(f.own.object,'remove',async () => { throw new Error('must not execute'); })).rejects.toThrow('another project');
      await expect(f.plane.put(f.own.object,{ body: new ReadableStream(),size: 101,sha256: digest,signal: noSignal })).rejects.toThrow('size differs');
      f.failProtection(); await expect(f.plane.remove(f.own.object,noSignal)).rejects.toThrow('process unavailable');
      expect(f.calls()).toBe(0); expect((await f.work.history.read(f.target.id)).records).toHaveLength(1);
      await expect(rawError(f.db.db.execute(sql`INSERT INTO data.object_work(id,project_id,kind,backend_pid,body,exit_key_hash) SELECT ${Bun.randomUUIDv7()},project_id,kind,backend_pid,body,exit_key_hash FROM data.object_work`))).rejects.toMatchObject({ code: '55000',message: 'object request requires its original admitted birth' });
      f.close(); await expect(f.plane.remove(f.own.object,noSignal)).rejects.toThrow('admission closed');
      await f.db.db.execute(sql`UPDATE data.object_upload_attempts SET body=jsonb_set(body,'{key}','"foreign/private/key"') WHERE id=${f.own.object.attemptId}`);
      await expect(f.plane.remove({ ...f.own.object,key: 'foreign/private/key' },noSignal)).rejects.toThrow('outside the original attempt');
      expect(f.calls()).toBe(0);
    } finally { f.finish(); await f.db.drop(); }
  });

  test('real admission socket loss releases its SQL lock but cannot end the durable original byte callback', async () => {
    const f = await fixture(), started = Promise.withResolvers<void>(), finish = Promise.withResolvers<void>();
    const running = f.work.run(f.own.object,'put',async () => { started.resolve(); await finish.promise; });
    const rejected = running.then(() => false,() => true);
    try {
      await started.promise;
      const ctx = await context(f), row = (await f.db.db.execute<{ backend_pid: number }>(sql`SELECT backend_pid FROM data.object_work WHERE state='running'`))[0]!;
      expect((await f.db.db.execute<{ stopped: boolean }>(sql`SELECT pg_terminate_backend(${row.backend_pid}) AS stopped`))[0]?.stopped).toBe(true);
      expect(await rejected).toBe(true);
      expect(await withExclusiveDatabaseAdmission(f.db.db,'data.project-admission:' + f.target.id,async () => 'lock released')).toBe('lock released');
      f.close(); expect((await f.data.api.deletionOwner!.run(ctx)).kind).toBe('waiting');
      expect((await f.work.history.read(f.target.id)).records[0]?.state).toBe('running');
      expect(await f.db.db.execute(sql`SELECT project_id FROM data.project_deletions`)).toHaveLength(0);
      finish.resolve(); await waitFinished(f);
      expect((await f.work.history.read(f.target.id)).records[0]?.state).toBe('finished');
    } finally { finish.resolve(); await rejected; await waitFinished(f); await f.db.drop(); }
  },10_000);

  test('forged exit, owner replacement, ordinary deletion and truncate cannot erase original work; recovery matches the full original Pod', async () => {
    const f = await fixture();
    try {
      const stream = await f.plane.get(f.own.object,{ signal: noSignal });
      const record = (await f.work.history.read(f.target.id)).records[0]!;
      await expect(rawError(f.db.db.execute(sql`UPDATE data.object_work SET state='finished',exit_digest=encode(sha256(convert_to(body::text,'UTF8')),'hex') WHERE id=${record.id}`))).rejects.toMatchObject({ code: '55000',message: 'object request exit requires original private key' });
      await expect(rawError(f.db.db.execute(sql`UPDATE data.object_work SET project_id=${f.foreign.source.projectId} WHERE id=${record.id}`))).rejects.toMatchObject({ code: '55000',message: 'object request original birth and exit are immutable' });
      await expect(rawError(f.db.db.execute(sql`DELETE FROM data.object_work WHERE id=${record.id}`))).rejects.toMatchObject({ code: '55000' });
      await expect(rawError(f.db.db.execute(sql`TRUNCATE data.object_work`))).rejects.toThrow('cannot be truncated');
      f.recoverWith(accept => accept.stopped(native,digest)); await expect(f.work.sweep()).rejects.toThrow('individual container');
      f.recoverWith(async accept => { await accept.podStopped({ ...native,nodeUid: Bun.randomUUIDv7() },digest); expect(await accept.releasable(native.podUid)).toBe(false); });
      await f.work.sweep(); expect((await f.work.history.read(f.target.id)).records[0]?.state).toBe('running');
      f.recoverWith(async accept => { await accept.podStopped(native,digest); expect(await accept.releasable(native.podUid)).toBe(true); });
      await f.work.sweep(); expect((await f.work.history.read(f.target.id)).records[0]).toMatchObject({ state: 'finished',recoveryDigest: digest });
      f.finish(); await new Response(stream.body).arrayBuffer(); await stream.completed;
      await expect(rawError(f.db.db.execute(sql`UPDATE data.object_work SET state='running',exit_digest=NULL WHERE id=${record.id}`))).rejects.toThrow('immutable');
    } finally { f.finish(); await f.db.drop(); }
  });

  test('complete original request pagination participates in scoped deletion; foreign project work, keys and shared backends survive', async () => {
    const f = await fixture();
    try {
      for (let i = 0; i < 201; i++) await f.plane.verify(f.own.object,noSignal);
      await f.plane.verify(f.foreign.object,noSignal);
      const history = await f.work.history.read(f.target.id);
      expect(history.records).toHaveLength(201); expect(new Set(history.records.map(r => r.id)).size).toBe(201);
      expect(history.records.every(r => r.origin.key === f.own.object.key && r.origin.projectId === f.target.id)).toBe(true);
      const foreignBefore = await f.db.db.execute(sql`SELECT to_jsonb(r) AS body FROM data.object_work r WHERE project_id=${f.foreign.source.projectId}`);
      const foreignObject = await f.db.db.execute(sql`SELECT to_jsonb(r) AS body FROM data.objects r WHERE id=${f.foreign.object.id}`);
      const ctx = await context(f); expect(ctx.confirmed.complete).toBe(true);
      expect(ctx.confirmed.resources.find(r => r.id === 'object_work')?.count).toBe(201);
      f.close(); for (const phase of PROJECT_DELETION_PHASES) expect((await f.data.api.deletionOwner!.run({ ...ctx,phase })).kind).toBe('done');
      expect((await f.work.history.read(f.target.id)).records).toHaveLength(0);
      expect(await f.db.db.execute(sql`SELECT to_jsonb(r) AS body FROM data.object_work r WHERE project_id=${f.foreign.source.projectId}`)).toEqual(foreignBefore);
      expect(await f.db.db.execute(sql`SELECT to_jsonb(r) AS body FROM data.objects r WHERE id=${f.foreign.object.id}`)).toEqual(foreignObject);
      expect(await f.db.db.execute(sql`SELECT id FROM data.object_backends`)).toHaveLength(2);
      const scope = (await f.db.db.execute<{ body: { locations: unknown[] } }>(sql`SELECT body FROM data.project_deletions WHERE project_id=${f.target.id}`))[0]!.body;
      expect(scope.locations).toEqual([{ backendId: f.own.backend.id,placementRevision: 1,key: f.own.object.key,size: f.result.size }]);
      expect(await f.db.db.execute(sql`SELECT key FROM data.content_origins WHERE kind='object-work' AND project_id=${f.target.id}`)).toHaveLength(201);
    } finally { f.finish(); await f.db.drop(); }
  },30_000);
});
