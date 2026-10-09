import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { withSharedDatabaseAdmissions } from '@crewstation/persistence';
import { releaseAdmissionKey } from '../adapters/persistence/drizzleUnitOfWork';
import { eventbusMigrations } from '@crewstation/eventbus';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { NATIVE_REGISTRY_ADMISSION, PROJECT_DELETION_PHASES, ProjectDeletionTargetSchema, type ProjectDeletionContext, type ProjectDeletionEvidence, type ProjectId, type ServiceId, type ReleaseId, type UserId } from '@crewstation/contracts';
import { releaseMigrations } from '../wiring';
import { drizzleUnitOfWork, releaseProjectAdmissions } from '../adapters/persistence/drizzleUnitOfWork';
import { releaseDeletionRepository } from '../adapters/persistence/projectDeletion';
import { releaseInfrastructureOrigin } from '../adapters/persistence/infrastructureOrigins';
import { releaseProjectDeletionOwner } from '../application/projectDeletion';
import { RELEASE_PHYSICAL_KINDS, releaseCallbackIdentity, type ReleasePhysicalScope } from '../domain/release';
import type { ReleaseDeletionPhysics } from '../ports/unitOfWork';
import { initialSlots } from '../domain/slots';
import { createJourney } from '../application/journey/recording';
const fixtures: Awaited<ReturnType<typeof createTestDatabase>>[]=[];
afterEach(async()=>{for(const f of fixtures.splice(0))await f.drop();});
const available=await testDatabaseAvailable();
async function setup(){
 const tdb=await createTestDatabase([eventbusMigrations,releaseMigrations]);fixtures.push(tdb);
 const db=tdb.db,uow=drizzleUnitOfWork(db),project=newResourceId() as ProjectId,service=newResourceId() as ServiceId,otherProject=newResourceId() as ProjectId,otherService=newResourceId() as ServiceId;
 const target=ProjectDeletionTargetSchema.parse({id:project,serviceId:service,slug:'demo',name:'Demo',namespace:'cs-demo',kind:'DigitalWorker',state:'active',revision:'1',prodHost:'demo.test',previewHost:'preview.demo.test',serviceHost:'demo'});
 const operationId=newResourceId(), controls={grant:true,independent:true,closed:true,stopped:true,native:0,storage:0,proofs:0,generation:1};
 const services={resolveServiceById:async(id:ServiceId)=>id===service||id===otherService?{projectId:id===service?project:otherProject,slug:'demo',name:'Demo',namespace:'cs-demo'}:undefined};
 const assertGrant=async(context:ProjectDeletionContext)=>{if(!controls.grant||context.operationId!==operationId)throw Error('wrong grant');if(context.generation!==controls.generation)throw Error('当前租约世代已失效');};
 const repository=releaseDeletionRepository({db,services,assertGrant});
 const proof=async(scope:ReleasePhysicalScope)=>{controls.proofs++;const retained=await repository.retained(target);return {kind:'done' as const,digest:jsonHash({scope,native:controls.native,storage:controls.storage}),scopeDigest:jsonHash(scope),sourceIdentity:scope.source.identity,independent:controls.independent,producersClosed:controls.closed,consumersStopped:controls.stopped,nativeRemaining:controls.native,storageRemaining:controls.storage,callbackExits:(retained?.content.callbacks??[]).map((entry)=>({id:entry.id,originalIdentity:releaseCallbackIdentity(entry),digest:jsonHash({stopped:entry.id})}))};};
 const physics:ReleaseDeletionPhysics={capture:async(_target,content)=>{const bindings=content.consumers.map(({kind,id,identity})=>({kind,id,identity})).sort((a,b)=>(a.kind+':'+a.id).localeCompare(b.kind+':'+b.id));return {complete:true,blockers:[],references:[],scope:{version:1,projectId:project,originDigest:jsonHash({projectId:project,bindings,identityLinks:content.identityLinks}),source:{identity:jsonHash('source'),epoch:jsonHash('epoch'),version:'controlled-test-port'},bindings,objects:[{kind:'artifact',id:'controlled-artifact:'+project,identity:'sha256:'+'a'.repeat(64),sourceIdentity:jsonHash('source'),count:1}],coverage:RELEASE_PHYSICAL_KINDS.map((kind)=>({kind,identity:jsonHash(kind),complete:true}))}};},inspect:async()=>({complete:true,blockers:[],references:[]}),stop:async(_context,scope)=>proof(scope),purge:async(_context,scope)=>proof(scope),prove:proof};
 const owner=releaseProjectDeletionOwner({repository,physics,assertGrant});
 const admissions=releaseProjectAdmissions({db,protectCurrent:async()=>({podUid:'91754092-388a-4131-a452-f9d4b75f0766',nodeUid:'8acdd9b0-3dd8-4a8a-afdf-a1d90a17cf1a',nodeName:'controlled-test',containerId:'containerd://'+ 'a'.repeat(64),pid:process.pid,pidNamespace:'1000',bootId:'8acdd9b0-3dd8-4a8a-afdf-a1d90a17cf1a',startTicks:'123'}),assertAvailable:async()=>undefined});
 const record=(foreign=false)=>({id:newResourceId() as ReleaseId,serviceId:foreign?otherService:service,projectId:foreign?otherProject:project,tag:'v0.0.1',commitSha:'c'.repeat(40),branch:'main',status:'failed' as const,targetSlot:'green' as const,pipeline:{step:1},createdBy:newResourceId() as UserId,createdAt:new Date('2026-10-01T00:00:00Z'),updatedAt:new Date('2026-10-01T00:00:00Z')});
 const own=record(),foreign=record(true);await uow.read.releases.insert(own);await uow.read.releases.insert(foreign);await uow.read.slots.initialize(initialSlots(service,new Date()));await uow.read.slots.initialize(initialSlots(otherService,new Date()));
 const context=(confirmed:Awaited<ReturnType<typeof owner.inspect>>,phase:ProjectDeletionContext['phase'],generation=1)=>({operationId,target,confirmed,phase,generation});
 return {tdb,db,uow,project,service,otherProject,otherService,target,operationId,controls,services,repository,owner,physics,assertGrant,admissions,record,own,foreign,context};
}
describe.skipIf(!available)('发布持久删除原范围与阶段',()=>{
 test('RFC-038 日志全量纳入原确认范围、封写和清零；外项目原流程完整保留',async()=>{
  const x=await setup();
  const own=await x.uow.run(scope=>createJourney(scope,x.own,x.own.createdBy,'publish',{kind:'repository'},x.own.createdAt));
  const foreign=await x.uow.run(scope=>createJourney(scope,x.foreign,x.foreign.createdBy,'publish',{kind:'repository'},x.foreign.createdAt));
  const savedForeign=await x.uow.read.journeys.snapshot(foreign.id);
  const content=await x.repository.content(x.target);
  expect(content.inventory.complete).toBe(true);
  expect(content.rows.filter(row=>row.table==='release_journeys')).toHaveLength(1);
  expect(content.rows.filter(row=>row.table==='release_journey_events')).toHaveLength(2);
  const confirmed=await x.owner.inspect(x.target);await x.owner.run(x.context(confirmed,'seal'));
  await expect(x.uow.read.journeys.append(own.id,{transitionKey:'late',stage:'build',state:'running',at:new Date().toISOString()})).rejects.toMatchObject({cause:{code:'55000'}});
  for(const phase of PROJECT_DELETION_PHASES.slice(1))expect((await x.owner.run(x.context(confirmed,phase))).kind).toBe('done');
  expect(await x.uow.read.journeys.snapshot(own.id)).toBeUndefined();
  expect(await x.uow.read.journeys.events(own.id)).toEqual([]);
  expect((await x.repository.content(x.target)).rows).toEqual([]);
  expect(await x.uow.read.journeys.snapshot(foreign.id)).toEqual(savedForeign);
  await expect(x.uow.run(scope=>createJourney(scope,x.own,x.own.createdBy,'publish',{kind:'repository'},x.own.createdAt))).rejects.toThrow();
 });
 test('原回调实际 finally 退出，七阶段重建重放；外项目和全局记录保持且永久拒绝迟到写',async()=>{
  const x=await setup();await x.admissions.run(x.project,x.service,{kind:'pipeline',consumerId:x.own.id,inputDigest:jsonHash('input')},async()=>{await x.uow.read.releases.update({...x.own,message:'callback'});});
  const original=await releaseInfrastructureOrigin(x.db,x.own.id);
  const before=await x.repository.content(x.target);expect(before.callbacks).toHaveLength(1);expect(before.callbacks[0]!.exited).toBe(true);expect(before.callbacks[0]!.exitDigest).toBe(releaseCallbackIdentity(before.callbacks[0]!));
  const confirmed=await x.owner.inspect(x.target);expect(confirmed.complete).toBe(true);
  for(const phase of PROJECT_DELETION_PHASES)expect((await x.owner.run(x.context(confirmed,phase))).kind).toBe('done');
  expect((await x.repository.content(x.target)).rows).toEqual([]);expect(await x.uow.read.releases.getById(x.foreign.id)).toBeDefined();expect(await x.uow.read.slots.get(x.otherService)).toBeDefined();
  expect(await releaseInfrastructureOrigin(x.db,x.own.id)).toEqual(original);
  expect((await releaseInfrastructureOrigin(x.db,x.foreign.id))?.projectIds).toEqual([x.otherProject]);
  const stored=await x.repository.load(x.context(confirmed,'verify'));expect(stored.phaseIndex).toBe(6);expect(Object.keys(stored.receipts)).toHaveLength(7);
  expect(await x.owner.run(x.context(confirmed,'metadata'))).toEqual({kind:'done',evidence:stored.receipts.metadata!});
  await expect(x.uow.read.releases.insert(x.record())).rejects.toMatchObject({cause:{code:'55000'}});
  await expect(x.admissions.run(x.project,x.service,{kind:'slot',consumerId:newResourceId(),inputDigest:jsonHash('late')},async()=>{})).rejects.toThrow('永久封闭');
 });
 test('阶段、世代、许可和完整独立证明校验；未停止和剩余字节保持等待',async()=>{
  const x=await setup(),confirmed=await x.owner.inspect(x.target);await x.owner.run(x.context(confirmed,'seal'));
  await expect(x.owner.run(x.context(confirmed,'purge'))).rejects.toThrow('前一阶段');await expect(x.owner.run(x.context(confirmed,'stop',2))).rejects.toThrow('世代');
  x.controls.independent=false;expect((await x.owner.run(x.context(confirmed,'stop'))).kind).toBe('blocked');x.controls.independent=true;x.controls.native=1;expect((await x.owner.run(x.context(confirmed,'stop'))).kind).toBe('waiting');
  x.controls.native=0;x.controls.storage=2;expect((await x.owner.run(x.context(confirmed,'stop'))).kind).toBe('done');expect((await x.owner.run(x.context(confirmed,'purge'))).kind).toBe('waiting');
  x.controls.grant=false;await expect(x.owner.run(x.context(confirmed,'purge'))).rejects.toThrow('wrong grant');expect((await x.repository.retained(x.target))!.physical).toBeDefined();
 });
 test('确认后内容变化封写且只能新世代核对，物理出生不随可变状态变化',async()=>{
  const x=await setup(),confirmed=await x.owner.inspect(x.target);await x.uow.read.releases.update({...x.own,status:'offline',message:'changed'});
  expect((await x.owner.run(x.context(confirmed,'seal'))).kind).toBe('blocked');
  const next=await x.owner.inspect(x.target);expect(next.revision).not.toBe(confirmed.revision);
  x.controls.generation=2;for(const phase of PROJECT_DELETION_PHASES)expect((await x.owner.run(x.context(next,phase,2))).kind).toBe('done');expect((await x.repository.content(x.target)).rows).toHaveLength(0);
 });
 test('verify 的旧成功回执必须重新证明，不能掩盖原资源再次出现',async()=>{
  const x=await setup(),confirmed=await x.owner.inspect(x.target);for(const phase of PROJECT_DELETION_PHASES)await x.owner.run(x.context(confirmed,phase));
  const calls=x.controls.proofs;expect((await x.owner.run(x.context(confirmed,'verify'))).kind).toBe('done');x.controls.native=1;expect((await x.owner.run(x.context(confirmed,'verify'))).kind).toBe('waiting');expect(x.controls.proofs).toBeGreaterThan(calls);
 });
 test('普通 SQL 不得改原身份、擦除封闭控制或凭 GUC 伪造退出',async()=>{
  const x=await setup();await expect(x.db.execute(sql`UPDATE release.releases SET project_id=${x.otherProject} WHERE id=${x.own.id}`).then((value)=>value)).rejects.toMatchObject({cause:{code:'55000'}});
  await x.admissions.run(x.project,x.service,{kind:'pipeline',consumerId:x.own.id,inputDigest:jsonHash('sql')},async()=>{await expect(x.db.execute(sql`UPDATE release.deletion_callbacks SET exited_at=now(),exit_digest=release.callback_receipt(to_jsonb(deletion_callbacks)) WHERE project_id=${x.project}`).then((value)=>value)).rejects.toMatchObject({cause:{code:'55000'}});});
  await expect(x.db.execute(sql`TRUNCATE release.releases`).then((value)=>value)).rejects.toMatchObject({cause:{code:'0A000'}});
  await expect(x.db.execute(sql`TRUNCATE release.releases,release.release_journeys,release.release_journey_events`).then((value)=>value)).rejects.toMatchObject({cause:{code:'55000'}});
  expect(await x.uow.read.releases.getById(x.own.id)).toEqual(x.own);
  const confirmed=await x.owner.inspect(x.target);await x.owner.run(x.context(confirmed,'seal'));
  await expect(x.db.execute(sql`DELETE FROM release.deletion_fences WHERE project_id=${x.project}`).then((value)=>value)).rejects.toMatchObject({cause:{code:'55000'}});
  await expect(x.db.execute(sql`UPDATE release.project_admissions SET sealed=false WHERE project_id=${x.project}`).then((value)=>value)).rejects.toMatchObject({cause:{code:'55000'}});
 });
 test('数据库断线不能冒充原回调退出，实际 finally 仍由私有原身份落账',async()=>{
  const x=await setup(),started=Promise.withResolvers<void>(),release=Promise.withResolvers<void>(),exited=Promise.withResolvers<void>(),channel='exit_'+newResourceId().replaceAll('-','');
  const listener=await x.tdb.handle.client.listen(channel,()=>exited.resolve());
  await x.db.execute(sql`CREATE FUNCTION public.observe_original_exit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.exited_at IS NOT NULL THEN PERFORM pg_notify(TG_ARGV[0],NEW.id);END IF;RETURN NEW;END $$`);
  await x.db.execute(sql.raw(`CREATE TRIGGER original_exit_notification AFTER UPDATE ON release.deletion_callbacks FOR EACH ROW EXECUTE FUNCTION public.observe_original_exit('${channel}')`));
  const running=x.admissions.run(x.project,x.service,{kind:'pipeline',consumerId:x.own.id,inputDigest:jsonHash('held')},async()=>{started.resolve();await release.promise;await expect(x.admissions.checkCurrent()).rejects.toThrow('exited');}).then(()=>({ok:true}),error=>({ok:false,error}));
  try{
   await started.promise;const original=(await x.repository.content(x.target)).callbacks[0]!;
   await x.db.execute(sql`SELECT pg_terminate_backend(${original.backendPid})`);expect((await running).ok).toBe(false);
   expect((await x.repository.content(x.target)).callbacks[0]!.exited).toBe(false);
   const confirmed=await x.owner.inspect(x.target);await x.owner.run(x.context(confirmed,'seal'));x.controls.native=1;
   expect((await x.owner.run(x.context(confirmed,'stop'))).kind).toBe('waiting');expect(await x.repository.callbacksExited(x.context(confirmed,'stop'))).toBe(false);
   release.resolve();await Promise.race([exited.promise,Bun.sleep(2000).then(()=>{throw Error('original finally did not notify PostgreSQL');})]);
   expect((await x.repository.content(x.target)).callbacks[0]!.exitDigest).toBe(releaseCallbackIdentity(original));
   x.controls.native=0;for(const phase of PROJECT_DELETION_PHASES.slice(1))expect((await x.owner.run(x.context(confirmed,phase))).kind).toBe('done');
  }finally{release.resolve();await running;await listener.unlisten();}
 });
 test('实际在途 shared 锁让 seal 等待，同时允许该原回调结束独立 UOW',async()=>{
  const x=await setup(),started=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();
  const running=x.admissions.run(x.project,x.service,{kind:'pipeline',consumerId:x.own.id,inputDigest:jsonHash('waiting')},async()=>{started.resolve();await release.promise;await x.uow.read.releases.update({...x.own,message:'final original write'});});
  let pending: Promise<Awaited<ReturnType<typeof x.owner.run>>>|undefined;let sealed=false;
  try{
   await started.promise;const confirmed=await x.owner.inspect(x.target);pending=x.owner.run(x.context(confirmed,'seal')).then(result=>{sealed=true;return result;});
   for(let i=0;i<100;i++){const rows=await x.db.execute(sql`SELECT 1 FROM pg_locks WHERE locktype='advisory' AND mode='ExclusiveLock' AND NOT granted`);if(rows.length)break;await Bun.sleep(5);}
   expect(sealed).toBe(false);await x.uow.read.releases.update({...x.foreign,message:'other project continues'});
  }finally{release.resolve();await running;}
  expect((await pending!).kind).toBe('blocked');const next=await x.owner.inspect(x.target);x.controls.generation=2;for(const phase of PROJECT_DELETION_PHASES)expect((await x.owner.run(x.context(next,phase,2))).kind).toBe('done');
  expect((await x.uow.read.releases.getById(x.foreign.id))?.message).toBe('other project continues');
 });
 test('原发布输入、交接目标和最小别名不可重绑定，清理后也不能插入本项目的新别名',async()=>{
  const x=await setup();await expect(x.db.execute(sql`UPDATE release.releases SET commit_sha='other' WHERE id=${x.own.id}`).then(v=>v)).rejects.toMatchObject({cause:{code:'55000'}});
  await x.db.execute(sql`INSERT INTO release.resource_identity_aliases(kind,key,id) VALUES('release','["original"]',${x.own.id})`);
  await expect(x.db.execute(sql`UPDATE release.resource_identity_aliases SET id=${x.foreign.id} WHERE key='["original"]'`).then(v=>v)).rejects.toMatchObject({cause:{code:'55000'}});
  const confirmed=await x.owner.inspect(x.target);for(const phase of PROJECT_DELETION_PHASES)await x.owner.run(x.context(confirmed,phase));
  await expect(x.db.execute(sql`INSERT INTO release.resource_identity_aliases(kind,key,id) VALUES('service','["late"]',${x.service})`).then(v=>v)).rejects.toMatchObject({cause:{code:'55000'}});
 });

 test('元数据后置许可失败时删除和阶段回执同事务回滚，再核对原内容后恢复',async()=>{
  const x=await setup(),confirmed=await x.owner.inspect(x.target);for(const phase of PROJECT_DELETION_PHASES.slice(0,5))await x.owner.run(x.context(confirmed,phase));
  const before=await x.repository.content(x.target);let calls=0;
  const losing=releaseDeletionRepository({db:x.db,services:x.services,assertGrant:async()=>{if(++calls===3)throw Error('grant lost before commit');}});
  await expect(losing.purgeMetadata(x.context(confirmed,'metadata'))).rejects.toThrow('grant lost before commit');
  expect((await x.repository.content(x.target)).rows).toEqual(before.rows);expect((await x.repository.load(x.context(confirmed,'metadata'))).phaseIndex).toBe(4);
  expect((await x.owner.run(x.context(confirmed,'metadata'))).kind).toBe('done');expect((await x.owner.run(x.context(confirmed,'verify'))).kind).toBe('done');
 });
 test('原范围缺少新存储面时不清元数据，错误来源和原回调出生不能补造恢复',async()=>{
  const x=await setup(),id=newResourceId();
  // Controlled legacy row: its process has stopped, but the old callback did not record a private finally.
  await withSharedDatabaseAdmissions(x.db,[NATIVE_REGISTRY_ADMISSION,releaseAdmissionKey(x.project)],async(protectedTx)=>{
   const backend=Number((await protectedTx.execute<{pid:number}>(sql`SELECT pg_backend_pid() AS pid`))[0]!.pid);
   await x.db.transaction(tx=>tx.execute(sql`INSERT INTO release.deletion_callbacks(id,kind,consumer_id,project_id,service_id,backend_pid,original_process,input_digest,exit_key_hash)
    VALUES(${id},'pipeline',${x.own.id},${x.project},${x.service},${backend},${JSON.stringify({podUid:'91754092-388a-4131-a452-f9d4b75f0766',nodeUid:'8acdd9b0-3dd8-4a8a-afdf-a1d90a17cf1a',nodeName:'controlled-legacy-exit',containerId:'containerd://'+ 'a'.repeat(64),pid:987321,pidNamespace:'1000',bootId:'8acdd9b0-3dd8-4a8a-afdf-a1d90a17cf1a',startTicks:'123'})}::jsonb,${jsonHash('legacy')},${jsonHash('old-exit-key')})`));
  });
  const confirmed=await x.owner.inspect(x.target);await x.owner.run(x.context(confirmed,'seal'));
  const originalStop=x.physics.stop; x.physics.stop=async(context,scope)=>{const proof=await originalStop(context,scope);return proof.kind==='done'?{...proof,callbackExits:proof.callbackExits.map(entry=>({...entry,originalIdentity:'0'.repeat(64)}))}:proof;};
  await expect(x.owner.run(x.context(confirmed,'stop'))).rejects.toThrow('原进程');expect((await x.repository.content(x.target)).callbacks[0]!.exited).toBe(false);
  x.physics.stop=originalStop;expect((await x.owner.run(x.context(confirmed,'stop'))).kind).toBe('done');const callback=(await x.repository.content(x.target)).callbacks[0]!;expect(callback.recoveryDigest).toMatch(/^[a-f0-9]{64}$/);expect(callback.exitDigest).toBe(releaseCallbackIdentity(callback,callback.recoveryDigest));
  for(const phase of PROJECT_DELETION_PHASES.slice(2,5))await x.owner.run(x.context(confirmed,phase));
  await x.db.execute(sql`CREATE TABLE release.future_private(id text,body jsonb)`);
  await expect(x.owner.run(x.context(confirmed,'metadata'))).rejects.toThrow('内容变化');expect((await x.db.execute<{count:number}>(sql`SELECT count(*)::int AS count FROM release.releases WHERE project_id=${x.project}`))[0]!.count).toBe(1);
  await x.db.execute(sql`DROP TABLE release.future_private`);for(const phase of PROJECT_DELETION_PHASES.slice(5))expect((await x.owner.run(x.context(confirmed,phase))).kind).toBe('done');
 });

});


