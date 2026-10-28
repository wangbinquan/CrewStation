import {afterEach,describe,expect,test} from 'bun:test';
import type {ProjectId,ServiceId} from '@crewstation/contracts';
import {createTestDatabase,testDatabaseAvailable} from '@crewstation/testkit';
import {sql} from 'drizzle-orm';
import {dataMigrations} from '../wiring';
import {databaseGenerationRepository} from '../adapters/persistence/databaseGenerations';
import {databaseGenerationUseCases} from '../application/serviceData';
import type {DataUseCaseDeps} from '../application/dependencies';
import type {DataResource} from '../domain/dataResource';
import type {DatabaseGenerationPlane} from '../ports/repositories';
const available=await testDatabaseAvailable();
let close:(()=>Promise<void>)|undefined;
afterEach(async()=>{await close?.();close=undefined;});
async function fixture(){
 const database=await createTestDatabase([dataMigrations]);close=()=>database.drop();
 const id=Bun.randomUUIDv7(),serviceId=Bun.randomUUIDv7() as ServiceId,projectId=Bun.randomUUIDv7() as ProjectId;
 await database.db.execute(sql`INSERT INTO data.resources(id,project_id,service_id,kind,env,plan,state,env_var,object_name,created_at,updated_at) VALUES(${id},${projectId},${serviceId},'postgres','production','basic','ready','CS_DATABASE_URL','cs_original',now(),now())`);
 const store=databaseGenerationRepository(database.db),source:DataResource={id,projectId,serviceId,kind:'postgres',env:'production',plan:'basic',state:'ready',envVar:'CS_DATABASE_URL',objectName:'cs_original',createdAt:new Date(),updatedAt:new Date()};
 await store.ensureInitial(source);
 const physical=new Map<string,NonNullable<Awaited<ReturnType<DatabaseGenerationPlane['inspect']>>>>([['cs_original',{identity:{serverId:'original-server',databaseOid:'101',roleOid:'201'},empty:false,birthDigest:null,provisioning:false}]]);
 const declarations:unknown[]=[];
 const data={resources:{getById:async()=>source},services:{resolveServiceById:async()=>({projectId})},authorizer:{authorize:async()=>{}},clock:{now:()=>new Date()},provisioning:{credentials:{credentialOf:async()=>({password:'retained-password'})},dsnOf:(_role:string,_password:string,name:string)=>'postgres://target/'+name}} as unknown as DataUseCaseDeps;
 const api=databaseGenerationUseCases({data,store,plane:{inspect:async input=>physical.get(input.databaseName)??null},ledger:{declare:async (input:unknown)=>{declarations.push(input);return undefined;}} as never});
 const request={id:Bun.randomUUIDv7(),operationId:Bun.randomUUIDv7(),serviceId,expectedGenerationId:id,expectedRevision:1};
 const target=()=>store.get(request.id);
 const mark=async()=>{const row=(await target())!;physical.set(row.objectName,{identity:{serverId:'original-server',databaseOid:'102',roleOid:'202'},empty:true,birthDigest:'a'.repeat(64),provisioning:false});await api.prepare(serviceId,request.operationId,request.id);};
 return {database,store,api,id,serviceId,projectId,physical,declarations,request,target,mark};
}
describe.skipIf(!available)('RFC-042 physical database generations',()=>{
 test('one immutable target survives reentry; CAS retains original and blocks access until closure',async()=>{
  const f=await fixture(),original=await f.store.get(f.id);
  await f.api.reserve(f.request);expect(await f.api.reserve(f.request)).toMatchObject({id:f.request.id,origin:'restore'});
  expect((await f.api.active(f.serviceId,'production')).generationId).toBe(f.id);
  expect(await f.api.prepare(f.serviceId,f.request.operationId,f.request.id)).toEqual({ready:false,identity:null});
  await f.mark();expect(await f.api.envFor(f.serviceId,f.request.id,f.request.operationId)).toMatchObject({CS_DATABASE_GENERATION_ID:f.request.id,CS_DATABASE_GENERATION_OPERATION:f.request.operationId});
  await expect(f.store.assertUnreserved(f.serviceId)).rejects.toThrow('恢复操作');
  // RFC-042 review: the reservation is enforced by documented application prechecks, not a trigger raising HTTP 500.
  await expect(f.store.assertUnreserved(f.serviceId)).rejects.toMatchObject({kind:'conflict',details:{code:'database_restore_active'}});
  await expect(f.store.withUnreserved(f.serviceId,async()=>'rotated')).rejects.toMatchObject({details:{code:'database_restore_active'}});
  const commit={operationId:f.request.operationId,serviceId:f.serviceId,sourceGenerationId:f.id,targetGenerationId:f.request.id,expectedRevision:1};
  const switched=await f.api.commit(commit);expect(switched).toMatchObject({generationId:f.request.id,revision:2,restoreOperationId:f.request.operationId});expect(await f.api.commit(commit)).toEqual(switched);
  expect(await f.store.get(f.id)).toMatchObject({objectName:original!.objectName,credentialResourceId:original!.credentialResourceId,state:'retained'});
  await expect(f.api.envFor(f.serviceId,f.id)).rejects.toThrow('当前绑定');
  await f.api.finish(f.serviceId,f.request.operationId);await f.api.finish(f.serviceId,f.request.operationId);await f.store.assertUnreserved(f.serviceId);
  expect(f.physical.size).toBe(2);
 });
 test('concurrent reservations serialize; a foreign or replaced target never becomes usable',async()=>{
  const f=await fixture();const both=await Promise.allSettled([f.api.reserve(f.request),f.api.reserve({...f.request,id:Bun.randomUUIDv7(),operationId:Bun.randomUUIDv7()})]);expect(both.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const result=both.find(entry=>entry.status==='fulfilled')!;if(result.status!=='fulfilled')throw new Error('no reservation');f.request.id=result.value.id;f.request.operationId=result.value.restoreOperationId!;const chosen=f.request;
  const target=(await f.target())!;f.physical.set(target.objectName,{identity:{serverId:'server',databaseOid:'9',roleOid:'8'},empty:true,birthDigest:null,provisioning:false});
  await expect(f.api.prepare(f.serviceId,chosen.operationId,chosen.id)).rejects.toThrow('本操作创建');
  await f.mark();const declaredBeforeReplacement=structuredClone(f.declarations);expect(f.declarations.at(-1)).toMatchObject({display:{generationId:chosen.id}});f.physical.get(target.objectName)!.identity.databaseOid='999';
  await expect(f.api.envFor(f.serviceId,chosen.id,chosen.operationId)).rejects.toThrow('物理身份');
  await expect(f.api.prepare(f.serviceId,chosen.operationId,chosen.id)).rejects.toThrow('同名替换');
  f.physical.delete(target.objectName);await expect(f.api.prepare(f.serviceId,chosen.operationId,chosen.id)).rejects.toThrow('丢失');expect(f.declarations).toEqual(declaredBeforeReplacement);
 });
 test('source replacement, changed restore identity and active production grants reject before cutover',async()=>{
  const f=await fixture();const binding=Bun.randomUUIDv7();
  await f.database.db.execute(sql`INSERT INTO data.task_bindings(id,project_id,service_id,task_id,mode,state,requested_by,ttl_minutes,created_at,updated_at) VALUES(${binding},${f.projectId},${f.serviceId},${Bun.randomUUIDv7()},'production-change','approved',${Bun.randomUUIDv7()},30,now(),now())`);
  await expect(f.api.reserve(f.request)).rejects.toThrow('生产数据库访问');
  await f.database.db.execute(sql`UPDATE data.task_bindings SET state='revoked' WHERE id=${binding}`);await f.api.reserve(f.request);await f.mark();
  await expect(f.api.reserve({...f.request,id:Bun.randomUUIDv7()})).rejects.toThrow('改绑');
  f.physical.get('cs_original')!.identity.databaseOid='777';
  await expect(f.api.commit({operationId:f.request.operationId,serviceId:f.serviceId,sourceGenerationId:f.id,targetGenerationId:f.request.id,expectedRevision:1})).rejects.toThrow('物理身份');expect((await f.api.active(f.serviceId,'production')).generationId).toBe(f.id);
 });
});

test.skipIf(!available)('RFC-042 original supply must settle before a source identity can be retained',async()=>{
 const f=await fixture(),original=f.physical.get('cs_original')!;f.physical.set('cs_original',{...original,provisioning:true});
 await expect(f.api.reserve(f.request)).rejects.toThrow('供给仍在结算');expect(await f.target()).toBeUndefined();expect(f.declarations).toHaveLength(0);
 f.physical.set('cs_original',original);await f.api.reserve(f.request);expect(f.declarations[0]).toMatchObject({spec:{independentDatabase:true}});expect((f.declarations[0] as {spec:{provision?:string}}).spec.provision).toBeUndefined();
});

// RFC-042 review: an unfinished restore could never be ended, so its reservation blocked production
// access, credential rotation and new restores forever.
test.skipIf(!available)('RFC-042 abandon releases an uncommitted reservation, retains the target and refuses after the commit',async()=>{
 const f=await fixture();await f.api.reserve(f.request);await f.mark();const reserved=(await f.target())!;
 await f.api.abandon(f.serviceId,f.request.operationId);await f.api.abandon(f.serviceId,f.request.operationId);
 expect(await f.api.active(f.serviceId,'production')).toMatchObject({generationId:f.id,restoreOperationId:null});
 expect(await f.target()).toMatchObject({state:'retained',identity:reserved.identity,objectName:reserved.objectName});
 expect(await f.store.withUnreserved(f.serviceId,async()=>'rotated')).toBe('rotated');
 f.request.id=Bun.randomUUIDv7();f.request.operationId=Bun.randomUUIDv7();await f.api.reserve(f.request);await f.mark();
 await f.api.commit({operationId:f.request.operationId,serviceId:f.serviceId,sourceGenerationId:f.id,targetGenerationId:f.request.id,expectedRevision:1});
 await expect(f.api.abandon(f.serviceId,f.request.operationId)).rejects.toMatchObject({details:{code:'database_restore_switched'}});
 expect((await f.api.active(f.serviceId,'production')).generationId).toBe(f.request.id);
});

test.skipIf(!available)('RFC-044 reserves target and scratch once, commits with CAS and reverts only before opening',async()=>{
 const f=await fixture(),input={...f.request,scratchId:Bun.randomUUIDv7()};
 await f.api.reserveMigration(input);expect(await f.api.reserveMigration(input)).toMatchObject({id:input.id,origin:'migration',migrationOperationId:input.operationId});
 const target=(await f.store.get(input.id))!,scratch=(await f.store.get(input.scratchId))!;
 expect(target.objectName).toBe('cs_migrate_'+input.id.replaceAll('-',''));expect(scratch.objectName).toBe('cs_mscratch_'+input.scratchId.replaceAll('-',''));
 for(const [row,n] of [[target,2],[scratch,3]] as const){f.physical.set(row.objectName,{identity:{serverId:'original-server',databaseOid:String(100+n),roleOid:String(200+n)},empty:true,birthDigest:'b'.repeat(64),provisioning:false});expect((await f.api.prepare(f.serviceId,input.operationId,row.id)).ready).toBe(true);}
 expect(await f.api.envFor(f.serviceId,input.id,input.operationId)).toEqual({CS_DATABASE_URL:'postgres://target/'+target.objectName});
 await expect(f.store.withUnreserved(f.serviceId,async()=>'rotated')).rejects.toMatchObject({details:{code:'database_migration_active'}});
 await expect(f.api.reserve({...f.request,id:Bun.randomUUIDv7(),operationId:Bun.randomUUIDv7()})).rejects.toMatchObject({details:{code:'database_migration_active'}});
 const commit={operationId:input.operationId,serviceId:f.serviceId,sourceGenerationId:f.id,targetGenerationId:input.id,expectedRevision:1};
 await expect(f.api.commitMigration({...commit,targetGenerationId:input.scratchId})).rejects.toThrow('目标');
 const results=await Promise.all([f.api.commitMigration(commit),f.api.commitMigration(commit)]);expect(results[0]).toEqual(results[1]);expect(results[0]).toMatchObject({generationId:input.id,revision:2});
 expect(await f.api.envFor(f.serviceId,f.id,input.operationId)).toEqual({CS_DATABASE_URL:'postgres://target/cs_original'});
 expect(await f.api.revertMigration(commit)).toMatchObject({generationId:f.id,revision:3});expect(await f.api.revertMigration(commit)).toMatchObject({generationId:f.id,revision:3});
 await expect(f.api.commitMigration(commit)).rejects.toThrow('CAS');
 await f.api.finishMigration(f.serviceId,input.operationId);await f.api.finishMigration(f.serviceId,input.operationId);await f.store.assertUnreserved(f.serviceId);
 expect(await f.store.get(input.scratchId)).toMatchObject({state:'retained'});
});
test.skipIf(!available)('RFC-044 opening closes rollback, and scratch binding is rejected even by direct persistence',async()=>{
 const f=await fixture(),input={...f.request,scratchId:Bun.randomUUIDv7()};await f.api.reserveMigration(input);
 for(const id of [input.id,input.scratchId]){const row=(await f.store.get(id))!;f.physical.set(row.objectName,{identity:{serverId:'original-server',databaseOid:id===input.id?'102':'103',roleOid:id===input.id?'202':'203'},empty:true,birthDigest:'c'.repeat(64),provisioning:false});await f.api.prepare(f.serviceId,input.operationId,id);}
 await expect(Promise.resolve(f.database.db.execute(sql`UPDATE data.database_environment_bindings SET generation_id=${input.scratchId} WHERE service_id=${f.serviceId}`))).rejects.toMatchObject({cause:{message:'scratch generation cannot be bound'}});
 const commit={operationId:input.operationId,serviceId:f.serviceId,sourceGenerationId:f.id,targetGenerationId:input.id,expectedRevision:1};
 await f.api.commitMigration(commit);await f.api.openMigration(f.serviceId,input.operationId);await f.api.openMigration(f.serviceId,input.operationId);
 await expect(f.api.revertMigration(commit)).rejects.toMatchObject({details:{code:'database_migration_opened'}});
 await f.api.finishMigration(f.serviceId,input.operationId);expect(await f.store.get(f.id)).toMatchObject({state:'retained'});expect(await f.api.envFor(f.serviceId,input.id)).not.toHaveProperty('CS_DATABASE_GENERATION_ID');
});
test.skipIf(!available)('RFC-044 concurrent migration and restore reservations have one winner and reject production grants',async()=>{
 const f=await fixture();const both=await Promise.allSettled([f.api.reserve(f.request),f.api.reserveMigration({...f.request,id:Bun.randomUUIDv7(),operationId:Bun.randomUUIDv7(),scratchId:Bun.randomUUIDv7()})]);expect(both.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 await expect(f.store.withUnreserved(f.serviceId,async()=>'grant')).rejects.toThrow();
});

test.skipIf(!available)('RFC-044 production access INSERT is serialized with migration reservation at the database boundary',async()=>{
 const f=await fixture(),input={...f.request,scratchId:Bun.randomUUIDv7()};await f.api.reserveMigration(input);
 await expect(Promise.resolve(f.database.db.execute(sql`INSERT INTO data.task_bindings(id,project_id,service_id,task_id,mode,state,requested_by,ttl_minutes,created_at,updated_at) VALUES(${Bun.randomUUIDv7()},${f.projectId},${f.serviceId},${Bun.randomUUIDv7()},'production-change','requested',${Bun.randomUUIDv7()},30,now(),now())`))).rejects.toMatchObject({cause:{message:'database_migration_active'}});
});
