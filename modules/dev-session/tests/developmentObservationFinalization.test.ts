// Real PG AgentStart + original ending request + rebuilt lifecycle. Environment/Session are explicit simulated ports; no physical/model acceptance claim.
import {afterAll,beforeAll,describe,expect,test} from 'bun:test';
import {createTestDatabase,testDatabaseAvailable,type TestDatabase} from '@crewstation/testkit';
import type {TaskId} from '@crewstation/contracts';
import {AgentExecutionLifecycle} from '../application/agentExecution';
import {agentUseCases} from '../application/agents';
import {developmentObservationProducer} from '../application/development/observationProducer';
import {recoverDevelopmentEndings} from '../application/development/ending';
import {drizzleAgentStarts} from '../adapters/persistence/drizzleAgentStarts';
import {developmentEndingStore} from '../adapters/persistence/ending/store';
import {devSessionMigrations} from '../wiring';
import {workspaceActor,workspaceTask} from './workspaceFixture';
import {observationProducerFixture} from './developmentObservation/producerFixture';
const available=await testDatabaseAvailable();let database:TestDatabase;
beforeAll(async()=>{if(available)database=await createTestDatabase([devSessionMigrations]);});afterAll(async()=>{await database?.drop();});
async function fixture(){
 const f=await observationProducerFixture(database.db,{bound:true}),releases:TaskId[]=[],finalized:Array<{agentId:string;executionId:TaskId}>=[];
 f.applicationDeps.environments.releaseEnvironment=async id=>{const env=f.envs.get(id)!;releases.push(id);env.connected=false;env.state='releasing';env.native!.state='cleaning';return structuredClone(env);};
 const rebuild=()=>{const original=drizzleAgentStarts(database.db),starts={...original,finalizeEndedExecution:async(agentId:string,executionId:TaskId)=>{finalized.push({agentId,executionId});await original.finalizeEndedExecution!(agentId,executionId);}},store=developmentEndingStore(database.db,f.applicationDeps.clock),producer=developmentObservationProducer(f.applicationDeps,{...f.ports,store});return {starts,store,producer,lifecycle:new AgentExecutionLifecycle(f.applicationDeps,starts,producer)};};
 return {...f,releases,finalized,rebuild};
}
describe.skipIf(!available)('selected native physical finalization across original PG logical ending',()=>{
 test('recovery retains unfinished or missing work, then actual finished state writes finalized and removes the start from the original sweep',async()=>{
  const f=await fixture();await f.owner.close(f.child.id,'workspace-released');await f.setReceipt({phase:'finished',result:'completed',finalThrough:0},true);
  expect(await f.endingStore.get(f.child.id)).toBeUndefined();
  expect(await recoverDevelopmentEndings({owner:f.owner,store:f.endingStore,session:f.ports.ending,clock:f.applicationDeps.clock})).toEqual({checked:1,recovered:1,waiting:0});
  await f.producer.end({...f.start,state:'ended'});
  const ended=(await f.starts.get(f.start.agentId))!,job=await f.endingStore.get(f.child.id);expect(ended).toMatchObject({state:'ended',finalized:false});expect(ended.endedAt).toBeUndefined();expect(job).toMatchObject({firstReason:'workspace-released',logicalResult:'completed',actualEndedAt:null});
  await f.rebuild().lifecycle.dispatch(f.start.agentId);expect(f.finalized).toHaveLength(0);expect(f.releases).toEqual([f.child.id]);expect((await f.starts.get(f.start.agentId))!.finalized).toBe(false);
  const env=f.envs.get(f.child.id)!;f.envs.delete(f.child.id);await f.rebuild().lifecycle.dispatch(f.start.agentId);expect(f.finalized).toHaveLength(0);expect((await f.starts.listUnfinalized(undefined,500)).map(row=>row.agentId)).toContain(f.start.agentId);
  env.state='released';env.connected=false;env.native!.state='finished';f.envs.set(f.child.id,env);const recovered=f.rebuild();await recovered.lifecycle.dispatch(f.start.agentId);
  expect(f.finalized).toEqual([{agentId:f.start.agentId,executionId:f.child.id}]);expect(await f.starts.get(f.start.agentId)).toEqual({...ended,finalized:true});expect((await f.starts.listUnfinalized(undefined,500)).map(row=>row.agentId)).not.toContain(f.start.agentId);
  expect(await recovered.store.get(f.child.id)).toEqual(job);expect(f.controls.priceCalls).toBe(1);expect(f.startsSent()).toHaveLength(0);expect(f.issues).toHaveLength(0);expect(f.materialRefs).toHaveLength(0);
  f.envs.delete(f.child.id);await f.rebuild().lifecycle.sweep();expect(f.finalized).toHaveLength(1);expect(await f.starts.get(f.start.agentId)).toEqual({...ended,finalized:true});
  const rows=await agentUseCases(f.applicationDeps,f.starts,recovered.lifecycle).listAgents(workspaceActor,workspaceTask);expect(rows.find(row=>row.agentId===f.start.agentId)?.execution?.state).toBe('finished');
 },30000);
 test('narrow finalization preserves the original ending, frozen identities and request while stale full-row writes cannot reset finalized',async()=>{
  const f=await fixture();await f.producer.end({...f.start,state:'ended',cancelled:true});const before=(await f.starts.get(f.start.agentId))!,job=await f.endingStore.get(f.child.id);const env=f.envs.get(f.child.id)!;env.native!.state='finished';env.state='released';await f.rebuild().lifecycle.dispatch(f.start.agentId);
  const original=drizzleAgentStarts(database.db);await original.update({...f.start,state:'dispatched',finalized:false,cursor:17,request:{prompt:'stale replacement'},endedAt:'2030-01-01T00:00:00.000Z'});
  expect(await original.get(f.start.agentId)).toEqual({...before,cursor:17,finalized:true});expect(await f.endingStore.get(f.child.id)).toEqual(job);expect((await f.owner.get(f.child.id))!.closeReason).toBe('cancelled');expect(f.controls.priceCalls).toBe(1);
  await original.finalizeEndedExecution!(f.start.agentId,f.child.id);expect(await original.get(f.start.agentId)).toEqual({...before,cursor:17,finalized:true});
 },30000);
 test('the original execution identity and sticky logical ending are required; rejection never changes any start field',async()=>{
  const f=await fixture(),original=drizzleAgentStarts(database.db),before=(await original.get(f.start.agentId))!;
  await expect(original.finalizeEndedExecution!(f.start.agentId,f.child.id)).rejects.toMatchObject({kind:'precondition'});expect(await original.get(f.start.agentId)).toEqual(before);
  await f.producer.end({...f.start,state:'ended',cancelled:true});const ended=(await original.get(f.start.agentId))!;
  await expect(original.finalizeEndedExecution!(f.start.agentId,crypto.randomUUID() as TaskId)).rejects.toMatchObject({kind:'precondition'});await expect(original.finalizeEndedExecution!(crypto.randomUUID(),f.child.id)).rejects.toMatchObject({kind:'precondition'});
  expect(await original.get(f.start.agentId)).toEqual(ended);expect(ended.finalized).toBe(false);expect((await original.listUnfinalized(undefined,500)).map(row=>row.agentId)).toContain(f.start.agentId);expect(f.startsSent()).toHaveLength(0);
 },30000);
});
