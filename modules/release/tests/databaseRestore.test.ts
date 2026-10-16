import { ManifestSchema } from '@crewstation/contracts';
import {afterEach,describe,expect,test} from 'bun:test';
import {testDatabaseAvailable} from '@crewstation/testkit';
import {restoreDto} from '../domain/databaseRestore';
import {databaseRestoreFixture} from './databaseRestoreFixture';
import {restoreObjectSource} from '../application/database-restore/owner';
import {sql} from 'drizzle-orm';
import {renderSlotEnv} from '../application/pipelineEnv';
const available=await testDatabaseAvailable();let f:Awaited<ReturnType<typeof databaseRestoreFixture>>|undefined;
afterEach(async()=>{await f?.close();f=undefined;});
describe.skipIf(!available)('RFC-042 durable restore workflow',()=>{
 test('creation is idempotent and owner authorized; unchanged active DB and slots stay available before explicit switch',async()=>{
  f=await databaseRestoreFixture();const before=await f.uow.read.slots.get(f.serviceId),created=await f.api.createDatabaseRestore(f.actor,f.serviceId,f.input);
  expect(await f.api.createDatabaseRestore(f.actor,f.serviceId,f.input)).toEqual(created);
  await expect(f.api.createDatabaseRestore(f.actor,f.serviceId,{...f.input,backupReference:'different'})).rejects.toThrow('不同输入');
  await expect(f.api.createDatabaseRestore(f.actor,f.serviceId,{...f.input,requestId:Bun.randomUUIDv7()})).rejects.toBeDefined();
  expect(await f.uow.read.slots.get(f.serviceId)).toEqual(before);expect(f.state.binding.generationId).toBe(f.input.expectedActiveGenerationId);expect(f.declared).toHaveLength(0);
  expect(JSON.stringify(created)).not.toContain('environmentBox');expect(JSON.stringify(created)).not.toContain('secret');
  f.state.admin=false;expect((await f.api.getDatabaseRestore(f.actor,f.serviceId,created.id)).actions).toEqual([]);await expect(f.api.retryDatabaseRestore(f.actor,f.serviceId,created.id,{expectedRevision:created.revision})).rejects.toThrow('管理员');
 });
 test('lost submit result keeps original Job identity; explicit terminal retry appends receipts and preserves target and encrypted environment',async()=>{
  f=await databaseRestoreFixture();const op=await f.prepared();await f.worker()();const first=f.declared.at(-1)!;
  f.records.set(op.restoreJobId,{...f.records.get(op.restoreJobId)!,conditions:[{type:'Created',status:'true'}]});await f.worker()();const unknown=await f.load();expect(unknown.error).toContain('不能重新执行');
  await f.api.retryDatabaseRestore(f.actor,f.serviceId,op.id,{expectedRevision:unknown.revision});expect((await f.load()).restoreJobId).toBe(op.restoreJobId);expect(f.declared).toHaveLength(1);
  f.state.proofs.set(op.restoreJobId,f.proof(op,false,true));await f.worker()();const failed=await f.load();expect(failed.error).toBeTruthy();
  const retried=await f.api.retryDatabaseRestore(f.actor,f.serviceId,op.id,{expectedRevision:failed.revision});const current=await f.load();
  expect(current.restoreJobId).not.toBe(op.restoreJobId);expect(current.targetGenerationId).toBe(op.targetGenerationId);expect(current.environmentBox).toBe(op.environmentBox);expect(current.image).toBe(op.image);
  expect(retried.previousAttempts).toHaveLength(1);expect(retried.previousAttempts[0]).toMatchObject({jobId:op.restoreJobId,receipt:{state:'failed',uid:'restore-uid'}});expect(f.observed).toContain(op.restoreJobId);
  await f.worker()();expect(f.declared.at(-1)!.job!.image).toBe(first.job!.image);expect(f.declared.at(-1)!.releaseId).toBe(current.restoreJobId);
  await expect(Promise.resolve(f.database.db.execute(sql`UPDATE release.database_restores SET revision=revision+1,body=jsonb_set(body,'{restoreJobId}',to_jsonb(${Bun.randomUUIDv7()}::text)) WHERE id=${op.id}`))).rejects.toBeDefined();
 });
 test('confirmed digest, current admin and original target are rechecked before maintenance; cold worker continues the same record',async()=>{
  f=await databaseRestoreFixture();const ready=await f.verified();expect(ready.stage).toBe('ready-to-switch');expect(ready.confirmationDigest).toMatch(/^[a-f0-9]{64}$/);expect(f.state.maintenance).toBe(false);
  await expect(f.api.switchDatabaseRestore(f.actor,f.serviceId,ready.id,{expectedRevision:ready.revision-1,confirmationDigest:ready.confirmationDigest!})).rejects.toThrow('重新核对');
  f.state.envAvailable=false;await expect(f.api.switchDatabaseRestore(f.actor,f.serviceId,ready.id,{expectedRevision:ready.revision,confirmationDigest:ready.confirmationDigest!})).rejects.toThrow('target lost');f.state.envAvailable=true;
  await f.api.switchDatabaseRestore(f.actor,f.serviceId,ready.id,{expectedRevision:ready.revision,confirmationDigest:ready.confirmationDigest!});f.state.admin=false;await f.worker()();expect((await f.load()).error).toContain('管理员');expect(f.state.maintenance).toBe(false);
  f.state.admin=true;await f.api.retryDatabaseRestore(f.actor,f.serviceId,ready.id,{expectedRevision:(await f.load()).revision});await f.worker()();expect(f.state.maintenance).toBe(true);expect((await f.load()).stage).toBe('freezing');
  await f.worker()();expect(f.state.binding.generationId).toBe(f.input.expectedActiveGenerationId);f.state.barrier=true;await f.worker()();expect((await f.load()).stage).toBe('deploying');expect(f.state.binding.generationId).toBe(f.input.expectedActiveGenerationId);
  f.state.ready=true;await f.worker()();expect((await f.load()).stage).toBe('switching');await f.worker()();expect(f.state.binding.generationId).toBe((await f.load()).targetGenerationId);expect(await f.uow.read.handoffs.get(ready.id)).toMatchObject({id:ready.id,stage:'freezing'});
 });
 test('app verification for a different backup never enables switch and public DTO omits secrets',async()=>{
  f=await databaseRestoreFixture();let op=await f.prepared();f.state.proofs.set(op.restoreJobId,f.proof(op,false));await f.worker()();op=await f.load();const receipt=f.proof(op,true);receipt.verification!.backupReferenceDigest='f'.repeat(64);f.state.proofs.set(op.verifyJobId,receipt);await f.worker()();const failed=await f.load();expect(failed.error).toContain('原备份');expect(restoreDto(failed).confirmationDigest).toBeNull();
  const source=restoreObjectSource(f.deps);expect(await source(op.verifyJobId,'wrong')).toBeUndefined();expect(JSON.stringify(restoreDto(failed))).not.toContain('encrypted:');
 });
});

