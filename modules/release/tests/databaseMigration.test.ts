import { afterEach, describe, expect, test } from 'bun:test';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { databaseMigrationFixture } from './databaseMigrationFixture';
import type { DatabaseMigrationFixture } from './databaseMigrationFixture';
import { databaseRestoreCommands } from '../application/database-restore/commands';
import { migrationEnvironment } from '../application/database-migration/environment';
import { migrationDto, migrationOperationKey } from '../domain/database-migration/operation';
import { restoreGuardedReleaseApi } from '../application/database-restore/owner';
import { switchTrafficUseCase } from '../application/switchTraffic';
import type { ReleaseModuleApi } from '../api/moduleApi';
const available=await testDatabaseAvailable();let f:DatabaseMigrationFixture|undefined;
afterEach(async()=>{await f?.close();f=undefined;});
async function failedRollback(f:DatabaseMigrationFixture){
 const ready=await f.verified();await f.api.rollbackDatabaseMigration(f.actor,f.serviceId,ready.id,{expectedRevision:ready.revision});await f.tick();
 const rolling=await f.load();f.restoreState.proofs.set(rolling.currentAttempt!.jobId,{...f.proof(rolling,undefined,'exit'),logTail:'reverse-migration-required'});await f.tick();
 const failed=await f.load();expect(failed.stage).toBe('rolling-back');expect(failed.error).toContain('exit');expect(failed.currentAttempt?.proof?.receipt.state).toBe('failed');
 return {ready,failed};
}
describe.skipIf(!available)('RFC-044 persisted migration',()=>{
 test('original request is idempotent; restore, publish, offline, redeploy and switch refuse an open migration',async()=>{
  f=await databaseMigrationFixture();const api=f.api,op=await api.createDatabaseMigration(f.actor,f.serviceId,f.input);
  expect(await api.createDatabaseMigration(f.actor,f.serviceId,f.input)).toEqual(op);
  await expect(api.createDatabaseMigration(f.actor,f.serviceId,{...f.input,branch:'different'})).rejects.toThrow('不同输入');
  const results=await Promise.allSettled([api.createDatabaseMigration(f.actor,f.serviceId,{...f.input,requestId:Bun.randomUUIDv7()}),databaseRestoreCommands(f.deps).createDatabaseRestore(f.actor,f.serviceId,{...f.input,requestId:Bun.randomUUIDv7(),restoreReleaseId:f.target.id,backupReference:'backup'})]);
  expect(results.every(r=>r.status==='rejected')).toBe(true);
  const guarded=restoreGuardedReleaseApi(f.deps,{publish:async()=>{throw new Error('called publish');},takeOffline:async()=>{throw new Error('called offline');},redeploy:async()=>{throw new Error('called redeploy');}} as unknown as ReleaseModuleApi);
  for(const call of [()=>guarded.publish(f!.actor,f!.serviceId,{branch:'main',version:{kind:'patch'}} as never),()=>guarded.takeOffline(f!.actor,f!.serviceId,{} as never),()=>guarded.redeploy(f!.actor,f!.old.id,{} as never),()=>switchTrafficUseCase(f!.deps)(f!.actor,f!.serviceId,{toSlot:'preview',expectedActiveRelease:f!.old.id,expectedTargetRelease:f!.target.id,requestKey:Bun.randomUUIDv7()})])await expect(call()).rejects.toMatchObject({details:{code:'database_migration_active'}});
  f.restoreState.admin=false;expect((await api.getDatabaseMigration(f.actor,f.serviceId,op.id)).actions).toEqual([]);await expect(api.abandonDatabaseMigration(f.actor,f.serviceId,op.id,{expectedRevision:op.revision})).rejects.toMatchObject({kind:'forbidden'});
 });
 test('build is isolated; approved digest and separate confirmation precede maintenance; frozen environments drive five Job purposes',async()=>{
  f=await databaseMigrationFixture();let op=await f.planned();expect(op.stage).toBe('awaiting-approval');expect(f.state.binding.generationId).toBe(op.sourceGenerationId);expect(f.restoreState.maintenance).toBe(false);
  const release=await f.uow.read.releases.getById(op.candidateReleaseId);expect(release?.pipeline.databaseMigration).toEqual({operationId:op.id,generationId:op.targetGenerationId});expect(release?.tag).toContain('+migrate.');expect(release?.image).toBe(f.restoreState.image);
  // RFC-044 T9 本机验收：构建 Job 曾把候选版本号原样当镜像标签，其中的 + 被仓库拒绝（invalid reference format）。
  expect((f.declared[0]!.job!.env as Record<string,string>).IMAGE).toMatch(/^registry\/[^:]+:v\d+\.\d+\.\d+_migrate\.[0-9a-f]{32}$/);
  expect(f.declared.map(j=>j.job!.purpose)).toEqual(['build','database-migration-plan']);expect((await f.uow.read.slots.get(f.serviceId))?.green.releaseId).toBe(f.target.id);
  const env=await migrationEnvironment(f.deps,op,'database-migration-plan');expect(env).toMatchObject({CS_DATABASE_MIGRATION_OPERATION_ID:migrationOperationKey(op.id),CS_DATABASE_MIGRATION_SOURCE_GENERATION:op.sourceGenerationId,CS_DATABASE_MIGRATION_ACTION:'plan',CS_DATABASE_MIGRATION_SOURCE_KEY:'source-key',CS_DATABASE_MIGRATION_SOURCE_BORN_ON_POSTGRESQL:'1'});expect(env).not.toHaveProperty('CS_DATABASE_GENERATION_ID');expect(env).not.toHaveProperty('CS_DATABASE_GENERATION_OPERATION');expect(JSON.stringify(migrationDto(op))).not.toContain('postgres://');
  await expect(f.api.approveDatabaseMigration(f.actor,f.serviceId,op.id,{expectedRevision:op.revision,approvalDigest:'sha256:'+'f'.repeat(64)})).rejects.toMatchObject({details:{code:'database_migration_approval_mismatch'}});
  await f.api.approveDatabaseMigration(f.actor,f.serviceId,op.id,{expectedRevision:op.revision,approvalDigest:op.plan!.plan.approvalDigest});op=await f.load();const approved=migrationDto(op);
  await expect(f.api.switchDatabaseMigration(f.actor,f.serviceId,op.id,{expectedRevision:op.revision-1,confirmationDigest:approved.confirmationDigest!})).rejects.toMatchObject({details:{code:'stale_revision'}});
  await expect(f.api.switchDatabaseMigration(f.actor,f.serviceId,op.id,{expectedRevision:op.revision,confirmationDigest:'a'.repeat(64)})).rejects.toMatchObject({details:{code:'database_migration_confirmation_mismatch'}});
  await f.api.switchDatabaseMigration(f.actor,f.serviceId,op.id,{expectedRevision:op.revision,confirmationDigest:approved.confirmationDigest!});await f.tick();await f.tick();expect((await f.load()).error).toBeNull();expect((await f.load()).freeze).toBeNull();
  f.restoreState.barrier=true;f.state.stopped=false;await f.tick();expect((await f.load()).freeze).toBeNull();f.state.stopped=true;await f.until('migrating');await f.tick();op=await f.load();
  expect(op.freeze?.reference).toStartWith(`cs-freeze:${op.id}:4:`);expect(f.declared.at(-1)?.job).toMatchObject({activeDeadlineSeconds:3600,scratchSize:String(30*1024**3),resources:{cpu:'75m',memory:'256Mi'}});
  expect(await migrationEnvironment(f.deps,op,'database-migration-run')).toMatchObject({CS_DATABASE_MIGRATION_APPROVE:op.approval!.digest,CS_DATABASE_MIGRATION_FREEZE_REFERENCE:op.freeze!.reference});
 });
 // RFC-044 T9 本机验收：迁移 Job 沿用服务套餐（250m/512Mi），AW 的 run Job 顶在 512Mi 里反复 GC、几乎没有进展。
 // Manifest 可以为迁移单独声明套餐：迁移 Job 用它，候选槽仍用服务套餐；声明的套餐不存在时，构建阶段就停下。
 test('migration Jobs use the plan declared for the migration while the candidate keeps the service plan; an unknown plan stops the build',async()=>{
  for(const declared of ['present','missing'] as const){
   f=await databaseMigrationFixture();
   const servicePlan=f.target.manifest!.spec.service.servicePlanId,migrationPlan=Bun.randomUUIDv7(),read=f.deps.repo.readFile;
   const plans:Record<string,{cpu:string;memory:string}>={[servicePlan]:{cpu:'75m',memory:'256Mi'},...(declared==='present'?{[migrationPlan]:{cpu:'1',memory:'3Gi'}}:{})};
   f.deps.plans={...f.deps.plans,getServicePlan:async(id:string)=>plans[id]?{id,name:id,description:'',maxReplicas:1,...plans[id]!}:undefined} as typeof f.deps.plans;
   f.deps.repo={...f.deps.repo,readFile:async(...args:Parameters<typeof read>)=>{const text=await read(...args);if(args[2]!=='crewstation.yaml'||!text)return text;const manifest=JSON.parse(text);manifest.spec.service.databaseMigration.servicePlanId=migrationPlan;return JSON.stringify(manifest);}} as typeof f.deps.repo;
   if(declared==='missing'){
    await f.api.createDatabaseMigration(f.actor,f.serviceId,f.input);await expect(f.until('planning')).rejects.toThrow('迁移套餐不可用');
    expect(f.declared.some(j=>String(j.job?.purpose).startsWith('database-migration'))).toBe(false);await f.close();f=undefined;continue;
   }
   const op=await f.verified();
   expect(f.declared.filter(j=>String(j.job?.purpose).startsWith('database-migration')).map(j=>j.job!.resources)).toEqual([{cpu:'1',memory:'3Gi'},{cpu:'1',memory:'3Gi'},{cpu:'1',memory:'3Gi'}]);
   expect((await f.uow.read.slots.get(f.serviceId))?.[op.targetSlot].workload?.resources).toEqual({cpu:'75m',memory:'256Mi'});
  }
 });
 test('replan invalidates approval; a run PLAN awaits fresh approval while retaining its freeze, target and attempt history',async()=>{
  f=await databaseMigrationFixture();let op=await f.frozen();const freeze=op.freeze;
  await f.plan([{id:'blocked',block:{code:'v3-plan-blocked'},remediation:{message:'settle source'}}],true);op=await f.load();expect(op.stage).toBe('awaiting-reapproval');expect(op.approval).toBeNull();expect(migrationDto(op).actions).toEqual(['rollback']);expect(op.freeze).toEqual(freeze);expect(f.restoreState.maintenance).toBe(true);
  await expect(f.api.approveDatabaseMigration(f.actor,f.serviceId,op.id,{expectedRevision:op.revision,approvalDigest:op.plan!.plan.approvalDigest})).rejects.toThrow();
 });
 test('run receipt activates only after prepared; candidate stays frozen, verification opens only through a newer execution epoch and observed route',async()=>{
  f=await databaseMigrationFixture();let op=await f.verified();expect(op.stage).toBe('ready-to-open');expect(f.state.binding.generationId).toBe(op.targetGenerationId);expect(f.restoreState.maintenance).toBe(true);expect(f.state.opened).toBe(false);expect((await f.uow.read.slots.get(f.serviceId))?.active).toBe('blue');
  const ready=migrationDto(op);await f.api.openDatabaseMigration(f.actor,f.serviceId,op.id,{expectedRevision:op.revision,confirmationDigest:ready.confirmationDigest!});await f.tick();expect(f.state.opened).toBe(true);expect(migrationDto(await f.load()).actions).not.toContain('rollback');
  await f.handoff();await f.until('completing');await f.tick();op=await f.load();expect(await migrationEnvironment(f.deps,op,'database-migration-complete')).toHaveProperty('CS_DATABASE_MIGRATION_ACTION','complete');await f.receipt('complete');await f.tick();
  expect((await f.load()).stage).toBe('completed');expect(f.state.finished).toBe(true);expect(f.restoreState.maintenance).toBe(false);expect((await f.uow.read.slots.get(f.serviceId))?.active).toBe('green');expect(f.state.binding.generationId).toBe(op.targetGenerationId);
  await expect(f.api.rollbackDatabaseMigration(f.actor,f.serviceId,op.id,{expectedRevision:(await f.load()).revision})).rejects.toThrow();
 });
 test('rollback waits for its own Job, retires candidate, reverts binding before barrier withdrawal and preserves source traffic',async()=>{
  f=await databaseMigrationFixture();const op=await f.verified();await f.api.rollbackDatabaseMigration(f.actor,f.serviceId,op.id,{expectedRevision:op.revision});await f.tick();const rolling=await f.load();expect(rolling.currentAttempt?.purpose).toBe('database-migration-rollback');await f.tick();expect((await f.load()).error).toBeNull();expect(f.state.binding.generationId).toBe(op.targetGenerationId);
  await f.receipt('rollback');await f.tick();expect((await f.load()).stage).toBe('rolled-back');expect(f.state.binding.generationId).toBe(op.sourceGenerationId);expect(f.state.removed).toContain(op.candidateReleaseId);expect(f.restoreState.withdrawn).toEqual([op.id]);expect(f.restoreState.maintenance).toBe(false);expect((await f.uow.read.slots.get(f.serviceId))?.active).toBe('blue');
 });
 test('cancel a refused rollback retains its failed attempt, then a fresh open confirmation completes the migration',async()=>{
  f=await databaseMigrationFixture();const {ready,failed}=await failedRollback(f);
  // RFC-044 T9：reverse-migration-required 的失败撤回没有回退平台绑定，必须能回到待开放继续完成。
  expect(migrationDto(failed).actions).toEqual(['retry','cancel-rollback']);expect(failed.rollbackRequest).toBeNull();expect(failed.receipts.rollback).toBeUndefined();
  await f.store.save(failed,{...failed,revision:failed.revision+1,observation:{message:'等待观察',at:failed.updatedAt,failures:1}});
  const before=await f.load(),binding={...f.state.binding},slots=await f.uow.read.slots.get(f.serviceId),release=await f.uow.read.releases.getById(before.candidateReleaseId);
  const dto=await f.api.cancelRollbackDatabaseMigration(f.actor,f.serviceId,before.id,{expectedRevision:before.revision}),cancelled=await f.load();
  expect(dto).toMatchObject({stage:'ready-to-open',revision:before.revision+1,error:null,observation:null,actions:['open','rollback']});
  expect(cancelled.currentAttempt).toBeNull();expect(cancelled.previousAttempts).toEqual([...before.previousAttempts,before.currentAttempt!]);
  expect(dto.attempts.at(-1)).toMatchObject({jobId:before.currentAttempt!.jobId,receipt:{state:'failed',failure:'exit'},logTail:'reverse-migration-required'});
  expect(cancelled).toMatchObject({receipts:before.receipts,freeze:before.freeze,approval:before.approval,candidateProof:before.candidateProof});
  expect(f.state.binding).toEqual(binding);expect(await f.uow.read.slots.get(f.serviceId)).toEqual(slots);expect(await f.uow.read.releases.getById(before.candidateReleaseId)).toEqual(release);
  expect(f.state.removed).toEqual([]);expect(f.restoreState.withdrawn).toEqual([]);expect(f.restoreState.maintenance).toBe(true);expect(f.state.opened).toBe(false);
  expect(dto.confirmationDigest).toMatch(/^[a-f0-9]{64}$/);expect(dto.confirmationDigest).not.toBe(migrationDto(ready).confirmationDigest);
  await expect(f.api.openDatabaseMigration(f.actor,f.serviceId,dto.id,{expectedRevision:dto.revision,confirmationDigest:migrationDto(ready).confirmationDigest!})).rejects.toMatchObject({details:{code:'database_migration_confirmation_mismatch'}});
  await f.api.openDatabaseMigration(f.actor,f.serviceId,dto.id,{expectedRevision:dto.revision,confirmationDigest:dto.confirmationDigest!});await f.tick();await f.handoff();await f.until('completing');await f.tick();await f.receipt('complete');await f.tick();
  const completed=await f.load();expect(completed.stage).toBe('completed');expect(completed.previousAttempts).toContainEqual(before.currentAttempt!);expect(f.state.finished).toBe(true);expect(f.restoreState.maintenance).toBe(false);expect(f.state.binding.generationId).toBe(ready.targetGenerationId);expect((await f.uow.read.slots.get(f.serviceId))?.active).toBe(ready.targetSlot);
 });
 for(const reason of ['binding-reverted','binding-owner-changed','candidate-replaced','rollback-requested','stale-revision'] as const)test(`cancel-rollback refuses ${reason} without changing the persisted operation`,async()=>{
  f=await databaseMigrationFixture();const {failed}=await failedRollback(f);
  if(reason==='binding-reverted')f.state.binding.generationId=failed.sourceGenerationId;
  if(reason==='binding-owner-changed')f.state.binding.migrationOperationId=Bun.randomUUIDv7();
  if(reason==='candidate-replaced')await f.uow.run(async scope=>{const slots=(await scope.slots.get(f!.serviceId))!;await scope.slots.save({...slots,[failed.targetSlot]:{...slots[failed.targetSlot],releaseId:f!.target.id}});});
  if(reason==='rollback-requested')await f.store.save(failed,{...failed,revision:failed.revision+1,rollbackRequest:'application-rollback-request'});
  const before=await f.load(),binding={...f.state.binding};
  const expected=reason==='stale-revision'?{kind:'conflict',details:{code:'stale_revision'}}:reason==='rollback-requested'?{kind:'conflict',details:{code:'database_migration_invalid_stage'}}:{kind:'conflict',message:reason==='candidate-replaced'?'候选版本已不在目标部署槽，不能取消撤回':'生产数据库已不再绑定本次迁移的目标世代，不能取消撤回'};
  await expect(f.api.cancelRollbackDatabaseMigration(f.actor,f.serviceId,before.id,{expectedRevision:before.revision-(reason==='stale-revision'?1:0)})).rejects.toMatchObject(expected);
  expect(await f.load()).toEqual(before);expect(f.state.binding).toEqual(binding);expect(f.state.removed).toEqual([]);expect(f.restoreState.withdrawn).toEqual([]);expect(f.restoreState.maintenance).toBe(true);
 });
 test('abandon waits for any existing Job and frees its retained databases; transient observations cold-retry without changing immutable input',async()=>{
  f=await databaseMigrationFixture();await f.api.createDatabaseMigration(f.actor,f.serviceId,f.input);const reserve=f.deps.data.databaseGenerations!.reserveMigration!;let once=true;
  f.deps.data.databaseGenerations!.reserveMigration=async input=>{await reserve(input);if(once){once=false;throw new Error('lost reserve reply');}return {} as never;};await f.tick();expect((await f.load()).observation).not.toBeNull();expect((await f.load()).error).toBeNull();await f.until('planning');await f.tick();let op=await f.load();const box=op.environmentBox;
  f.restoreState.proofs.set(op.currentAttempt!.jobId,f.proof(op,undefined,'exit'));await f.tick();op=await f.load();expect(op.error).toContain('exit');await f.api.abandonDatabaseMigration(f.actor,f.serviceId,op.id,{expectedRevision:op.revision});await f.tick();expect((await f.load()).stage).toBe('abandoned');expect((await f.load()).environmentBox).toBe(box);expect(f.state.finished).toBe(true);expect(f.state.binding.generationId).toBe(op.sourceGenerationId);
 });
 for(const failure of ['exit','deadline-exceeded','job-lost','pod-missing','receipt-invalid','receipt-mismatch'] as const)test(`retry retains failed ${failure} attempt and uses a new Job with the same target and frozen environment`,async()=>{
  f=await databaseMigrationFixture();let op=await f.frozen();f.restoreState.proofs.set(op.currentAttempt!.jobId,f.proof(op,undefined,failure));await f.tick();const failed=await f.load();await f.api.retryDatabaseMigration(f.actor,f.serviceId,op.id,{expectedRevision:failed.revision});op=await f.load();expect(op.currentAttempt!.jobId).not.toBe(failed.currentAttempt!.jobId);expect(op.previousAttempts.at(-1)?.proof?.receipt.failure).toBe(failure);expect(op.environmentBox).toBe(failed.environmentBox);expect(op.freeze).toEqual(failed.freeze);expect(op.approval).toEqual(failed.approval);expect(op.targetGenerationId).toBe(failed.targetGenerationId);
 });
 test('CAS, immutable input and append-only history are enforced by PostgreSQL; concurrent artifact writes are write-once',async()=>{
  f=await databaseMigrationFixture();const op=await f.planned(),next={...op,revision:op.revision+1,observation:{message:'observe',at:op.updatedAt,failures:1}};
  const results=await Promise.allSettled([f.store.save(op,next),f.store.save(op,next)]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const value=await f.load();await expect(f.store.save(value,{...value,revision:value.revision+1,commitSha:'f'.repeat(40)})).rejects.toThrow();await expect(f.store.save(value,{...value,revision:value.revision+1,environmentBox:'changed'})).rejects.toThrow();
  const bytes=Buffer.from('binary\0artifact'),digest='sha256:'+new Bun.CryptoHasher('sha256').update(bytes).digest('hex');const writes=await Promise.all([f.store.writeArtifact(op.id,'binary',digest,bytes.toString('base64')),f.store.writeArtifact(op.id,'binary',digest,bytes.toString('base64'))]);expect(writes[0]).toEqual(writes[1]);expect(await f.store.artifact(op.id,'binary')).toEqual({digest,bytes:bytes.toString('base64')});
  await expect(Promise.resolve(f.database.db.execute(sql`UPDATE release.database_migration_artifacts SET bytes='x'::bytea,size=1 WHERE operation_id=${op.id}`))).rejects.toThrow();
 });
 test('failed build retries a fresh ledger Job while preserving candidate release, tag and commit',async()=>{
  f=await databaseMigrationFixture();f.state.buildFailed=true;await f.api.createDatabaseMigration(f.actor,f.serviceId,f.input);for(let i=0;i<7;i++)await f.tick();let op=await f.load();expect(op.error).toContain('构建失败');const first=(await f.uow.read.releases.getById(op.candidateReleaseId))!;
  f.state.buildFailed=false;await f.api.retryDatabaseMigration(f.actor,f.serviceId,op.id,{expectedRevision:op.revision});await f.until('planning');op=await f.load();const release=(await f.uow.read.releases.getById(op.candidateReleaseId))!;expect(release.id).toBe(first.id);expect(release.tag).toBe(first.tag);expect(release.commitSha).toBe(first.commitSha);expect(release.pipeline.buildJobId).not.toBe(first.id);expect(release.pipeline.previousBuildJobIds).toEqual([first.id]);
  const {slotOwnerUseCases}=await import('../application/slotOwners');expect(await slotOwnerUseCases(f.deps).jobEnvValues({releaseId:release.pipeline.buildJobId!,purpose:'build',recordId:release.pipeline.buildJobId!})).toEqual({GIT_TOKEN:'build-token'});
  await expect(slotOwnerUseCases(f.deps).jobEnvValues({releaseId:first.id,purpose:'build',recordId:first.id})).rejects.toThrow('尝试已变化');
 });

 test('unblocked run reapproval archives the old attempt and resumes on the same freeze and target',async()=>{
  f=await databaseMigrationFixture();const before=await f.frozen();await f.plan([],true);let op=await f.load();expect(op.stage).toBe('awaiting-reapproval');await f.api.approveDatabaseMigration(f.actor,f.serviceId,op.id,{expectedRevision:op.revision,approvalDigest:op.plan!.plan.approvalDigest});await f.tick();op=await f.load();expect(op.stage).toBe('migrating');expect(op.freeze).toEqual(before.freeze);expect(op.targetGenerationId).toBe(before.targetGenerationId);expect(op.previousAttempts.some(a=>a.jobId===before.currentAttempt!.jobId)).toBe(true);expect(op.currentAttempt!.jobId).not.toBe(before.currentAttempt!.jobId);
 });
 test('abandon after durable attempt allocation but before declaration releases the reservation without launching the Job',async()=>{
  f=await databaseMigrationFixture();await f.api.createDatabaseMigration(f.actor,f.serviceId,f.input);await f.until('planning');const declare=f.deps.uow.read.ledger!.job;f.deps.uow.read.ledger!.job=async()=>{throw new Error('before declaration');};await f.tick();let op=await f.load();expect(op.currentAttempt).not.toBeNull();f.deps.uow.read.ledger!.job=declare;await f.api.abandonDatabaseMigration(f.actor,f.serviceId,op.id,{expectedRevision:op.revision});await f.tick();await f.tick();op=await f.load();expect(op.stage).toBe('abandoned');expect(f.declared.filter(j=>j.kind==='migration-job')).toHaveLength(0);expect(f.state.finished).toBe(true);
 });

});
