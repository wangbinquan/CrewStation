import { ManifestSchema } from '@crewstation/contracts';
import type { ClusterResource, ReleaseId } from '@crewstation/contracts';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import {afterEach,describe,expect,test} from 'bun:test';
import {testDatabaseAvailable} from '@crewstation/testkit';
import {restoreDto} from '../domain/databaseRestore';
import {databaseRestoreFixture} from './databaseRestoreFixture';
import {restoreObjectSource} from '../application/database-restore/owner';
import {restoreEnvironment} from '../application/database-restore/jobs';
import {sql} from 'drizzle-orm';
import {renderSlotEnv} from '../application/pipelineEnv';
import {switchTrafficUseCase} from '../application/switchTraffic';
import {slotMaintenanceUseCases} from '../application/slotMaintenance';
import type {SlotControl} from '../ports/slotControl';
import {databaseRestoreRoutes} from '../http/databaseRestoreRoutes';
import type {ReleaseModuleApi} from '../api/moduleApi';
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
  expect(created.actions).toEqual(['retry','abandon']);
  f.state.admin=false;expect((await f.api.getDatabaseRestore(f.actor,f.serviceId,created.id)).actions).toEqual([]);await expect(f.api.retryDatabaseRestore(f.actor,f.serviceId,created.id,{expectedRevision:created.revision})).rejects.toThrow('管理员');
  await expect(f.api.abandonDatabaseRestore(f.actor,f.serviceId,created.id,{expectedRevision:created.revision})).rejects.toThrow('管理员');
 });
 // RFC-042 review: a Job created but never observable, and one removed by its TTL, used to fail every
 // observation forever. They now end as named failed attempts that the same operation can retry.
 test('a Job lost before any observation is a retryable attempt; retry appends receipts and preserves target and encrypted environment',async()=>{
  f=await databaseRestoreFixture();const op=await f.prepared();await f.worker()();const first=f.declared.at(-1)!;
  expect(first.job!.resources).toEqual({cpu:'75m',memory:'256Mi'});
  f.records.set(op.restoreJobId,{...f.records.get(op.restoreJobId)!,conditions:[{type:'Created',status:'true'}]});await f.worker()();const lost=await f.load();
  expect(lost.restoreJob).toMatchObject({state:'failed',failure:'job-lost'});expect(lost.error).toContain('job-lost');expect(f.declared).toHaveLength(1);
  const lostRetry=await f.api.retryDatabaseRestore(f.actor,f.serviceId,op.id,{expectedRevision:lost.revision});expect(lostRetry.previousAttempts.at(-1)!.receipt.failure).toBe('job-lost');
  let current=await f.load();expect(current.restoreJobId).not.toBe(op.restoreJobId);
  await f.worker()();f.state.proofs.set(current.restoreJobId,f.proof(current,false,true));await f.worker()();const failed=await f.load();expect(failed.error).toBeTruthy();
  const retried=await f.api.retryDatabaseRestore(f.actor,f.serviceId,op.id,{expectedRevision:failed.revision});current=await f.load();
  expect(current.restoreJobId).not.toBe(failed.restoreJobId);expect(current.targetGenerationId).toBe(op.targetGenerationId);expect(current.environmentBox).toBe(op.environmentBox);expect(current.image).toBe(op.image);
  expect(retried.previousAttempts).toHaveLength(2);expect(retried.previousAttempts[1]).toMatchObject({jobId:failed.restoreJobId,receipt:{state:'failed',uid:'restore-uid'}});expect(f.observed).toContain(failed.restoreJobId);
  await f.worker()();expect(f.declared.at(-1)!.job!.image).toBe(first.job!.image);expect(f.declared.at(-1)!.releaseId).toBe(current.restoreJobId);
  await expect(Promise.resolve(f.database.db.execute(sql`UPDATE release.database_restores SET revision=revision+1,body=jsonb_set(body,'{backupReference}','"other"') WHERE id=${op.id}`))).rejects.toBeDefined();
  await expect(Promise.resolve(f.database.db.execute(sql`UPDATE release.database_restores SET revision=revision+1,body=jsonb_set(body,'{previousAttempts}','[]') WHERE id=${op.id}`))).rejects.toBeDefined();
 });
 test('transient observation failures are recorded and retried automatically; platform rejections wait for an administrator',async()=>{
  f=await databaseRestoreFixture();const op=await f.prepared();await f.worker()();
  f.state.jobError=new Error('kube-apiserver connection reset');await f.worker()();await f.worker()();let current=await f.load();
  expect(current.error).toBeNull();expect(current.observation).toMatchObject({failures:1,message:expect.stringContaining('自动')});
  f.state.jobError=undefined;f.state.proofs.set(op.restoreJobId,f.proof(op,false));await f.worker()();current=await f.load();
  expect(current.stage).toBe('verifying');expect(current.observation).toBeNull();
  f.state.envAvailable=false;await f.worker()();current=await f.load();expect(current.observation?.failures).toBe(1);f.state.envAvailable=true;
  const {conflict}=await import('@crewstation/kernel');f.state.jobError=conflict('恢复 Job 镜像、命令或原凭据来源变化');await f.worker()();current=await f.load();
  expect(current.error).toContain('凭据来源变化');f.state.jobError=undefined;
  await f.api.retryDatabaseRestore(f.actor,f.serviceId,op.id,{expectedRevision:current.revision});expect((await f.load()).error).toBeNull();
 });
 test('confirmed digest, current admin and original target are rechecked before maintenance; any administrator can continue the cutover',async()=>{
  f=await databaseRestoreFixture();const ready=await f.verified();expect(ready.stage).toBe('ready-to-switch');expect(ready.confirmationDigest).toMatch(/^[a-f0-9]{64}$/);expect(f.state.maintenance).toBe(false);
  expect(ready.actions).toEqual(['switch','abandon']);
  await expect(f.api.switchDatabaseRestore(f.actor,f.serviceId,ready.id,{expectedRevision:ready.revision-1,confirmationDigest:ready.confirmationDigest!})).rejects.toThrow('重新核对');
  f.state.envAvailable=false;await expect(f.api.switchDatabaseRestore(f.actor,f.serviceId,ready.id,{expectedRevision:ready.revision,confirmationDigest:ready.confirmationDigest!})).rejects.toThrow('target lost');f.state.envAvailable=true;
  await f.api.switchDatabaseRestore(f.actor,f.serviceId,ready.id,{expectedRevision:ready.revision,confirmationDigest:ready.confirmationDigest!});
  // The confirming administrator lost the role: another administrator retries and becomes the acting administrator.
  const confirming=f.actor.userId;f.deps.databaseRestore!.isAdmin=async(id)=>id!==confirming;await f.worker()();expect((await f.load()).error).toContain('管理员');expect(f.state.maintenance).toBe(false);
  const other={userId:Bun.randomUUIDv7() as typeof f.actor.userId,isAdmin:true};
  await f.api.retryDatabaseRestore(other,f.serviceId,ready.id,{expectedRevision:(await f.load()).revision});expect((await f.load()).switchActor?.userId).toBe(other.userId);
  await f.worker()();expect(f.state.maintenance).toBe(true);expect((await f.load()).stage).toBe('freezing');
  await f.worker()();expect(f.state.binding.generationId).toBe(f.input.expectedActiveGenerationId);f.state.barrier=true;await f.worker()();expect((await f.load()).stage).toBe('deploying');expect(f.state.binding.generationId).toBe(f.input.expectedActiveGenerationId);
  f.state.ready=true;await f.worker()();expect((await f.load()).stage).toBe('switching');await f.worker()();expect(f.state.binding.generationId).toBe((await f.load()).targetGenerationId);
  expect(await f.uow.read.handoffs.get(ready.id)).toMatchObject({id:ready.id,stage:'freezing',actorUserId:other.userId});expect((await f.load()).switchCommitted).toBe(true);
  await expect(f.api.abandonDatabaseRestore(other,f.serviceId,ready.id,{expectedRevision:(await f.load()).revision})).rejects.toMatchObject({details:{code:'database_restore_switched'}});
  expect((await f.api.getDatabaseRestore(other,f.serviceId,ready.id)).actions).toEqual(['retry']);
 });
 test('app verification for a different backup is a failed verify attempt that never enables switch; public DTO omits secrets',async()=>{
  f=await databaseRestoreFixture();let op=await f.prepared();f.state.proofs.set(op.restoreJobId,f.proof(op,false));await f.worker()();op=await f.load();const receipt=f.proof(op,true);receipt.verification!.backupReferenceDigest='f'.repeat(64);f.state.proofs.set(op.verifyJobId,receipt);await f.worker()();const failed=await f.load();
  expect(failed.verifyJob).toMatchObject({state:'failed',failure:'receipt-mismatch'});expect(failed.verification).toBeNull();expect(restoreDto(failed).confirmationDigest).toBeNull();
  const source=restoreObjectSource(f.deps);expect(await source(op.verifyJobId,'wrong')).toBeUndefined();expect(JSON.stringify(restoreDto(failed))).not.toContain('encrypted:');
  await f.api.retryDatabaseRestore(f.actor,f.serviceId,op.id,{expectedRevision:failed.revision});expect((await f.load()).verifyJobId).not.toBe(op.verifyJobId);
 });
});

