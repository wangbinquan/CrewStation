import { expect,test } from 'bun:test';
import { createApp } from '@crewstation/http';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import type { ReleaseModuleApi } from '../api/moduleApi';
import { databaseMigrationRoutes } from '../http/databaseMigrationRoutes';
test('RFC-044 admin HTTP actions accept only the defined revision/digest request shape',async()=>{
 const calls:Array<{name:string;input:unknown}>=[],service=Bun.randomUUIDv7(),id=Bun.randomUUIDv7(),api=Object.fromEntries(['replan','approve','switch','open','rollback','retry','abandon'].map(name=>[name+'DatabaseMigration',async(_actor:unknown,_service:string,_id:string,input:unknown)=>{calls.push({name,input});return {id};}])) as unknown as ReleaseModuleApi;
 const app=createApp({name:'migration-admin-test'});app.route('/',databaseMigrationRoutes(api,async()=>true));
 for(const name of ['replan','approve','switch','open','rollback','retry','abandon']){
  const body={expectedRevision:2,...(name==='approve'?{approvalDigest:'sha256:'+'a'.repeat(64)}:name==='switch'||name==='open'?{confirmationDigest:'a'.repeat(64)}:{})},path=`/v1/services/${service}/database-migrations/${id}/${name}`,headers={'content-type':'application/json',[IDENTITY_HEADERS.userId]:id};
  expect((await app.request(path,{method:'POST',headers,body:JSON.stringify({...body,force:true})})).status).toBe(400);const response=await app.request(path,{method:'POST',headers,body:JSON.stringify(body)});expect(response.status).toBe(name==='abandon'?200:202);expect(calls.at(-1)).toEqual({name,input:body});
 }
});
