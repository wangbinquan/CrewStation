import { afterEach, describe, expect, test } from 'bun:test';
import { newResourceId, jsonHash, noopLogger } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { releaseImageFixture } from './runtimeImageFixture';
import type { ProjectId, ServiceId } from '@crewstation/contracts';
import { ProjectDeletionTargetSchema } from '@crewstation/contracts';
import { initialSlots } from '../domain/slots';
import { resyncSlotLedger } from '../application/slotLedgerResync';
import { releaseHandoffUseCases } from '../application/execution/handoff';
import { executionHandoffFixture } from './executionHandoffFixture';
import { drizzleUnitOfWork, releaseProjectAdmissions } from '../adapters/persistence/drizzleUnitOfWork';
import { protectedReleaseEffects } from '../application/projectDeletion';

const fixtures: Array<{close():Promise<void>}> = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });
const native = { podUid: '91754092-388a-4131-a452-f9d4b75f0766', nodeUid: '8acdd9b0-3dd8-4a8a-afdf-a1d90a17cf1a', nodeName: 'controlled-test', containerId: 'containerd://' + 'a'.repeat(64), pid: process.pid, pidNamespace: '1000', bootId: '8acdd9b0-3dd8-4a8a-afdf-a1d90a17cf1a', startTicks: '123' };
const available = await testDatabaseAvailable();
describe.skipIf(!available)('发布原项目准入与外部 IO', () => {
  test('公开发布与流水线实际保留同一项目回调出生，完成后独立写原退出；默认没有删除 owner', async () => {
    let checks = 0;
    const f = await releaseImageFixture(false, (projectId) => ({ projectAdmission: { protectCurrent: async () => native, assertAvailable: async (id) => { expect(id).toBe(projectId); checks++; } } })); fixtures.push(f);
    const created = await f.runtime.api.publish(f.actor, f.serviceId, { branch: 'main', version: 'patch' });
    const first = await f.db.execute<{ kind: string; project_id: string; service_id: string; exited_at: Date | null }>(sql`SELECT kind,project_id,service_id,exited_at FROM release.deletion_callbacks`);
    expect(first).toHaveLength(1); expect(first[0]).toMatchObject({ kind: 'publish', project_id: f.projectId, service_id: f.serviceId }); expect(first[0]!.exited_at).not.toBeNull();
    await f.runtime.api.runPipelineStep(created.id);
    const callbacks = await f.db.execute<{ kind: string; consumer_id: string; exited_at: Date | null }>(sql`SELECT kind,consumer_id,exited_at FROM release.deletion_callbacks ORDER BY entered_at`);
    expect(callbacks).toHaveLength(2); expect(callbacks[1]).toMatchObject({ kind: 'pipeline', consumer_id: created.id }); expect(callbacks.every((row) => row.exited_at !== null)).toBe(true);
    expect(f.state.reservations).toHaveLength(1); expect(f.state.migrations).toHaveLength(1); expect(checks).toBeGreaterThan(8); expect(f.runtime.api.deletionOwner).toBeUndefined();
  });

  test('来源已封闭时零读仓库、零打标和零登记发布，内部凭据调用同样拒绝', async () => {
    let allowed = true;
    const f = await releaseImageFixture(false, () => ({ projectAdmission: { protectCurrent: async () => native, assertAvailable: async () => { if (!allowed) throw Error('source sealed'); } } })); fixtures.push(f);
    allowed = false;
    await expect(f.runtime.api.publish(f.actor, f.serviceId, { branch: 'main', version: 'patch' })).rejects.toThrow('source sealed');
    await expect(f.runtime.api.slotEnvValues({ recordId: newResourceId(), serviceId: f.serviceId, physical: 'green', releaseId: newResourceId(), revision: 1 })).rejects.toThrow('source sealed');
    expect(f.state.reads).toEqual([]); expect(await f.uow.read.releases.listByService(f.serviceId, 50)).toEqual([]);
    expect(await f.db.execute(sql`SELECT id FROM release.deletion_callbacks`)).toHaveLength(0);
  });

  test('外部 IO 返回时重新检查来源许可，丢失许可的响应不会打标或登记发布', async () => {
    let allowed = true, tags = 0;
    const f = await releaseImageFixture(false, () => ({
      projectAdmission: { protectCurrent: async () => native, assertAvailable: async () => { if (!allowed) throw Error('source sealed during IO'); } },
      tagger: { createReleaseTag: async () => { tags++; return { tag: 'v0.0.1', commitSha: 'c'.repeat(40) }; } },
      repo: { readFile: async () => { allowed = false; return 'kind: DigitalWorker'; }, repositoryUrl: async () => ({ httpUrl: 'http://git', credentialSecretName: 'git' }), buildSource: async () => ({ httpUrl: 'http://git' }), buildToken: async () => ({ token: 'never-issued' }) },
    })); fixtures.push(f);
    await expect(f.runtime.api.publish(f.actor, f.serviceId, { branch: 'main', version: 'patch' })).rejects.toThrow('source sealed during IO');
    expect(tags).toBe(0); expect(await f.uow.read.releases.listByService(f.serviceId, 50)).toEqual([]);
    const callbacks = await f.db.execute<{ exited_at: Date | null }>(sql`SELECT exited_at FROM release.deletion_callbacks`); expect(callbacks).toHaveLength(1); expect(callbacks[0]!.exited_at).not.toBeNull();
  });

  test('原回调返回后的迟到异步续接不能取得凭据或扩展项目／服务范围', async () => {
    const f = await releaseImageFixture(); fixtures.push(f);
    const admissions = releaseProjectAdmissions({ db: f.db, protectCurrent: async () => native, assertAvailable: async () => {} });
    const released = Promise.withResolvers<void>(); let calls = 0, delayed: Promise<unknown> | undefined;
    const port = protectedReleaseEffects({ credential: async () => { calls++; return 'private'; } }, admissions);
    await admissions.run(f.projectId, f.serviceId, { kind: 'pipeline', consumerId: newResourceId(), inputDigest: jsonHash('original') }, async () => {
      await expect(admissions.run(newResourceId(), f.serviceId, { kind: 'pipeline', consumerId: newResourceId(), inputDigest: jsonHash('other') }, async () => undefined)).rejects.toThrow('扩展');
      delayed = released.promise.then(() => port.credential()).then(() => 'unexpected', (error: unknown) => error);
    });
    released.resolve(); expect(String(await delayed)).toContain('已经退出'); expect(calls).toBe(0);
  });

  test('伪造当前进程出生拒绝登记，保护前和保护后检查源许可', async () => {
    const f = await releaseImageFixture(); fixtures.push(f);
    const admissions = releaseProjectAdmissions({ db: f.db, protectCurrent: async () => ({ ...native, pid: process.pid + 1 }), assertAvailable: async () => {} });
    await expect(admissions.run(f.projectId, f.serviceId, { kind: 'slot', consumerId: newResourceId(), inputDigest: jsonHash('bad-pid') }, async () => undefined)).rejects.toThrow('PID');
    expect(await f.db.execute(sql`SELECT id FROM release.deletion_callbacks`)).toHaveLength(0);
  });
  test('全局台账巡检逐项目准入，封闭一个项目不阻止另一项目的真实投影', async () => {
    const f = await releaseImageFixture(); fixtures.push(f);
    const otherProject = newResourceId() as ProjectId, otherService = newResourceId() as ServiceId;
    const services = { resolveServiceById: async (id: ServiceId) => ({ projectId: id === f.serviceId ? f.projectId : otherProject, slug: 'ledger', name: 'ledger', namespace: 'cs-ledger' }) };
    const uow = drizzleUnitOfWork(f.db, { ledger: { within: (tx) => f.resources.api.owner('release').within(tx as object) }, services, logger: noopLogger });
    await uow.read.slots.initialize(initialSlots(f.serviceId,new Date())); await uow.read.slots.initialize(initialSlots(otherService,new Date()));
    const admission = releaseProjectAdmissions({ db: f.db, protectCurrent: async () => native, assertAvailable: async (id) => { if (id === f.projectId) throw Error('own project sealed'); } });
    expect(await resyncSlotLedger(uow,noopLogger,{services,admission})).toBe(1);
    const callbacks = await f.db.execute<{project_id:string}>(sql`SELECT project_id FROM release.deletion_callbacks`);
    expect(callbacks).toHaveLength(1); expect(callbacks[0]!.project_id).toBe(otherProject);
  });
  test('全局交接巡检不认领封闭项目，其他项目仍按自己的原交接出生推进', async () => {
    const f = await executionHandoffFixture(); fixtures.push(f); await f.start();
    const original = (await f.uow.read.handoffs.latest(f.serviceId))!, project = newResourceId() as ProjectId, service = newResourceId() as ServiceId;
    const old = { ...f.old, id: newResourceId() as typeof f.old.id, projectId: project, serviceId: service }, target = { ...f.target, id: newResourceId() as typeof f.target.id, projectId: project, serviceId: service };
    await f.uow.read.releases.insert(old);await f.uow.read.releases.insert(target);
    await f.uow.read.handoffs.insert({ ...original,journeyId:undefined,id:newResourceId(),requestKey:newResourceId(),projectId:project,serviceId:service,expectedActiveReleaseId:old.id,targetReleaseId:target.id });
    const services = { resolveServiceById: async (id: ServiceId) => ({ projectId:id===service?project:f.old.projectId,slug:'handoff',name:'handoff',namespace:'cs-handoff' }) };
    const admission = releaseProjectAdmissions({ db:f.database.db,protectCurrent:async()=>native,assertAvailable:async(id)=>{if(id===f.old.projectId)throw Error('own project sealed');} });
    expect(await releaseHandoffUseCases({...f.deps,services,admission}).progressHandoffs()).toBe(1);
    expect((await f.uow.read.handoffs.get(original.id))!.revision).toBe(original.revision);
    expect(f.state.freezeCalls).toBe(1);
    const callbacks=await f.database.db.execute<{project_id:string}>(sql`SELECT project_id FROM release.deletion_callbacks`);expect(callbacks).toHaveLength(1);expect(callbacks[0]!.project_id).toBe(project);
  });
  test('二十条封闭交接占满一页仍能推进后面的健康项目，封闭项原内容保持且每轮有界', async () => {
    const f = await executionHandoffFixture(); fixtures.push(f); await f.start();
    const original = (await f.uow.read.handoffs.latest(f.serviceId))!, healthyProject = newResourceId() as ProjectId;
    const projects = new Map<ServiceId, ProjectId>([[f.serviceId, f.old.projectId]]);
    const add = async (projectId: ProjectId) => {
      const serviceId = newResourceId() as ServiceId;
      const old = { ...f.old, id: newResourceId() as typeof f.old.id, projectId, serviceId };
      const target = { ...f.target, id: newResourceId() as typeof f.target.id, projectId, serviceId };
      await f.uow.read.releases.insert(old); await f.uow.read.releases.insert(target);
      const id = newResourceId();
      await f.uow.read.handoffs.insert({ ...original, journeyId: undefined, id, requestKey: newResourceId(), projectId, serviceId, expectedActiveReleaseId: old.id, targetReleaseId: target.id });
      projects.set(serviceId, projectId); return id;
    };
    for (let i = 0; i < 19; i++) await add(f.old.projectId);
    const healthyId = await add(healthyProject);
    const sealedRows = () => f.database.db.execute<{ id: string; digest: string }>(sql`SELECT id,md5(to_jsonb(content)::text) AS digest FROM release.execution_handoffs content WHERE body->>'projectId'=${f.old.projectId} ORDER BY id`);
    const before = await sealedRows(); expect(before).toHaveLength(20);
    const pages: string[][] = [], pending = f.uow.read.handoffs.pending;
    const uow = { ...f.uow, read: { ...f.uow.read, handoffs: { ...f.uow.read.handoffs, pending: async (...args: Parameters<typeof pending>) => {
      expect(args[0]).toBe(20); const page = await pending(...args); pages.push(page.map((entry) => entry.id)); return page;
    } } } };
    const services = { resolveServiceById: async (id: ServiceId) => ({ projectId: projects.get(id)!, slug: 'handoff', name: 'handoff', namespace: 'cs-handoff' }) };
    const admission = releaseProjectAdmissions({ db: f.database.db, protectCurrent: async () => native, assertAvailable: async (id) => { if (id === f.old.projectId) throw Error('own project sealed'); } });
    const worker = releaseHandoffUseCases({ ...f.deps, uow, services, admission });
    // 固定取最旧二十条且在 claim 前拒绝，曾让后一页的健康项目永久饥饿。
    expect(await worker.progressHandoffs()).toBe(0); expect(await worker.progressHandoffs()).toBe(1);
    expect(pages.map((page) => page.length)).toEqual([20, 1]); expect(pages[1]).toEqual([healthyId]);
    expect(f.state.freezeCalls).toBe(1); expect(await sealedRows()).toEqual(before);
    const healthy = (await f.uow.read.handoffs.get(healthyId))!; expect(healthy.revision).toBe(1); expect(healthy.stage).toBe('freezing');
    expect(await worker.progressHandoffs()).toBe(0); expect(await worker.progressHandoffs()).toBe(1);
    expect(f.state.freezeCalls).toBe(2); expect(await sealedRows()).toEqual(before);
    const callbacks = await f.database.db.execute<{ project_id: string; exited_at: Date | null }>(sql`SELECT project_id,exited_at FROM release.deletion_callbacks`);
    expect(callbacks).toHaveLength(2); expect(callbacks.every((row) => row.project_id === healthyProject && row.exited_at !== null)).toBe(true);
  });
  test('交接扫描重入共用同一页，读取失败不推进游标且下一轮可以重试', async () => {
    const f = await executionHandoffFixture(); fixtures.push(f); await f.start();
    const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    const pending = f.uow.read.handoffs.pending; let reads = 0, failRead = false;
    const uow = { ...f.uow, read: { ...f.uow.read, handoffs: { ...f.uow.read.handoffs, pending: async (...args: Parameters<typeof pending>) => {
      reads++; if (failRead) throw Error('pending source unavailable');
      if (reads === 1) { entered.resolve(); await release.promise; }
      return pending(...args);
    } } } };
    const worker = releaseHandoffUseCases({ ...f.deps, uow });
    const first = worker.progressHandoffs(); let second: Promise<number> | undefined;
    try {
      await entered.promise; second = worker.progressHandoffs(); expect(second).toBe(first); expect(reads).toBe(1);
    } finally { release.resolve(); await Promise.all([first, second]); }
    expect(await first).toBe(1); expect(f.state.freezeCalls).toBe(1); expect(reads).toBe(1);
    failRead = true; await expect(worker.progressHandoffs()).rejects.toThrow('pending source unavailable');
    failRead = false; expect(await worker.progressHandoffs()).toBe(1); expect(f.state.freezeCalls).toBe(2); expect(reads).toBe(3);
  });
  test('交接后页按不可变原 ID 定位，前页更新时间变化不重复或漏掉下一项', async () => {
    const f = await executionHandoffFixture(); fixtures.push(f); await f.start();
    const original = (await f.uow.read.handoffs.latest(f.serviceId))!, ids = [original.id];
    for (let i = 0; i < 2; i++) {
      const serviceId = newResourceId() as ServiceId, id = newResourceId();
      const old = { ...f.old, id: newResourceId() as typeof f.old.id, serviceId }, target = { ...f.target, id: newResourceId() as typeof f.target.id, serviceId };
      await f.uow.read.releases.insert(old); await f.uow.read.releases.insert(target);
      await f.uow.read.handoffs.insert({ ...original, journeyId: undefined, id, requestKey: newResourceId(), serviceId, expectedActiveReleaseId: old.id, targetReleaseId: target.id }); ids.push(id);
    }
    expect((await f.uow.read.handoffs.pending(1)).map((row) => row.id)).toEqual([ids[0]!]);
    await f.database.db.execute(sql`UPDATE release.execution_handoffs SET updated_at='2099-01-01T00:00:00Z'::timestamptz WHERE id=${ids[0]!}`);
    expect((await f.uow.read.handoffs.pending(1, ids[0]!)).map((row) => row.id)).toEqual([ids[1]!]);
    expect((await f.uow.read.handoffs.pending(1, ids[1]!)).map((row) => row.id)).toEqual([ids[2]!]);
    expect(await f.uow.read.handoffs.pending(1, ids[2]!)).toEqual([]);
    expect((await f.uow.read.handoffs.pending(1)).map((row) => row.id)).toEqual([ids[0]!]);
  });
  test('装配完整端口才有内部 owner，原生来源缺失时空内容仍阻断；不执行物理清理', async () => {
    let effects=0;
    const f=await releaseImageFixture(false,()=>({projectAdmission:{protectCurrent:async()=>native,assertAvailable:async()=>{}},deletion:{assertGrant:async()=>{},physics:{
      capture:async()=>({complete:false,blockers:[],references:[],scope:null}),inspect:async()=>({complete:false,blockers:[],references:[]}),
      stop:async()=>{effects++;throw Error('unexpected physical stop');},purge:async()=>{effects++;throw Error('unexpected physical purge');},prove:async()=>{effects++;throw Error('unexpected physical proof');},
    }}}));fixtures.push(f);
    const target=ProjectDeletionTargetSchema.parse({id:f.projectId,serviceId:f.serviceId,slug:'image',name:'Image',namespace:'cs-image',kind:'DigitalWorker',state:'active',revision:'1',prodHost:'image.test',previewHost:'preview.image.test',serviceHost:'image'});
    const report=await f.runtime.api.deletionOwner!.inspect(target);expect(report.complete).toBe(false);expect(report.blockers.map(row=>row.code)).toContain('release-native-source-missing');expect(effects).toBe(0);
  });
  test('归并后的对象存储契约沿固定发布与服务读取，备用发布可用而外服务不认领', async () => {
    const f=await releaseImageFixture();fixtures.push(f);const planId=newResourceId();
    const created=await f.runtime.api.publish(f.actor,f.serviceId,{branch:'main',version:'patch'});await f.runtime.api.runPipelineStep(created.id);
    await f.db.execute(sql`UPDATE release.releases SET manifest=jsonb_set(manifest,'{spec,data}',${JSON.stringify({objects:{planId}})}::jsonb) WHERE id=${created.id}`);
    Object.assign(f.state.manifest.spec,{data:{objects:{planId:newResourceId()}}});
    expect(await f.runtime.api.objectStorageContract(f.serviceId,created.id)).toEqual({planId,fenced:false});expect(await f.runtime.api.objectStorageContract(newResourceId() as ServiceId,created.id)).toBeUndefined();
  });

});
