// Real original PG admission, material and ending transitions; Session transport is simulated explicitly.
import {afterAll,beforeAll,describe,expect,test} from 'bun:test';
import {IDENTITY_HEADERS,ServiceIdSchema} from '@crewstation/contracts';
import type {TestDatabase} from '@crewstation/testkit';
import {createTestDatabase,testDatabaseAvailable} from '@crewstation/testkit';
import {developmentUsageOwner} from '../application/developmentUsage';
import {developmentObservationProducer} from '../application/development/observationProducer';
import {developmentUsageOwnerStore} from '../adapters/persistence/developmentUsage';
import {drizzleAgentStarts} from '../adapters/persistence/drizzleAgentStarts';
import {developmentEndingStore} from '../adapters/persistence/ending/store';
import {devSessionMigrations} from '../wiring';
import {observationProducerFixture} from './developmentObservation/producerFixture';
const available=await testDatabaseAvailable();let database:TestDatabase;
beforeAll(async()=>{if(available)database=await createTestDatabase([devSessionMigrations]);});afterAll(async()=>{await database?.drop();});
describe.skipIf(!available)('selected native v2 actual original producer stores',()=>{
 test('default-off preparation and an absent owner acquire neither price nor material nor an ending job',async()=>{
  const f=await observationProducerFixture(database.db,{prepared:false}),legacy={...f.start,execution:{...f.start.execution,observationIntent:undefined}};
  await f.producer.prepare(legacy);await f.producer.end(legacy);expect(await f.owner.get(f.child.id)).toBeUndefined();expect(await f.endingStore.get(f.child.id)).toBeUndefined();expect(f.controls.priceCalls).toBe(0);expect(f.issues).toHaveLength(0);expect(f.materialRefs).toHaveLength(0);
 },30000);
 test('prepare persists one price and frozen context, then a reconstructed producer restores it without current workspace or repricing',async()=>{
  const f=await observationProducerFixture(database.db,{prepared:false});await f.producer.prepare(f.start);const original=(await f.owner.get(f.child.id))!;
  expect(original).toMatchObject({intent:f.preparation.intent,context:f.preparation.context,price:{priceBookRevision:3}});expect(f.controls.priceCalls).toBe(1);f.envs.delete(f.workspace.id);f.controls.priceRevision=99;f.controls.priceFailure=Error('new prices unavailable');
  const owner=developmentUsageOwner(developmentUsageOwnerStore(database.db),drizzleAgentStarts(database.db),f.environmentPort,f.pricing),restored=developmentObservationProducer(f.applicationDeps,{...f.ports,owner});await restored.prepare(f.start);
  expect(await owner.get(f.child.id)).toEqual(original);expect(f.controls.priceCalls).toBe(1);expect(f.issues).toHaveLength(0);expect(f.materialRefs).toHaveLength(0);
 },30000);
 test('first preparation with a missing original project workspace remains unadmitted and unpriced',async()=>{
  const f=await observationProducerFixture(database.db,{prepared:false});f.envs.delete(f.workspace.id);await expect(f.producer.prepare(f.start)).rejects.toMatchObject({kind:'precondition'});
  expect(await f.owner.get(f.child.id)).toBeUndefined();expect(f.controls.priceCalls).toBe(0);expect(f.issues).toHaveLength(0);expect(f.calls).toHaveLength(0);
 },30000);
 test('dispatch registers the original journal before fresh material, sends its frozen intent once, and keeps credentials out of the PG owner',async()=>{
  const f=await observationProducerFixture(database.db);expect((await f.producer.dispatch(f.start)).kind).toBe('accepted');const original=(await f.owner.get(f.child.id))!,command=f.startsSent()[0]!;
  expect(f.materialOrder).toEqual([{registered:true,empty:true}]);expect(f.materialRefs).toEqual([{profileId:original.intent.profileId,revision:2}]);expect(f.issues).toEqual([{taskId:f.workspace.id,projectId:f.workspace.projectId,serviceId:ServiceIdSchema.parse(f.workspace.serviceId),userId:f.start.createdBy}]);
  expect(command).toMatchObject({agentId:f.start.agentId,profileRevision:2,launch:original.intent.launch,initialPrompt:original.intent.initialPrompt,resumeSessionId:original.intent.resumeSessionId,processAttemptId:f.start.agentId+':1',developmentUsage:{intent:original.intent,key:original.binding!.key,digestNonce:original.digestNonce}});
  expect(command.mcp).toEqual(original.intent.mcp.map(m=>({...m,headers:{[IDENTITY_HEADERS.devSessionToken]:'new-test-credential-1'}})));expect(JSON.stringify(original)).not.toContain('new-test-credential');expect(JSON.stringify(original)).not.toContain('only-this-command');
  f.controls.priceFailure=Error('current fee not consulted');expect((await f.producer.dispatch(f.start)).kind).toBe('accepted');expect(f.startsSent()).toHaveLength(1);expect(f.materialRefs).toHaveLength(1);expect(f.issues).toHaveLength(1);expect(f.controls.priceCalls).toBe(1);
 },30000);
 test('unsupported or interrupted original journal acquires no material, and changed launch material never starts another command',async()=>{
  const f=await observationProducerFixture(database.db);f.control.capabilities!.developmentNativePagesV2=undefined;expect(await f.producer.dispatch(f.start)).toEqual({kind:'waiting',reason:'source-unavailable'});expect(f.issues).toHaveLength(0);expect(f.materialRefs).toHaveLength(0);
  f.control.capabilities!.developmentNativePagesV2=2;await f.owner.bind(f.child.id,f.info);await f.setReceipt({phase:'unknown',interruption:'journal-unavailable'});expect(await f.producer.dispatch(f.start)).toEqual({kind:'waiting',reason:'source-unavailable'});expect(f.issues).toHaveLength(0);expect(f.materialRefs).toHaveLength(0);
  const changed=await observationProducerFixture(database.db);changed.materialControl.changedLaunch=true;expect(await changed.producer.dispatch(changed.start)).toEqual({kind:'waiting',reason:'command-conflict'});expect(changed.startsSent()).toHaveLength(0);expect(changed.materialRefs).toHaveLength(1);expect(changed.controls.priceCalls).toBe(1);
 },30000);
 test('the owner first close reason and original binding survive reconstructed ending stores with unknown actual end time',async()=>{
  const f=await observationProducerFixture(database.db,{bound:true});await f.owner.close(f.child.id,'workspace-released');await f.setReceipt({phase:'finished',result:'completed',finalThrough:0},true);
  await f.producer.end({...f.start,state:'ended',cancelled:true});const first=(await f.endingStore.get(f.child.id))!;expect(first).toMatchObject({firstReason:'workspace-released',logicalResult:null,actualEndedAt:null,stage:'awaiting-stop'});
  const restored=developmentObservationProducer(f.applicationDeps,{...f.ports,store:developmentEndingStore(database.db,f.applicationDeps.clock)});await restored.end({...f.start,state:'ended',failure:'later error'});
  expect(await f.endingStore.get(f.child.id)).toEqual(first);expect((await f.owner.get(f.child.id))!.closeReason).toBe('workspace-released');expect(await f.starts.get(f.start.agentId)).toMatchObject({state:'ended',finalized:false});expect(f.startsSent()).toHaveLength(0);expect(f.controls.priceCalls).toBe(1);
 },30000);
 test('a logical completed handoff waits for actual original terminal evidence, then retries the same closed owner without inventing a physical exit',async()=>{
  const f=await observationProducerFixture(database.db,{bound:true});await expect(f.producer.end({...f.start,state:'ended'})).rejects.toThrow();expect((await f.owner.get(f.child.id))!.closeReason).toBe('completed');expect(await f.endingStore.get(f.child.id)).toBeUndefined();
  const receipt=await f.setReceipt({phase:'finished',result:'completed',finalThrough:0},true);await f.producer.end({...f.start,state:'ended',cancelled:true});
  expect(await f.endingStore.get(f.child.id)).toMatchObject({firstReason:'completed',logicalResult:'completed',actualEndedAt:null,stage:'awaiting-stop',stop:null,closure:null});expect((await f.owner.get(f.child.id))!.binding!.key).toEqual(receipt.key);expect(f.startsSent()).toHaveLength(0);expect(f.issues).toHaveLength(0);expect(f.controls.priceCalls).toBe(1);
 },30000);
 test('unbound cancellation queues an original ending job without claiming a zero stream, rebinding or starting a model',async()=>{
  const f=await observationProducerFixture(database.db);await f.producer.end({...f.start,state:'ended',cancelled:true});expect(await f.endingStore.get(f.child.id)).toMatchObject({firstReason:'cancelled',logicalResult:null,actualEndedAt:null,stage:'awaiting-stop',stop:null,closure:null});
  expect((await f.owner.get(f.child.id))!.binding).toBeNull();expect(f.registrations).toHaveLength(0);expect(f.calls).toHaveLength(0);expect(f.issues).toHaveLength(0);expect(f.materialRefs).toHaveLength(0);expect(f.controls.priceCalls).toBe(1);
 },30000);
});