test.skipIf(!available)('RFC-042 platform target DSN cannot be overridden by a declared application setting; Job env uses the documented names verbatim',async()=>{
 f=await databaseRestoreFixture();const op=await f.prepared(),key=Bun.randomUUIDv7(),manifest=ManifestSchema.parse({...op.manifest,spec:{...op.manifest.spec,env:[{name:'CS_DATABASE_URL',configDefinitionId:key,from:'config' as const,default:'postgres://wrong-production'}]}});
 const rendered=await renderSlotEnv(f.deps,{projectId:op.projectId,serviceId:op.serviceId,projectSlug:'fixture',serviceName:'fixture',physical:'green',manifest,databaseGeneration:{id:op.targetGenerationId,operationId:op.id}});
 expect(rendered.values.CS_DATABASE_URL).toBe('postgres://'+op.targetGenerationId);
 // RFC-042 review: CS declared CS_DATABASE_RESTORE_OBJECTS_TOKEN while the Job injected CS_OBJECTS_TOKEN.
 const env=await restoreEnvironment(f.deps,op,'database-restore');
 expect(env).toMatchObject({CS_DATABASE_RESTORE_REFERENCE:'aw-backup:immutable',CS_DATABASE_RESTORE_OPERATION:op.id,CS_OBJECTS_TOKEN:'token-'+op.restoreJobId,CS_OBJECTS_URL:'http://objects.test/readonly/'+op.restoreJobId});
 expect(env).not.toHaveProperty('CS_DATABASE_RESTORE_OBJECTS_TOKEN');
 expect(op.backupReferenceDigest).toBe(new Bun.CryptoHasher('sha256').update('aw-backup:immutable').digest('hex'));
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
 await f.worker()();expect((await f.load()).stage).toBe('switching');expect((await f.load()).observation?.failures).toBe(1);
 await f.worker()();
 expect((await f.load()).stage).toBe('completed');expect(f.state.maintenance).toBe(false);expect(f.state.binding).toMatchObject({generationId:op.targetGenerationId,restoreOperationId:null});
 expect(await f.uow.read.switches.listByService(f.serviceId,10)).toHaveLength(1);
});

