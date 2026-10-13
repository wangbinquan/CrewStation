import {afterAll,beforeAll,describe,expect,test} from 'bun:test';
import {createTestDatabase,testDatabaseAvailable,type TestDatabase} from '@crewstation/testkit';
import {newResourceId} from '@crewstation/kernel';
import type {TaskId,ProjectId,ServiceId} from '@crewstation/contracts';
import {devSessionMigrations} from '../wiring';
import {agentStarts} from '../adapters/persistence/agentStartTable';
import {readDevelopmentObservationTaskPage,readDevelopmentObservationAttemptPage} from '../adapters/persistence/developmentObservationFacts';
const available=await testDatabaseAvailable();let db:TestDatabase;beforeAll(async()=>{if(available)db=await createTestDatabase([devSessionMigrations]);});afterAll(async()=>{await db?.drop();});
describe.skipIf(!available)('RFC-034 all original headless executions',()=>{
 test('unselected executions run to actual EOF beyond 200; original project scope and fixed profile remain visible without fake usage',async()=>{
  const parentId=newResourceId() as TaskId,projectId=newResourceId() as ProjectId,serviceId=newResourceId() as ServiceId,profileId=newResourceId(),rows=Array.from({length:211},(_,n)=>({agentId:newResourceId(),taskId:parentId,createdBy:newResourceId(),compute:profileId,computeName:'Original compute',profile:{profileId,revision:7},permission:'full',request:{prompt:'private fixture; never part of observation'},execution:{taskId:newResourceId() as TaskId,runnerId:newResourceId(),image:'fixture'},state:'ended',finalized:true,createdAt:new Date(Date.parse('2026-10-12T00:00:00.000Z')+n).toISOString()}));
  await db.db.insert(agentStarts).values(rows.map(row=>({...row,executionTaskId:row.execution.taskId})));const parents=async(ids:readonly string[])=>ids.includes(parentId)?[{id:parentId,projectId,serviceId,traceId:null}]:[],query={from:'2026-10-12T00:00:00.000Z',to:'2026-10-13T00:00:00.000Z',timezone:'UTC',projectId,pageSize:100};let after:string|undefined,count=0;const seen=new Set<string>();
  do{const page=await readDevelopmentObservationTaskPage(db.db,{...query,...(after?{after}:{})},parents);for(const fact of page.items){expect(fact.projectId).toBe(projectId);expect(fact.source?.kind).toBe('development-agent');expect(seen.has(fact.id)).toBe(false);seen.add(fact.id);expect(JSON.stringify(fact)).not.toContain('private fixture');count++;}after=page.nextCursor??undefined;}while(after);
  expect(count).toBe(211);const selected=rows.at(-1)!;const child=await readDevelopmentObservationAttemptPage(db.db,{...query,taskId:selected.execution.taskId},parents);expect(child.items).toHaveLength(1);expect(child.items[0]).toMatchObject({profileId,profileRevision:7,profileName:'Original compute',startedAt:null,endedAt:null});
  const other=await readDevelopmentObservationTaskPage(db.db,{...query,projectId:newResourceId() as ProjectId},parents);expect(other.items).toEqual([]);expect(other.nextCursor).toBeNull();await expect(readDevelopmentObservationTaskPage(db.db,query,async()=>[])).rejects.toMatchObject({kind:'conflict'});
 });
});