test.skipIf(!available)('lease recovery preserves original seal release and current grant', async () => {
  const x = await setup(); x.controls.generation = 3;
  const confirmed = await x.owner.inspect(x.target); await x.owner.run(x.context(confirmed, 'seal', 3));
  const sealed = (await x.db.execute<{generation:number;revision:string;original:unknown;receipts:Partial<Record<ProjectDeletionContext['phase'],ProjectDeletionEvidence>>}>(sql`SELECT generation,revision,original,receipts FROM release.deletion_fences WHERE project_id=${x.project}`))[0]!;
  x.controls.generation = 7;
  const proofCalls = x.controls.proofs;
  await expect(x.owner.run(x.context(confirmed,'stop',3))).rejects.toThrow('世代');
  expect(x.controls.proofs).toBe(proofCalls);
  x.controls.generation = 1;
  await expect(x.owner.run(x.context(confirmed,'stop',1))).rejects.toThrow('世代');
  x.controls.generation = 7;
  await expect(x.owner.run(x.context({...confirmed,revision:'0'.repeat(64)},'stop',7))).rejects.toThrow('修订');
  expect((await x.owner.run(x.context(confirmed,'stop',7))).kind).toBe('done');
  for (const phase of PROJECT_DELETION_PHASES.slice(2)) {
    x.controls.generation++;
    expect((await x.owner.run(x.context(confirmed,phase,x.controls.generation))).kind).toBe('done');
  }
  const final = await x.repository.load(x.context(confirmed,'verify',x.controls.generation));
  expect(final.phaseIndex).toBe(6); expect(Object.keys(final.receipts)).toHaveLength(7);
  expect(final.receipts.seal).toEqual(sealed.receipts.seal);
  const fence = (await x.db.execute<{generation:number;revision:string;original:unknown}>(sql`SELECT generation,revision,original FROM release.deletion_fences WHERE project_id=${x.project}`))[0]!;
  expect(fence).toEqual({generation:sealed.generation,revision:sealed.revision,original:sealed.original});
  x.controls.generation++;
  expect(await x.owner.run(x.context(confirmed,'metadata',x.controls.generation))).toEqual({kind:'done',evidence:final.receipts.metadata!});
  expect(await x.uow.read.releases.getById(x.foreign.id)).toEqual(x.foreign);
});