// RFC-042 review: the slot trigger compared a new active slot with the latest COMPLETED restore, so a
// second restore on the same service could never switch, and leftover slots surfaced as HTTP 500.
test.skipIf(!available)('RFC-042 a second restore on the same service switches and completes; the retained slot cannot take traffic back',async()=>{
 f=await databaseRestoreFixture();const first=await f.complete((await f.verified()).id);expect(first.stage).toBe('completed');
 const afterFirst=await f.uow.read.slots.get(f.serviceId),candidate=afterFirst![afterFirst!.active].releaseId!;
 const second={requestId:Bun.randomUUIDv7(),expectedActiveGenerationId:first.targetGenerationId,expectedActiveReleaseId:candidate as ReleaseId,restoreReleaseId:f.target.id,backupReference:'aw-backup:second'};
 const ready=await f.verified(second);expect(ready.stage).toBe('ready-to-switch');
 const done=await f.complete(second.requestId);expect(done.stage).toBe('completed');expect(f.state.binding.generationId).toBe(done.targetGenerationId);
 const slots=(await f.uow.read.slots.get(f.serviceId))!;expect(slots.active).toBe(done.targetSlot);expect(slots[slots.active].workload?.databaseGenerationId).toBe(done.targetGenerationId);
 const back={toSlot:'preview' as const,expectedActiveRelease:slots[slots.active].releaseId!,expectedTargetRelease:candidate as ReleaseId,requestKey:Bun.randomUUIDv7()};
 await expect(switchTrafficUseCase(f.deps)(f.actor,f.serviceId,back)).rejects.toMatchObject({kind:'precondition',details:{code:'database_generation_retained'}});
});

