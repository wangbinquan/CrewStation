import { afterEach, describe, expect, test } from 'bun:test';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { databaseMigrationFixture } from './databaseMigrationFixture';
import type { DatabaseMigrationFixture } from './databaseMigrationFixture';
import { migrationCanonical, migrationDigest } from '../domain/database-migration/evidence';
import { migrationOperationKey } from '../domain/database-migration/operation';
import { databaseMigrationJobEnvironment, migrationObjectSource } from '../application/database-migration/owner';
import { ManifestSchema } from '@crewstation/contracts';
const available=await testDatabaseAvailable();let f:DatabaseMigrationFixture|undefined;
afterEach(async()=>{await f?.close();f=undefined;});
describe.skipIf(!available)('RFC-044 AW HTTP callbacks (production-source-manifest request shapes)',()=>{
 test('headerless artifact read missing is 200 null; raw bytes round-trip, repeated writes succeed, conflicting writes are 409',async()=>{
  f=await databaseMigrationFixture();await f.api.createDatabaseMigration(f.actor,f.serviceId,f.input);await f.until('planning');await f.tick();const op=await f.load(),operationId=migrationOperationKey(op.id);
  let response=await f.callback(`artifacts?operationId=${operationId}&name=missing`);expect(response.status).toBe(200);expect(await response.json()).toBeNull();
  const text='catalog\0\nwith bytes',digest=await f.write('.artifacts/catalog/chunk/1',text);await f.write('.artifacts/catalog/chunk/1',text);
  response=await f.callback(`artifacts?operationId=${operationId}&name=${encodeURIComponent('.artifacts/catalog/chunk/1')}`);expect(await response.json()).toEqual({bytes:Buffer.from(text).toString('base64'),digest});
  const changed='changed',hash='sha256:'+new Bun.CryptoHasher('sha256').update(changed).digest('hex');
  response=await f.callback('artifacts',{operationId,name:'.artifacts/catalog/chunk/1',digest:hash,bytes:Buffer.from(changed).toString('base64'),requestKey:`${operationId}:chunk:${hash}`});expect(response.status).toBe(409);expect(await response.json()).toMatchObject({error:'write-once-conflict',message:expect.any(String),details:{code:'write-once-conflict'}});
  const backup=await f.callback('backup?reference=old-backup');expect(backup.status).toBe(404);expect(await backup.json()).toMatchObject({error:'database_migration_restore_unsupported'});
 });
 test('freeze reference and ready epoch are rechecked; activation reports actual source/target/other binding with canonical digest',async()=>{
  f=await databaseMigrationFixture();const op=await f.frozen(),operationId=migrationOperationKey(op.id),body={operationId,reference:op.freeze!.reference,sourceGenerationId:op.sourceGenerationId,writersStopped:true};
  expect(await (await f.callback('freeze/verify',body)).json()).toEqual({verified:true});
  for(const patch of [{reference:'other'},{sourceGenerationId:Bun.randomUUIDv7()},{writersStopped:false}])expect(await(await f.callback('freeze/verify',{...body,...patch})).json()).toEqual({verified:false});
  f.state.stopped=false;expect(await(await f.callback('freeze/verify',body)).json()).toEqual({verified:false});f.state.stopped=true;f.state.epoch++;expect(await(await f.callback('freeze/verify',body)).json()).toEqual({verified:false});f.state.epoch--;
  for(const [generationId,pointsAt] of [[op.sourceGenerationId,'source'],[op.targetGenerationId,'target'],[Bun.randomUUIDv7(),'other']] as const){f.state.binding.generationId=generationId;const response=await f.callback(`activation?operationId=${operationId}`);expect(await response.json()).toEqual({pointsAt,pointerDigest:migrationDigest({generationId,revision:f.state.binding.revision})});}
  f.deps.data.databaseGenerations!.active=async()=>{throw new Error('connection unavailable');};const unavailable=await f.callback(`activation?operationId=${operationId}`);expect(unavailable.status).toBe(503);expect(unavailable.headers.get('retry-after')).toBe('3');expect(await unavailable.json()).toMatchObject({error:'unavailable',message:expect.any(String),details:{}});
 });
 test('prepared is write-once and idempotent, checks receipt and target, and never switches the binding itself',async()=>{
  f=await databaseMigrationFixture();const op=await f.frozen(),operationId=migrationOperationKey(op.id),target=op.plan!.plan.payload.target,payload={operationId,target,approvalDigest:op.approval!.digest},receipt={payload,digest:migrationDigest(payload)};
  const body={operationId,generationId:target.generationId,receiptDigest:receipt.digest,location:{kind:'postgresql-target' as const,profileRef:'crewstation:target' as const},requestKey:operationId+':'+receipt.digest};
  expect((await f.callback('prepared',body)).status).toBe(409);await f.write('activation-receipt.json',migrationCanonical(receipt));
  expect((await f.callback('prepared',{...body,location:{kind:'postgresql-target',profileRef:'env:OTHER'}})).status).toBe(400);
  expect((await f.callback('prepared',body)).status).toBe(200);expect((await f.callback('prepared',body)).status).toBe(200);expect(f.state.binding.generationId).toBe(op.sourceGenerationId);
  expect((await f.callback('prepared',{...body,receiptDigest:'sha256:'+'f'.repeat(64),requestKey:operationId+':sha256:'+'f'.repeat(64)})).status).toBe(409);
  expect((await f.load()).prepared).toEqual(body);
 });
 test('receipt mismatches fail the attempt; only the current Job token works and readonly object identity follows it',async()=>{
  f=await databaseMigrationFixture();let op=await f.frozen();const old=op,token=f.deps.databaseMigration!.token(op.currentAttempt!.jobId,op.requestDigest);
  expect(await migrationObjectSource(f.deps,op.currentAttempt!.jobId,'wrong')).toBeUndefined();
  f.restoreState.proofs.set(op.currentAttempt!.jobId,f.proof(op,{kind:'receipt',text:migrationCanonical({payload:{operationId:migrationOperationKey(op.id)},digest:'sha256:'+'a'.repeat(64)})}));await f.tick();op=await f.load();expect(op.error).toContain('receipt-mismatch');expect(op.stage).toBe('migrating');
  expect((await f.callback(`activation?operationId=${migrationOperationKey(op.id)}`,undefined,old)).status).toBe(403);
  await f.api.retryDatabaseMigration(f.actor,f.serviceId,op.id,{expectedRevision:op.revision});await f.tick();op=await f.load();expect(op.currentAttempt!.jobId).not.toBe(old.currentAttempt!.jobId);expect(await migrationObjectSource(f.deps,old.currentAttempt!.jobId,token)).toBeUndefined();
  const env=await databaseMigrationJobEnvironment(f.deps,{releaseId:op.currentAttempt!.jobId,purpose:'database-migration-run',recordId:op.currentAttempt!.jobId});expect(env.CS_PLATFORM_API_URL).toEndWith(op.currentAttempt!.jobId);expect(env.CS_PLATFORM_API_TOKEN).toBe(f.deps.databaseMigration!.token(op.currentAttempt!.jobId,op.requestDigest));
  await expect(databaseMigrationJobEnvironment(f.deps,{releaseId:op.currentAttempt!.jobId,purpose:'database-migration-run',recordId:'different'})).rejects.toThrow('身份');
 });
 test('migration object source supplies the existing readonly object route with current operation ownership',async()=>{
  f=await databaseMigrationFixture();await f.api.createDatabaseMigration(f.actor,f.serviceId,f.input);await f.until('building');const op=await f.load();
  const manifest=ManifestSchema.parse({...f.target.manifest,apiVersion:'crewstation/v3',spec:{...f.target.manifest!.spec,service:{...f.target.manifest!.spec.service,databaseMigration:{command:['app','migrate'],verifyCommand:['app','verify']}},data:{objects:{planId:Bun.randomUUIDv7()}}}});
  f.deps.repo.readFile=async()=>JSON.stringify(manifest);f.deps.data.objectEnv=async()=>({CS_OBJECTS_API:'http://objects'});await f.until('planning');await f.tick();const planned=await f.load();
  expect(await migrationObjectSource(f.deps,planned.currentAttempt!.jobId,f.deps.databaseMigration!.token(planned.currentAttempt!.jobId,planned.requestDigest))).toEqual({projectId:op.projectId,serviceId:op.serviceId,env:'production',fenced:false,writeAllowed:false,planId:manifest.spec.data!.objects.planId});
 });
 test('rollback callback is only accepted by the current rollback Job, with the original requestKey',async()=>{
  f=await databaseMigrationFixture();let op=await f.verified();await f.api.rollbackDatabaseMigration(f.actor,f.serviceId,op.id,{expectedRevision:op.revision});await f.tick();op=await f.load();
  expect((await f.callback('rollback',{requestKey:'other:rollback'})).status).toBe(409);const body={requestKey:migrationOperationKey(op.id)+':rollback'};expect((await f.callback('rollback',body)).status).toBe(200);expect((await f.callback('rollback',body)).status).toBe(200);expect((await f.load()).rollbackRequest).toBe(body.requestKey);expect(f.state.binding.generationId).toBe(op.targetGenerationId);
 });
 // RFC-044 T9 本机验收：进度循环每 3 秒在操作锁内观察 Job，负载高时持锁超过 1.5 秒；同时到达的 AW 产物回调曾被
 // keyedLock 以 409「权限正在更新，请稍后重试」拒绝，AW 把 409 当作终局，plan Job 以 exit 失败。锁忙必须是可重试的 503。
 test('a callback that meets the operation lock held by the progress loop is told to retry (503), then succeeds',async()=>{
  f=await databaseMigrationFixture();await f.api.createDatabaseMigration(f.actor,f.serviceId,f.input);await f.until('planning');await f.tick();const op=await f.load(),operationId=migrationOperationKey(op.id);
  let release!:()=>void,acquired!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;}),locked=new Promise<void>(resolve=>{acquired=resolve;});
  const holding=f.deps.databaseMigration!.coordination.run(op.id,async()=>{acquired();await held;});
  try{
   await locked;
   const busy=await f.callback(`artifacts?operationId=${operationId}&name=missing`);
   expect(busy.status).toBe(503);expect(busy.headers.get('retry-after')).toBe('3');expect(await busy.json()).toMatchObject({error:'coordination_busy'});
  }finally{release();await holding;}
  const after=await f.callback(`artifacts?operationId=${operationId}&name=missing`);expect(after.status).toBe(200);expect(await after.json()).toBeNull();
 });
});
