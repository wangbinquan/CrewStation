import { describe, expect, test } from 'bun:test';
import { jsonHash, newResourceId, quotaExceeded } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { withSharedDatabaseAdmission } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { businessContentSnapshot } from '../../adapters/persistence/deletion/inspection';
import { dispatchTaskAdmission } from '../../application/taskAdmissionDispatch';
import { businessWorkIdentity } from '../../domain/deletion/work';
import { businessWorkFixture } from './workFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('business original task dispatch (actual PG; controlled Project and whole-Pod ports)', () => {
  test('seal waits for the actual callback and private finally; the whole journal is immutable and another project continues', async () => {
    const f = await businessWorkFixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    let inFlight: Promise<unknown> | undefined, sealing: Promise<unknown> | undefined;
    try {
      const original = f.input();
      inFlight = f.work.run(original, async () => {
        entered.resolve(); await release.promise;
        await f.work.checkCurrent(f.projectId, f.serviceId);
        await f.work.run(original, async () => undefined);
        await expect(f.work.run({ ...original, reference: newResourceId() }, async () => undefined)).rejects.toThrow('另一任务');
        await expect(f.work.run(f.input(f.otherProject, f.otherService), async () => undefined)).rejects.toThrow();
      });
      await entered.promise;
      const [birth] = await f.work.history(f.projectId); expect(birth!.exited).toBe(false); expect(birth!.process).toEqual(f.native);
      for (const mutation of [sql`UPDATE business_task.original_callbacks SET input_digest=${jsonHash('replacement')} WHERE id=${birth!.id}`,
        sql`UPDATE business_task.original_callbacks SET exited_at=now(),exit_digest=${businessWorkIdentity(birth!)} WHERE id=${birth!.id}`,
        sql`DELETE FROM business_task.original_callbacks WHERE id=${birth!.id}`, sql`TRUNCATE business_task.original_callbacks`]) await expect(f.database.db.execute(mutation).then(() => undefined)).rejects.toThrow();
      let sealed = false; sealing = f.work.seal(f.context()).then((value) => { sealed = true; return value; });
      await f.work.run(f.input(f.otherProject, f.otherService), async () => undefined);
      expect(sealed).toBe(false); expect(await f.work.history(f.otherProject)).toHaveLength(1);
      release.resolve(); await inFlight; expect(await sealing).toEqual({ pending: [] });
      const [exited] = await f.work.history(f.projectId); expect(exited!.exitDigest).toBe(businessWorkIdentity(birth!));
      expect(exited!.exited).toBe(true); expect(exited!.recoveryDigest).toBeNull();
      await expect(f.work.run(f.input(), async () => undefined)).rejects.toThrow('永久封闭');
      await expect(f.work.checkCurrent(f.projectId, f.serviceId)).rejects.toThrow('已退出');
      expect((await businessContentSnapshot(f.database.db, f.sources, f.projectId)).inventory.resources.find((row) => row.id === 'original_callbacks')?.count).toBe(1);
      await f.database.db.execute('ALTER TABLE business_task.callback_pod_stops ADD COLUMN unregistered_secret text');
      await expect(businessContentSnapshot(f.database.db, f.sources, f.projectId)).rejects.toThrow('未登记变化');
    } finally { release.resolve(); await inFlight?.catch(() => undefined); await sealing?.catch(() => undefined); await f.drop(); }
  });

  test('a terminated admission backend does not erase the pending callback; late effects are fenced until its real finally', async () => {
    const f = await businessWorkFixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    let inFlight: Promise<unknown> | undefined;
    try {
      let effects = 0;
      inFlight = f.work.run(f.input(), async () => { entered.resolve(); await release.promise; await f.work.checkCurrent(f.projectId, f.serviceId); effects++; }).catch(() => 'disconnected');
      await entered.promise; const [birth] = await f.work.history(f.projectId);
      await f.database.db.execute(sql`SELECT pg_terminate_backend(${birth!.backendPid})`);
      expect(await inFlight).toBe('disconnected');
      expect(await f.work.seal(f.context())).toEqual({ pending: [birth!.id] });
      expect((await f.work.history(f.projectId))[0]!.exited).toBe(false);
      await f.work.observe(); expect(f.releasable.at(-1)).toBe(false);
      release.resolve(); await f.waitExit(birth!.id);
      expect(effects).toBe(0); expect((await f.work.history(f.projectId))[0]!.exited).toBe(true);
      await f.work.observe(); expect(f.releasable.at(-1)).toBe(true);
    } finally { release.resolve(); await inFlight; await f.drop(); }
  });

  test('the actual task dispatch waits through runtime admission and stops claiming or accepting new writes after sealing', async () => {
    const f = await businessWorkFixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    let inFlight: Promise<unknown> | undefined, sealing: Promise<unknown> | undefined;
    try {
      const request = f.candidate(); await f.operations.reserve(request);
      const operation = (await f.operations.claim({ id: request.id, owner: 'controlled-worker', leaseSeconds: 30 }))!;
      inFlight = dispatchTaskAdmission({ projectWork: f.work, operations: f.operations, environments: {
        createEnvironment: async () => { entered.resolve(); await release.promise;
          expect(await f.operations.renew({ id: operation.id, owner: operation.lease!.owner, revision: operation.revision }, 30)).toBe(true);
          return { id: operation.intent.task.id, projectId: f.projectId, state: 'creating', connected: false,
            traceId: operation.intent.task.traceId, podName: 'controlled-task', profile: operation.intent.task.taskProfileId }; }, getEnvironment: async () => undefined,
      } }, operation);
      await entered.promise; expect((await f.work.history(f.projectId))[0]).toMatchObject({ reference: operation.id, inputDigest: operation.effectiveDigest, exited: false });
      // The exclusive seal must already be queued: uncontextualized settlement otherwise deadlocks behind its own callback.
      sealing = f.work.seal(f.context()).catch((error: unknown) => error); await f.waitSeal();
      release.resolve(); await inFlight; expect(await sealing).toEqual({ pending: [] });
      expect((await f.operations.get(operation.id))?.state).toBe('succeeded');
      expect((await f.work.history(f.projectId))[0]!.exited).toBe(true);
      await expect(f.operations.reserve(f.candidate())).rejects.toMatchObject({ cause: { message: 'Business project content admission is permanently sealed' } });
      await expect(f.database.db.execute(sql`UPDATE business_task.execution_operations SET state='pending' WHERE id=${operation.id}`).then(() => undefined)).rejects.toMatchObject({ cause: { message: 'Business project content admission is permanently sealed' } });
      expect(await f.operations.claim({ id: request.id, owner: 'late-worker', leaseSeconds: 30 })).toBeUndefined();
      const other = f.candidate(f.otherProject, f.otherService); await f.operations.reserve(other);
      expect((await f.operations.claim({ owner: 'another-project', leaseSeconds: 30 }))?.id).toBe(other.id);
    } finally { release.resolve(); await inFlight?.catch(() => undefined); await sealing?.catch(() => undefined); await f.drop(); }
  }, 40_000);

  test('wrong sources, stale grants and original process replacement fail without task effects', async () => {
    const f = await businessWorkFixture();
    try {
      await expect(f.work.run({ ...f.input(), inputDigest: 'incomplete' }, async () => undefined)).rejects.toThrow();
      await expect(f.work.run(f.input(f.otherProject, f.serviceId), async () => undefined)).rejects.toThrow('归属不符');
      f.protect({ ...f.native, pid: process.pid + 1 }); await expect(f.work.run(f.input(), async () => undefined)).rejects.toThrow('PID'); f.protect(f.native);
      f.deleting(true); await expect(f.work.run(f.input(), async () => undefined)).rejects.toThrow('deleting'); f.deleting(false);
      f.permit(false); await expect(f.work.seal(f.context())).rejects.toThrow('grant-unavailable'); f.permit(true);
      await f.work.run(f.input(), async () => {
        f.bind(f.serviceId, f.projectId); const origin = f.origins.get(f.serviceId)!; f.origins.set(f.serviceId, { ...origin, revision: jsonHash('replacement') });
        await expect(f.work.checkCurrent(f.projectId, f.serviceId)).rejects.toThrow('来源发生替换');
      });
      await f.work.seal(f.context()); await expect(f.work.seal({ ...f.context(), operationId: newResourceId() })).rejects.toThrow();
      await expect(f.work.seal({ ...f.context(), confirmed: { ...f.context().confirmed, revision: jsonHash('wrong') } })).rejects.toThrow('确认修订');
      expect(await f.work.seal({ ...f.context(), generation: 2 })).toEqual({ pending: [] });
      await expect(f.work.seal(f.context())).rejects.toThrow('世代');
    } finally { await f.drop(); }
  });

  test('a runtime request may return after backend loss but cannot commit task inputs or publish a successful task', async () => {
    const f = await businessWorkFixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    let inFlight: Promise<unknown> | undefined;
    try {
      const candidate = f.candidate(), request = { ...candidate, intent: { ...candidate.intent, inputObjects: [{ objectId: newResourceId(), sha256: 'a'.repeat(64), path: 'controlled.bin' }] } };
      await f.operations.reserve(request); const operation = (await f.operations.claim({ id: request.id, owner: 'controlled-worker', leaseSeconds: 30 }))!;
      const calls: string[] = [];
      inFlight = dispatchTaskAdmission({ projectWork: f.work, operations: f.operations, taskInputs: {
        prepare: async () => { calls.push('prepare'); }, commit: async () => { calls.push('commit'); }, abort: async () => { calls.push('abort'); },
      }, environments: {
        createEnvironment: async () => { calls.push('create'); entered.resolve(); await release.promise; return { id: operation.intent.task.id, projectId: f.projectId,
          state: 'creating', connected: false, traceId: operation.intent.task.traceId, podName: 'controlled-task', profile: operation.intent.task.taskProfileId }; },
        getEnvironment: async () => { calls.push('reconcile'); return undefined; },
      } }, operation).catch(() => 'disconnected');
      await entered.promise; const [birth] = await f.work.history(f.projectId);
      await f.database.db.execute(sql`SELECT pg_terminate_backend(${birth!.backendPid})`); expect(await inFlight).toBe('disconnected');
      expect(await f.work.seal(f.context())).toEqual({ pending: [birth!.id] });
      release.resolve(); await f.waitExit(birth!.id);
      expect(calls).toEqual(['prepare', 'create']); expect((await f.operations.get(operation.id))?.state).toBe('running');
    } finally { release.resolve(); await inFlight; await f.drop(); }
  });

  test('recovery requires the whole original Pod and node; all 205 original callback identities are traversed to EOF', async () => {
    const f = await businessWorkFixture();
    try {
      const callbacks = Array.from({ length: 205 }, () => ({ id: newResourceId(), consumer: newResourceId(), reference: newResourceId() }));
      await withSharedDatabaseAdmission(f.database.db, 'business-task.project-admission:' + f.projectId, async (protectedTx) => {
        const pid = (await protectedTx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`))[0]!.pid;
        await f.database.db.transaction(async (tx) => { await tx.execute(sql`INSERT INTO business_task.original_callbacks(id,project_id,service_id,kind,reference,consumer_id,input_digest,origin_revision,backend_pid,original_process,exit_key_hash)
          SELECT x.id,${f.projectId},${f.serviceId},'task-admission',x.reference,x.consumer,${jsonHash('original-input')},${f.origins.get(f.serviceId)!.revision},${pid},${JSON.stringify(f.native)}::jsonb,${jsonHash('private-original-exit')}
          FROM jsonb_to_recordset(${JSON.stringify(callbacks)}::jsonb) x(id text,consumer text,reference text)`); });
      });
      expect(await f.work.history(f.projectId)).toHaveLength(205);
      await f.work.observe(); expect(f.releasable.at(-1)).toBe(false);
      f.containerStopped(true); await f.work.observe(); expect((await f.work.history(f.projectId)).every((row) => !row.exited)).toBe(true);
      f.stopped(true); f.stopIdentity({ podUid: f.native.podUid, nodeUid: newResourceId(), nodeName: f.native.nodeName });
      await f.work.observe(); expect((await f.work.history(f.projectId)).every((row) => !row.exited)).toBe(true);
      f.stopIdentity({ podUid: f.native.podUid, nodeUid: f.native.nodeUid, nodeName: f.native.nodeName });
      await f.work.observe(); const exited = await f.work.history(f.projectId);
      expect(exited.every((row) => row.exited && row.recoveryDigest && row.exitDigest === businessWorkIdentity(row, row.recoveryDigest))).toBe(true);
      expect(f.releasable.at(-1)).toBe(true); await f.work.observe(); expect(await f.work.history(f.projectId)).toEqual(exited);
      await expect(f.database.db.execute('DELETE FROM business_task.callback_pod_stops').then(() => undefined)).rejects.toMatchObject({ cause: { message: 'Business original Pod stop requires independent observer' } });
      await expect(f.database.db.execute('TRUNCATE business_task.callback_pod_stops').then(() => undefined)).rejects.toMatchObject({ cause: { message: 'Original business work cannot be truncated' } });
    } finally { await f.drop(); }
  });

  test('dispatch failures close the original callback without changing admission reconciliation semantics', async () => {
    const f = await businessWorkFixture();
    try {
      const request = f.candidate(); await f.operations.reserve(request);
      const operation = (await f.operations.claim({ id: request.id, owner: 'controlled-worker', leaseSeconds: 30 }))!;
      await dispatchTaskAdmission({ projectWork: f.work, operations: f.operations, environments: {
        createEnvironment: async () => { throw quotaExceeded('controlled full'); }, getEnvironment: async () => undefined,
      } }, operation);
      expect(await f.operations.get(operation.id)).toMatchObject({ state: 'retryable-rejected', errorCode: 'quota_exceeded' });
      expect((await f.work.history(f.projectId))[0]!.exited).toBe(true);
    } finally { await f.drop(); }
  });

  test('late grant revocation rolls back the seal and raw SQL cannot invent an already exited callback', async () => {
    const f = await businessWorkFixture();
    try {
      let grants = 0; f.checkingGrant(async () => { if (++grants === 3) throw new Error('controlled-late-grant-revocation'); });
      await expect(f.work.seal(f.context())).rejects.toThrow('late-grant-revocation');
      expect(await f.database.db.execute(sql`SELECT project_id FROM business_task.project_admissions WHERE project_id=${f.projectId}`)).toHaveLength(0);
      f.checkingGrant(async () => undefined);
      await f.work.run(f.input(), async () => undefined); const [birth] = await f.work.history(f.projectId);
      await withSharedDatabaseAdmission(f.database.db, 'business-task.project-admission:' + f.projectId, async (tx) => {
        const pid = (await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`))[0]!.pid;
        await expect(f.database.db.transaction((plain) => plain.execute(sql`INSERT INTO business_task.original_callbacks(id,project_id,service_id,kind,reference,consumer_id,input_digest,origin_revision,backend_pid,original_process,exit_key_hash,exited_at,exit_digest)
          SELECT ${newResourceId()},project_id,service_id,kind,reference,${newResourceId()},input_digest,origin_revision,${pid},original_process,exit_key_hash,now(),exit_digest
          FROM business_task.original_callbacks WHERE id=${birth!.id}`))).rejects.toMatchObject({ cause: { message: 'Business callback requires actual admitted original birth' } });
      });
      expect(await f.work.history(f.projectId)).toEqual([birth!]);
      await expect(f.work.seal({ ...f.context(), phase: 'stop' })).rejects.toThrow('完整删除许可');
      await expect(f.work.seal({ ...f.context(), confirmed: { ...f.context().confirmed, complete: false } })).rejects.toThrow('完整删除许可');
      await f.work.seal(f.context());
    } finally { await f.drop(); }
  });
});