test.skipIf(!available)('RFC-042 abandon before cutover releases the reservation, keeps the target and lets a new restore start',async()=>{
 f=await databaseRestoreFixture();const op=await f.prepared();await f.worker()();f.state.proofs.set(op.restoreJobId,f.proof(op,false,true));await f.worker()();const failed=await f.load();
 await expect(f.api.abandonDatabaseRestore(f.actor,f.serviceId,op.id,{expectedRevision:failed.revision-1})).rejects.toMatchObject({details:{code:'stale_revision'}});
 const abandoned=await f.api.abandonDatabaseRestore(f.actor,f.serviceId,op.id,{expectedRevision:failed.revision});
 expect(abandoned).toMatchObject({stage:'abandoned',actions:[],abandonedBy:f.actor.userId});expect(f.state.binding.restoreOperationId).toBeNull();expect(f.state.abandoned).toEqual([op.id]);
 expect(f.state.withdrawn).toEqual([op.id]);expect(f.state.exits).toEqual([]);expect(f.observed).toContain(op.restoreJobId);
 expect(await f.api.abandonDatabaseRestore(f.actor,f.serviceId,op.id,{expectedRevision:1})).toEqual(abandoned);
 expect(await f.api.retryDatabaseRestore(f.actor,f.serviceId,op.id,{expectedRevision:1})).toEqual(abandoned);
 await f.deps.databaseRestore!.coordination.assertAvailable(f.serviceId);
 const next=await f.api.createDatabaseRestore(f.actor,f.serviceId,{...f.input,requestId:Bun.randomUUIDv7()});expect(next.stage).toBe('requested');
});

test.skipIf(!available)('RFC-042 abandon during cutover releases maintenance, the write barrier and the candidate slot without switching',async()=>{
 f=await databaseRestoreFixture();const ready=await f.verified();await f.api.switchDatabaseRestore(f.actor,f.serviceId,ready.id,{expectedRevision:ready.revision,confirmationDigest:ready.confirmationDigest!});
 f.state.barrier=true;await f.worker()();await f.worker()();const deploying=await f.load();expect(deploying.stage).toBe('deploying');expect(f.state.maintenance).toBe(true);
 expect(await f.uow.read.releases.findInProgress(f.serviceId)).toMatchObject({id:deploying.candidateReleaseId});
 // While the restore is unfinished, ordinary slot changes are refused with the documented code instead of HTTP 500.
 await expect(switchTrafficUseCase(f.deps)(f.actor,f.serviceId,{toSlot:'preview',expectedActiveRelease:f.old.id,expectedTargetRelease:deploying.candidateReleaseId,requestKey:Bun.randomUUIDv7()})).rejects.toMatchObject({details:{code:'database_restore_active'}});
 const abandoned=await f.api.abandonDatabaseRestore(f.actor,f.serviceId,ready.id,{expectedRevision:deploying.revision});
 expect(abandoned.stage).toBe('abandoned');expect(f.state.maintenance).toBe(false);expect(f.state.exits).toEqual([ready.id]);expect(f.state.withdrawn).toEqual([ready.id]);
 expect(f.state.binding).toMatchObject({generationId:f.input.expectedActiveGenerationId,restoreOperationId:null});
 const slots=(await f.uow.read.slots.get(f.serviceId))!;expect(slots.active).not.toBe(deploying.targetSlot);expect(slots[deploying.targetSlot].offline?.releaseId).toBe(deploying.candidateReleaseId);
 expect(await f.uow.read.releases.findInProgress(f.serviceId)).toBeUndefined();expect((await f.uow.read.releases.getById(deploying.candidateReleaseId))?.status).toBe('failed');
});

