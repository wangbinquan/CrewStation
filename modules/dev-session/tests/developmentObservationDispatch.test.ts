// Real original owner PG; synthetic independent Session transport. This does not claim real model or physical cleanup acceptance.
import {afterAll,beforeAll,describe,expect,test} from 'bun:test';
import {ResourceIdSchema} from '@crewstation/contracts';
import {createTestDatabase,testDatabaseAvailable,type TestDatabase} from '@crewstation/testkit';
import {devSessionMigrations} from '../wiring';
import {dispatchDevelopmentAgent} from '../application/development/dispatch';
import {developmentUsageOwner} from '../application/developmentUsage';
import {developmentDispatchFixture} from './developmentDispatchFixture';
import {nativeObservationFixture} from './developmentObservation/fixture';
const available=await testDatabaseAvailable();let database:TestDatabase;
beforeAll(async()=>{if(available)database=await createTestDatabase([devSessionMigrations]);});afterAll(async()=>{await database?.drop();});
describe.skipIf(!available)('explicit original native-v2 dispatch',()=>{
 test('v2 never falls back through an older Runner; original v1 support still accepts its unchanged legacy capability',async()=>{
  const f=await nativeObservationFixture(database.db);f.control.capabilities={...f.control.capabilities!,developmentNativePagesV2:undefined};
  for(let n=0;n<2;n++)expect(await dispatchDevelopmentAgent(f.deps,f.child.id)).toEqual({kind:'waiting',reason:'source-unavailable'});
  expect((await f.owner.get(f.child.id))?.unsupported).toBe(false);expect(f.calls).toHaveLength(0);expect(f.control.materialCalls).toBe(0);expect(f.startsSent()).toHaveLength(0);
  const original=await developmentDispatchFixture(database.db);expect((await dispatchDevelopmentAgent(original.deps,original.child.id)).kind).toBe('accepted');expect(original.startsSent()).toHaveLength(1);
 },30000);
 test('same-Pod capability loss after a durable bind cannot acquire new material or send a v2 start',async()=>{
  const f=await nativeObservationFixture(database.db,{bound:true}),binding=(await f.owner.get(f.child.id))!.binding;
  f.control.capabilities={...f.control.capabilities!,developmentNativePagesV2:undefined};expect(await dispatchDevelopmentAgent(f.deps,f.child.id)).toEqual({kind:'waiting',reason:'source-unavailable'});
  expect(f.control.materialCalls).toBe(0);expect(f.startsSent()).toHaveLength(0);expect((await f.owner.get(f.child.id))!.binding).toEqual(binding);expect((await f.owner.get(f.child.id))!.unsupported).toBe(false);
  f.control.capabilities={...f.control.capabilities!,developmentNativePagesV2:2};expect((await dispatchDevelopmentAgent(f.deps,f.child.id)).kind).toBe('accepted');expect(f.startsSent()).toHaveLength(1);expect(f.controls.priceCalls).toBe(1);
 },30000);
 test('a capability loss during original material acquisition is checked again and retains the same registered key',async()=>{
  const f=await nativeObservationFixture(database.db,{bound:true});f.control.onMaterial=async()=>{f.control.capabilities={...f.control.capabilities!,developmentNativePagesV2:undefined};};
  expect(await dispatchDevelopmentAgent(f.deps,f.child.id)).toEqual({kind:'waiting',reason:'source-unavailable'});expect(f.startsSent()).toHaveLength(0);expect(f.control.materialCalls).toBe(1);expect(f.registrations).not.toHaveLength(0);
  const original=(await f.owner.get(f.child.id))!;f.control.onMaterial=undefined;f.control.capabilities={...f.control.capabilities!,developmentNativePagesV2:2};
  expect((await dispatchDevelopmentAgent(f.deps,f.child.id)).kind).toBe('accepted');expect((await f.owner.get(f.child.id))!.binding).toEqual(original.binding);expect(f.controls.priceCalls).toBe(1);
 },30000);
 test('each fresh information query has an actual new correlation ID; lost ACK and a later capability drop recover one acceptance without reprice',async()=>{
  const f=await nativeObservationFixture(database.db);f.control.lostStartAck=true;expect((await dispatchDevelopmentAgent(f.deps,f.child.id)).kind).toBe('accepted');
  const original=(await f.owner.get(f.child.id))!;f.controls.priceFailure=Error('do not reprice');f.control.capabilities={...f.control.capabilities!,developmentNativePagesV2:undefined};
  const owner=developmentUsageOwner(f.store,f.starts,{getEnvironment:async()=>{throw Error('do not replace original material');}});
  expect((await dispatchDevelopmentAgent({...f.deps,owner},f.child.id)).kind).toBe('accepted');expect((await owner.get(f.child.id))!.binding).toEqual(original.binding);
  expect(f.startsSent()).toHaveLength(1);expect(f.control.materialCalls).toBe(1);expect(f.controls.priceCalls).toBe(1);
  const queries=f.calls.filter(command=>command.type==='developmentUsageInfo');expect(queries.length).toBeGreaterThanOrEqual(3);expect(new Set(queries.map(command=>command.id)).size).toBe(queries.length);
  for(const query of queries){expect(query.id.startsWith('development-info-')).toBe(true);expect(ResourceIdSchema.safeParse(query.id.slice('development-info-'.length)).success).toBe(true);if(query.key)expect(query.key).toEqual(original.binding!.key);}
  expect(queries.some(query=>query.key!==undefined)).toBe(true);
 },30000);
 test('unknown original tails hold selected work, and persisted logical terminal recovery never invents an OS exit time',async()=>{
  const f=await nativeObservationFixture(database.db,{bound:true});await f.setReceipt({phase:'unknown',interruption:'runner-restarted'});
  expect(await dispatchDevelopmentAgent(f.deps,f.child.id)).toEqual({kind:'waiting',reason:'source-unavailable'});expect(f.control.materialCalls).toBe(0);expect(f.startsSent()).toHaveLength(0);
  const g=await nativeObservationFixture(database.db,{bound:true}),finished=await g.setReceipt({phase:'finished',result:'completed',interruption:'runner-restarted'},true);
  g.control.infoFailure=true;g.control.capabilities=undefined;expect(await dispatchDevelopmentAgent(g.deps,g.child.id)).toEqual({kind:'terminal',receipt:finished,actualEndedAt:null});expect(g.control.materialCalls).toBe(0);expect(g.startsSent()).toHaveLength(0);expect((await g.starts.get(g.start.agentId))!.endedAt).toBeUndefined();
 },30000);
});