test.skipIf(!available)('RFC-042 platform target DSN cannot be overridden by a declared application setting',async()=>{
 f=await databaseRestoreFixture();const op=await f.prepared(),key=Bun.randomUUIDv7(),manifest=ManifestSchema.parse({...op.manifest,spec:{...op.manifest.spec,env:[{name:'CS_DATABASE_URL',configDefinitionId:key,from:'config' as const,default:'postgres://wrong-production'}]}});
 const rendered=await renderSlotEnv(f.deps,{projectId:op.projectId,serviceId:op.serviceId,projectSlug:'fixture',serviceName:'fixture',physical:'green',manifest,databaseGeneration:{id:op.targetGenerationId,operationId:op.id}});
 expect(rendered.values.CS_DATABASE_URL).toBe('postgres://'+op.targetGenerationId);
});

test.skipIf(!available)('RFC-042 finishes only after database, route and execution authority agree; a lost finish reply re-enters the same operation',async()=>{
 f=await databaseRestoreFixture();const ready=await f.verified();await f.api.switchDatabaseRestore(f.actor,f.serviceId,ready.id,{expectedRevision:ready.revision,confirmationDigest:ready.confirmationDigest!});
 f.state.barrier=true;f.state.ready=true;
 for(let i=0;i<4;i++)await f.worker()();
 const op=await f.load();expect(op.stage).toBe('switching');expect(f.state.maintenance).toBe(true);
 f.handoffState.quiescent=true;
 await f.handoffWorker().progressHandoffs();f.prepareHandoff();await f.handoffWorker().progressHandoffs();await f.handoffWorker().progressHandoffs();
 expect((await f.uow.read.slots.get(f.serviceId))?.active).toBe(op.targetSlot);
 await f.worker()();expect((await f.load()).stage).toBe('switching');expect(f.state.maintenance).toBe(true);
 f.handoffState.routed=true;await f.handoffWorker().progressHandoffs();f.handoffState.authority.stage='complete';await f.handoffWorker().progressHandoffs();
 expect((await f.uow.read.handoffs.get(op.id))?.stage).toBe('complete');
 const generations=f.deps.data!.databaseGenerations!,finish=generations.finish;let lose=true;
 generations.finish=async(service,id)=>{await finish(service,id);if(lose){lose=false;throw new Error('finish reply lost');}};
 await f.worker()();expect((await f.load()).stage).toBe('switching');expect((await f.load()).error).toBeTruthy();
 await f.api.retryDatabaseRestore(f.actor,f.serviceId,op.id,{expectedRevision:(await f.load()).revision});await f.worker()();
 expect((await f.load()).stage).toBe('completed');expect(f.state.maintenance).toBe(false);expect(f.state.binding).toMatchObject({generationId:op.targetGenerationId,restoreOperationId:null});
 expect(await f.uow.read.switches.listByService(f.serviceId,10)).toHaveLength(1);
});