// RFC-042 review: an unfinished restore reserves only its candidate slot. Resource-center maintenance of
// the live slot stays available, and the reserved slot is refused with the documented code until abandon.
test.skipIf(!available)('RFC-042 an unfinished restore blocks slot maintenance only on its reserved slot, and abandon frees it',async()=>{
 f=await databaseRestoreFixture();const created=await f.api.createDatabaseRestore(f.actor,f.serviceId,f.input),op=await f.load();
 const maintenance=slotMaintenanceUseCases({...f.deps,slotControl:{} as SlotControl,isAdmin:async()=>true});
 const inspect=async(physical:'blue'|'green')=>{
  const slot=(await maintenance.listClusterSlots()).find(s=>s.serviceId===f!.serviceId&&s.physical===physical)!;
  const target={serviceId:f!.serviceId,physicalSlot:physical,domainRevision:slot.revision,availableActions:[{action:'restart',enabled:true,executionRoute:'release',reason:'',impactSummary:[]}]} as unknown as ClusterResource;
  return (await maintenance.inspectSlotOperation(f!.actor,target,{action:'restart'})).capability;
 };
 expect(op.targetSlot).toBe('green');expect((await f.uow.read.slots.get(f.serviceId))?.active).toBe('blue');
 expect(await inspect('blue')).toMatchObject({enabled:true});
 expect(await inspect('green')).toMatchObject({enabled:false,reason:expect.stringContaining('数据库恢复保留了该部署槽')});
 await f.api.abandonDatabaseRestore(f.actor,f.serviceId,created.id,{expectedRevision:(await f.load()).revision});
 expect(await inspect('green')).toMatchObject({enabled:true});
});

// RFC-042 review: abandon is reachable over HTTP with the same body validation and documented refusal codes as retry/switch.
test.skipIf(!available)('RFC-042 abandon route validates its body, returns documented refusal codes and the abandoned operation',async()=>{
 f=await databaseRestoreFixture();const created=await f.api.createDatabaseRestore(f.actor,f.serviceId,f.input);
 const app=createApp({name:'restore-routes'});app.route('/',databaseRestoreRoutes(f.api as unknown as ReleaseModuleApi,async()=>true));
 const post=(body:unknown)=>app.request(`/v1/services/${f!.serviceId}/database-restores/${created.id}/abandon`,{method:'POST',headers:{'content-type':'application/json',[IDENTITY_HEADERS.userId]:f!.actor.userId},body:JSON.stringify(body)});
 expect((await post({})).status).toBe(400);
 const stale=await post({expectedRevision:created.revision+5});expect(stale.status).toBe(409);expect(await stale.json()).toMatchObject({details:{code:'stale_revision'}});
 const done=await post({expectedRevision:(await f.load()).revision});expect(done.status).toBe(200);expect(await done.json()).toMatchObject({id:created.id,stage:'abandoned',actions:[]});
 expect(f.state.binding.restoreOperationId).toBeNull();
});
