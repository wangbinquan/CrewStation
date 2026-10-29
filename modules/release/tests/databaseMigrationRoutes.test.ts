import { afterEach,describe,expect,test } from 'bun:test';
import { createApp } from '@crewstation/http';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import { testDatabaseAvailable } from '@crewstation/testkit';
import type { ReleaseModuleApi } from '../api/moduleApi';
import { databaseMigrationRoutes } from '../http/databaseMigrationRoutes';
import { databaseMigrationFixture } from './databaseMigrationFixture';
import type { DatabaseMigrationFixture } from './databaseMigrationFixture';
test('RFC-044 admin HTTP actions accept only the defined revision/digest request shape',async()=>{
 const calls:Array<{name:string;input:unknown}>=[],service=Bun.randomUUIDv7(),id=Bun.randomUUIDv7(),api=Object.fromEntries(['replan','approve','switch','open','rollback','cancel-rollback','retry','abandon'].map(name=>[(name==='cancel-rollback'?'cancelRollback':name)+'DatabaseMigration',async(_actor:unknown,_service:string,_id:string,input:unknown)=>{calls.push({name,input});return {id};}])) as unknown as ReleaseModuleApi;
 const app=createApp({name:'migration-admin-test'});app.route('/',databaseMigrationRoutes(api,async()=>true));
 for(const name of ['replan','approve','switch','open','rollback','cancel-rollback','retry','abandon']){
  const body={expectedRevision:2,...(name==='approve'?{approvalDigest:'sha256:'+'a'.repeat(64)}:name==='switch'||name==='open'?{confirmationDigest:'a'.repeat(64)}:{})},path=`/v1/services/${service}/database-migrations/${id}/${name}`,headers={'content-type':'application/json',[IDENTITY_HEADERS.userId]:id};
  expect((await app.request(path,{method:'POST',headers,body:JSON.stringify({...body,force:true})})).status).toBe(400);const response=await app.request(path,{method:'POST',headers,body:JSON.stringify(body)});expect(response.status).toBe(name==='abandon'?200:202);expect(calls.at(-1)).toEqual({name,input:body});
 }
});
const available=await testDatabaseAvailable();let f:DatabaseMigrationFixture|undefined;
afterEach(async()=>{await f?.close();f=undefined;});
describe.skipIf(!available)('cancel-rollback persisted HTTP action',()=>{
 for(const condition of ['ready','binding-reverted','rollback-requested','stale-revision'] as const)test(`cancel-rollback returns ${condition==='ready'?'202':'409'} for ${condition}`,async()=>{
  f=await databaseMigrationFixture();let op=await f.verified();await f.api.rollbackDatabaseMigration(f.actor,f.serviceId,op.id,{expectedRevision:op.revision});await f.tick();op=await f.load();f.restoreState.proofs.set(op.currentAttempt!.jobId,f.proof(op,undefined,'exit'));await f.tick();op=await f.load();
  if(condition==='binding-reverted')f.state.binding.generationId=op.sourceGenerationId;
  if(condition==='rollback-requested'){await f.store.save(op,{...op,revision:op.revision+1,rollbackRequest:'requested'});op=await f.load();}
  const app=createApp({name:'migration-cancel-rollback-test'});app.route('/',databaseMigrationRoutes(f.api as unknown as ReleaseModuleApi,async()=>true));
  const response=await app.request(`/v1/services/${f.serviceId}/database-migrations/${op.id}/cancel-rollback`,{method:'POST',headers:{'content-type':'application/json',[IDENTITY_HEADERS.userId]:f.actor.userId},body:JSON.stringify({expectedRevision:op.revision-(condition==='stale-revision'?1:0)})});
  expect(response.status).toBe(condition==='ready'?202:409);
  if(condition==='ready')expect(await response.json()).toMatchObject({stage:'ready-to-open',revision:op.revision+1,error:null,actions:['open','rollback']});
  else {expect(await response.json()).toMatchObject({error:'conflict',...(condition==='stale-revision'?{details:{code:'stale_revision'}}:{})});expect(await f.load()).toEqual(op);}
 });
});
