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
