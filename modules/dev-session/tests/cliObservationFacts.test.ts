// RFC-034: legacy nullable frozen CLI profiles must not remove original executions.
import {afterEach,beforeEach,describe,expect,test} from 'bun:test';
import {sql} from 'drizzle-orm';
import {createTestDatabase,testDatabaseAvailable,type TestDatabase} from '@crewstation/testkit';
import {newResourceId} from '@crewstation/kernel';
import type {TaskId,ProjectId,ServiceId} from '@crewstation/contracts';
import {devSessionMigrations} from '../wiring';
import {nativeTerminalStarts} from '../adapters/persistence/nativeTerminalTable';
import {readCliObservationTaskPage,readCliObservationAttemptPage} from '../adapters/persistence/observability/cliObservationFacts';

const available=await testDatabaseAvailable();let database:TestDatabase;
beforeEach(async()=>{if(available)database=await createTestDatabase([devSessionMigrations]);});
afterEach(async()=>{await database?.drop();});
const start='2026-10-14T00:00:00.000Z';
async function fixture(count:number,legacy:boolean){
 const parentId=newResourceId() as TaskId,projectId=newResourceId() as ProjectId,serviceId=newResourceId() as ServiceId,profileId=newResourceId();
 const rows=Array.from({length:count},(_,n)=>{const agentId=newResourceId(),executionId=newResourceId() as TaskId;return {agentId,taskId:parentId,createdBy:newResourceId(),clientRequestId:crypto.randomUUID(),fingerprint:'original-cli-'+n,input:{clientRequestId:crypto.randomUUID(),cols:80,rows:24},profile:legacy?null:{profileId,revision:7},executionTaskId:executionId,execution:{taskId:executionId,acceptedAt:start},record:{agentId,terminalId:newResourceId(),runnerId:newResourceId(),compute:profileId,computeName:'Original CLI compute',permission:'edit' as const,revision:3,lifecycle:'ended' as const,startedAt:start,endedAt:start,cols:80,rows:24,...(legacy?{}:{profileRevision:7})}};});
 await database.db.insert(nativeTerminalStarts).values(rows);
 const parents=async(ids:readonly string[])=>ids.includes(parentId)?[{id:parentId,projectId,serviceId,traceId:null}]:[];
 return {rows,parentId,projectId,profileId,parents,query:{from:'2026-10-14T00:00:00.000Z',to:'2026-10-15T00:00:00.000Z',timezone:'UTC',projectId,pageSize:37}};
}
describe.skipIf(!available)('original CLI observation profile history',()=>{
 test('all 211 legacy executions retain recorded compute and unknown revision through original EOF',async()=>{
  const f=await fixture(211,true),seen=new Set<string>();let after:string|undefined;
  do{const page=await readCliObservationTaskPage(database.db,{...f.query,...(after?{after}:{})},f.parents);for(const row of page.items){expect(row.projectId).toBe(f.projectId);expect(row.source?.kind).toBe('development-cli');expect(seen.has(row.id)).toBe(false);seen.add(row.id);}if(page.nextCursor)expect(page.nextCursor).not.toBe(after);after=page.nextCursor??undefined;}while(after);
  expect(seen.size).toBe(211);expect([...seen].sort()).toEqual(f.rows.map(row=>row.executionTaskId).sort());
  const attempt=await readCliObservationAttemptPage(database.db,{...f.query,taskId:f.rows[0]!.executionTaskId},f.parents);
  expect(attempt.nextCursor).toBeNull();expect(attempt.items).toHaveLength(1);expect(attempt.items[0]).toMatchObject({profileId:f.profileId,profileName:'Original CLI compute',profileRevision:null,startedAt:null,endedAt:null});
  expect((await readCliObservationTaskPage(database.db,{...f.query,projectId:newResourceId() as ProjectId},f.parents)).items).toEqual([]);
 },60_000);
 test('a frozen current profile retains its original revision and rejects a changed record',async()=>{
  const f=await fixture(1,false),row=f.rows[0]!;
  expect((await readCliObservationAttemptPage(database.db,{...f.query,taskId:row.executionTaskId},f.parents)).items[0]).toMatchObject({profileId:f.profileId,profileRevision:7});
  await database.db.execute(sql`UPDATE dev_session.native_terminal_starts SET record=jsonb_set(record,'{profileRevision}','8'::jsonb) WHERE agent_id=${row.agentId}`);
  await expect(readCliObservationTaskPage(database.db,f.query,f.parents)).rejects.toMatchObject({kind:'conflict'});
  await database.db.execute(sql`UPDATE dev_session.native_terminal_starts SET record=${JSON.stringify(row.record)}::jsonb WHERE agent_id=${row.agentId}`);
  expect((await readCliObservationTaskPage(database.db,f.query,f.parents)).items).toHaveLength(1);
 });
 test('an absent profile does not permit a mismatched original execution identity',async()=>{
  const f=await fixture(1,true),row=f.rows[0]!;
  await database.db.execute(sql`UPDATE dev_session.native_terminal_starts SET execution=jsonb_set(execution,'{taskId}',to_jsonb(${newResourceId()}::text)) WHERE agent_id=${row.agentId}`);
  await expect(readCliObservationTaskPage(database.db,f.query,f.parents)).rejects.toMatchObject({kind:'conflict'});
 });
});
