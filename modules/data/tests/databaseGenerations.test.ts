import {afterEach,describe,expect,test} from 'bun:test';
import type {ProjectId,ServiceId} from '@crewstation/contracts';
import {createTestDatabase,testDatabaseAvailable} from '@crewstation/testkit';
import {sql} from 'drizzle-orm';
import {dataMigrations} from '../wiring';
import {databaseGenerationRepository} from '../adapters/persistence/database/generations';
import {databaseGenerationUseCases} from '../application/database/generations';
import type {DataUseCaseDeps} from '../application/dependencies';
import type {DataResource} from '../domain/dataResource';
import type {DatabaseGenerationPlane} from '../ports/database/generations';
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
  await expect(Promise.resolve(f.database.db.execute(sql`INSERT INTO data.task_bindings(id,project_id,service_id,task_id,mode,state,requested_by,ttl_minutes,created_at,updated_at) VALUES(${Bun.randomUUIDv7()},${f.projectId},${f.serviceId},${Bun.randomUUIDv7()},'diagnostic-readonly','requested',${Bun.randomUUIDv7()},30,now(),now())`))).rejects.toBeDefined();
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
