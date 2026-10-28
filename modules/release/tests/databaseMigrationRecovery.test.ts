import { afterEach, describe, expect, test } from 'bun:test';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { databaseMigrationFixture } from './databaseMigrationFixture';
import type { DatabaseMigrationFixture } from './databaseMigrationFixture';
import { migrationDto } from '../domain/database-migration/operation';
const available=await testDatabaseAvailable();let f:DatabaseMigrationFixture|undefined;
afterEach(async()=>{await f?.close();f=undefined;});
/** One ambiguous interruption; all durable stores and external effects survive the next freshly-created worker. */
function interrupt(target:object,key:string,when:'before'|'after'){
 const record=target as Record<string,(...args:unknown[])=>Promise<unknown>>,original=record[key]!;let fired=false;
 record[key]=async(...args)=>{if(!fired&&when==='before'){fired=true;throw new Error('interrupted before '+key);}const result=await original(...args);if(!fired){fired=true;throw new Error('interrupted after '+key);}return result;};
 return ()=>expect(fired).toBe(true);
}
describe.skipIf(!available)('RFC-044 interrupted external calls cold recovery',()=>{
 for(const when of ['before','after'] as const){
  for(const key of ['reserveMigration','prepare','envFor','readFile','pinBuiltImage','render','encrypt','observe','job'] as const)test(`${when} planning external ${key}`,async()=>{
   f=await databaseMigrationFixture();await f.api.createDatabaseMigration(f.actor,f.serviceId,f.input);
   const target=['reserveMigration','prepare','envFor'].includes(key)?f.deps.data.databaseGenerations!:key==='readFile'?f.deps.repo:key==='pinBuiltImage'?f.deps.runtimeImages!:key==='render'?f.deps.config:key==='encrypt'?f.deps.databaseMigration!:key==='observe'?f.deps.databaseMigration!.jobs:f.deps.uow.read.ledger!;
   const fired=interrupt(target,key,when);await f.until('planning');for(let i=0;i<4;i++)await f.tick();fired();const op=await f.load();expect(op.error).toBeNull();expect(op.currentAttempt?.purpose).toBe('database-migration-plan');await f.plan();expect((await f.load()).stage).toBe('awaiting-approval');expect(f.state.target).toBe(op.targetGenerationId);expect(f.state.scratch).toBe(op.scratchGenerationId);
  });
  for(const key of ['enterRestore','migrationBarrier','observeWritersStopped'] as const)test(`${when} freeze external ${key}`,async()=>{
   f=await databaseMigrationFixture();const target=key==='enterRestore'?f.deps.maintenance:f.deps.executionHandoff!,fired=interrupt(target,key,when);const op=await f.frozen();fired();expect(op.freeze).not.toBeNull();expect(op.error).toBeNull();expect(f.restoreState.maintenance).toBe(true);expect(f.state.binding.generationId).toBe(op.sourceGenerationId);
  });
  for(const key of ['commitMigration','candidate'] as const)test(`${when} activation external ${key}`,async()=>{
   f=await databaseMigrationFixture();const op=await f.frozen();await f.receipt('run');f.restoreState.ready=true;const fired=interrupt(key==='commitMigration'?f.deps.data.databaseGenerations!:f.deps.databaseMigration!.jobs,key,when);await f.until('verifying');fired();expect(f.state.binding).toMatchObject({generationId:op.targetGenerationId,revision:2});expect(f.restoreState.maintenance).toBe(true);expect((await f.uow.read.slots.get(f.serviceId))?.green.workload?.databaseGenerationId).toBe(op.targetGenerationId);
  });
  for(const key of ['openMigration','freeze','inspect','observeRoute','routeObserved'] as const)test(`${when} opening external ${key}`,async()=>{
   f=await databaseMigrationFixture();const op=await f.verified(),dto=migrationDto(op),fired=interrupt(key==='openMigration'?f.deps.data.databaseGenerations!:f.deps.executionHandoff!,key,when);
   await f.api.openDatabaseMigration(f.actor,f.serviceId,op.id,{expectedRevision:op.revision,confirmationDigest:dto.confirmationDigest!});for(let i=0;i<3;i++)await f.tick();await f.handoff();await f.until('completing');fired();expect(f.handoffState.authority.epoch).toBeGreaterThan(op.freeze!.epoch);expect((await f.uow.read.slots.get(f.serviceId))?.active).toBe('green');expect(f.restoreState.maintenance).toBe(true);
  });
  for(const key of ['revertMigration','removeWorkload','withdrawMigrationBarrier','exitRestore','finishMigration'] as const)test(`${when} rollback external ${key}`,async()=>{
   f=await databaseMigrationFixture();const op=await f.verified();await f.api.rollbackDatabaseMigration(f.actor,f.serviceId,op.id,{expectedRevision:op.revision});await f.tick();await f.receipt('rollback');
   const target=['revertMigration','finishMigration'].includes(key)?f.deps.data.databaseGenerations!:key==='removeWorkload'?f.deps.deployer:key==='exitRestore'?f.deps.maintenance:f.deps.executionHandoff!,fired=interrupt(target,key,when);await f.until('rolled-back');fired();expect(f.state.binding).toMatchObject({generationId:op.sourceGenerationId,revision:3,migrationOperationId:null});expect(f.restoreState.maintenance).toBe(false);expect((await f.uow.read.slots.get(f.serviceId))?.active).toBe('blue');
  });
  for(const key of ['exitRestore','finishMigration'] as const)test(`${when} completion external ${key}`,async()=>{
   f=await databaseMigrationFixture();const op=await f.verified(),dto=migrationDto(op);await f.api.openDatabaseMigration(f.actor,f.serviceId,op.id,{expectedRevision:op.revision,confirmationDigest:dto.confirmationDigest!});await f.tick();await f.handoff();await f.until('completing');await f.tick();await f.receipt('complete');const fired=interrupt(key==='exitRestore'?f.deps.maintenance:f.deps.data.databaseGenerations!,key,when);await f.until('completed');fired();expect(f.state.binding.generationId).toBe(op.targetGenerationId);expect(f.restoreState.maintenance).toBe(false);expect(await f.load()).toMatchObject({stage:'completed',error:null,observation:null});
  });
 }
});
