import { testDatabaseAvailable } from '@crewstation/testkit';
import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { runMigrations } from '@crewstation/persistence';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { ProjectDeletionTargetSchema, PROJECT_DELETION_PHASES, type ProjectDeletionContext, type ProjectDeletionEvidence, type RuntimeImageSource } from '@crewstation/contracts';
import { runtimeImageFixture, type RuntimeImageFixture } from './runtimeImageFixture';
import { builtVersion } from './versionFixture';
import { createRuntimeEnvironmentModule, runtimeEnvironmentMigrations } from '../wiring';
import { runtimeImageDeletionRepository } from '../adapters/persistence/projectDeletion';
import { runtimeImageProjectDeletionOwner } from '../application/projectDeletion';
import { runtimeImageProjectAdmissions } from '../adapters/persistence/unitOfWork';
import { runtimeImageCallbackReceipt, runtimeImagePhysicalOrigins } from '../domain/records';
import { RUNTIME_IMAGE_PHYSICAL_KINDS, type RuntimeImageDeletionPhysics, type RuntimeImagePhysicalScope } from '../ports/projectDeletion';

async function previousFixture() {
  const previous = { ...runtimeEnvironmentMigrations, files: runtimeEnvironmentMigrations.files.filter((file) => file.name < '0007') };
  return runtimeImageFixture(undefined, undefined, undefined, undefined, undefined, undefined, previous);
}
const fixtures: RuntimeImageFixture[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.tdb.drop(); });
const processIdentity = { podUid: '91754092-388a-4131-a452-f9d4b75f0766', nodeUid: '8acdd9b0-3dd8-4a8a-afdf-a1d90a17cf1a', nodeName: 'original-node', containerId: 'containerd://' + 'a'.repeat(64) };
async function setup() {
  const f = await runtimeImageFixture(); fixtures.push(f);
  const target = ProjectDeletionTargetSchema.parse({ id: f.project, slug: 'demo', name: 'Demo', namespace: 'cs-demo', kind: 'DigitalWorker', state: 'active', revision: '1', prodHost: 'demo.cs.localhost', previewHost: 'preview.demo.cs.localhost', serviceHost: 'demo' });
  const operationId = newResourceId(), controls = { independent: true, closed: true, stopped: true, native: 0, storage: 0, proofs: 0, grants: true, generation: 1 };
  const assertGrant = async (context: ProjectDeletionContext) => { if (context.operationId !== operationId || !controls.grants) throw new Error('wrong grant'); if(context.generation!==controls.generation)throw new Error('当前租约世代已失效'); };
  const repository = runtimeImageDeletionRepository({ db: f.tdb.db, assertGrant });
  const proof = async (scope: RuntimeImagePhysicalScope) => {
    controls.proofs++;
    const callbacks = (await repository.retained(target))!.content.callbacks;
    return { kind: 'done' as const, digest: jsonHash({ fixedScope: scope, native: controls.native, storage: controls.storage }), scopeDigest: jsonHash(scope), sourceIdentity: scope.source.identity,
      independent: controls.independent, producersClosed: controls.closed, consumersStopped: controls.stopped, nativeRemaining: controls.native, storageRemaining: controls.storage,
      callbackExits: callbacks.map((entry) => ({ id: entry.id, originalIdentity: runtimeImageCallbackReceipt(entry), digest: jsonHash({ stopped: entry.id }) })) };
  };
  const physics: RuntimeImageDeletionPhysics = {
    capture: async (_target, content) => ({ complete: true, blockers: [], references: [], scope: { version: 1, projectId: f.project, originDigest: runtimeImagePhysicalOrigins(f.project, content.inventory.resources, content.callbacks),
      source: { identity: jsonHash('fixed-source'), epoch: jsonHash('fixed-epoch'), version: 'controlled-test-port' },
      objects: content.callbacks.map((entry) => ({ kind: 'callback', id: entry.id, identity: runtimeImageCallbackReceipt(entry), sourceIdentity: jsonHash(entry.process), count: 1, consumerId: entry.id, consumerIdentity: runtimeImageCallbackReceipt(entry) })),
      coverage: RUNTIME_IMAGE_PHYSICAL_KINDS.map((kind) => ({ kind, identity: jsonHash({ complete: kind }), complete: true })) } }),
    inspect: async () => ({ complete: true, blockers: [], references: [] }), stop: async (_context, scope) => proof(scope), purge: async (_context, scope) => proof(scope), prove: proof,
  };
  const owner = runtimeImageProjectDeletionOwner({ repository, physics, assertGrant });
  const admissions = runtimeImageProjectAdmissions({ db: f.tdb.db, protectCurrent: async () => processIdentity, assertAvailable: async () => undefined });
  const context = (confirmed: Awaited<ReturnType<typeof owner.inspect>>, phase: ProjectDeletionContext['phase'], generation = 1) => ({ operationId, target, confirmed, phase, generation });
  const receipt = newResourceId(), otherReceipt = newResourceId();
  await f.tdb.db.execute(sql`INSERT INTO runtime_environment.allocation_receipts VALUES(${receipt},${f.project},'{"private":"owned"}'::jsonb),(${otherReceipt},${f.otherProject},'{"private":"foreign"}'::jsonb)`);
  return { f, target, repository, owner, physics, assertGrant, controls, admissions, context, receipt, otherReceipt };
}

const available = await testDatabaseAvailable();
describe.skipIf(!available)('运行镜像项目删除原范围与阶段', () => {

test('持久七阶段实际清内容且可重建工厂重放；共享回调仅移除当前归属，外项目和原退出身份保留', async () => {
  const x = await setup();
  await x.admissions.run([x.f.project,x.f.otherProject], {kind:'source',id:newResourceId(),inputDigest:jsonHash('input')}, async () => undefined);
  const before = (await x.repository.content(x.target)).callbacks[0]!;
  const confirmed = await x.owner.inspect(x.target); expect(confirmed.complete).toBe(true);
  for (const phase of PROJECT_DELETION_PHASES) expect((await x.owner.run(x.context(confirmed,phase))).kind).toBe('done');
  expect((await x.repository.content(x.target)).rows).toHaveLength(0);
  const foreign = await x.f.uow.read.projectContent(x.f.otherProject);
  expect(foreign.rows.filter((entry)=>entry.table==='allocation_receipts')).toHaveLength(1);
  expect(foreign.callbacks).toHaveLength(1);
  expect(foreign.callbacks[0]!.projectIds).toEqual([x.f.otherProject]);
  expect(foreign.callbacks[0]!.originalProjectIds).toEqual(before.originalProjectIds);
  expect(foreign.callbacks[0]!.exitDigest).toBe(before.exitDigest);
  expect(foreign.inventory.complete).toBe(true);
  const stored = await x.repository.load(x.context(confirmed,'verify'));
  expect(stored.phaseIndex).toBe(6); expect(Object.keys(stored.receipts)).toHaveLength(7);
  const replay = await x.owner.run(x.context(confirmed,'metadata'));
  expect(replay).toEqual({kind:'done',evidence:stored.receipts.metadata!});
  await expect(x.f.uow.run(async(s)=>{await s.allocationReceipts.save(x.f.project,newResourceId(),{} as never);})).rejects.toMatchObject({cause:{code:'55000'}});
});

test('缺阶段、错误世代和许可均拒绝；连接或租约的零记录不代替独立停止证明', async () => {
  const x = await setup(), confirmed = await x.owner.inspect(x.target);
  await x.owner.run(x.context(confirmed,'seal'));
  await expect(x.owner.run(x.context(confirmed,'purge'))).rejects.toThrow('前一阶段');
  await expect(x.owner.run(x.context(confirmed,'stop',2))).rejects.toThrow('世代');
  x.controls.independent=false; expect((await x.owner.run(x.context(confirmed,'stop'))).kind).toBe('blocked');
  x.controls.independent=true; x.controls.native=1; expect((await x.owner.run(x.context(confirmed,'stop'))).kind).toBe('waiting');
  x.controls.native=0; x.controls.grants=false; await expect(x.owner.run(x.context(confirmed,'stop'))).rejects.toThrow('wrong grant'); x.controls.grants=true;
  expect((await x.repository.load(x.context(confirmed,'stop'))).phaseIndex).toBe(0);
});

test('确认后新增内容会永久封写并要求新世代确认，沿固定物理身份恢复', async () => {
  const x = await setup(), old = await x.owner.inspect(x.target);
  await x.f.tdb.db.execute(sql`INSERT INTO runtime_environment.allocation_receipts VALUES(${newResourceId()},${x.f.project},'{"new":"content"}'::jsonb)`);
  expect((await x.owner.run(x.context(old,'seal'))).kind).toBe('blocked');
  await expect(x.f.tdb.db.transaction(async(tx)=>{await tx.execute(sql`INSERT INTO runtime_environment.allocation_receipts VALUES(${newResourceId()},${x.f.project},'{}'::jsonb)`);})).rejects.toMatchObject({cause:{code:'55000'}});
  const next = await x.owner.inspect(x.target); expect(next.revision).not.toBe(old.revision);
  x.controls.generation=2; for (const phase of PROJECT_DELETION_PHASES) expect((await x.owner.run(x.context(next,phase,2))).kind).toBe('done');
  expect((await x.repository.content(x.target)).rows).toHaveLength(0);
});

test('最终 verify 重放仍独立复核，不能拿旧成功回执掩盖原生资源重新出现', async () => {
  const x = await setup(), confirmed = await x.owner.inspect(x.target);
  for (const phase of PROJECT_DELETION_PHASES) await x.owner.run(x.context(confirmed,phase));
  const before=x.controls.proofs; x.controls.native=1;
  expect((await x.owner.run(x.context(confirmed,'verify'))).kind).toBe('waiting');
  expect(x.controls.proofs).toBe(before+1);
});

test('恢复回调必须逐项核对当前行的原进程，原ID下替换 backend 不能套用旧停止证明', async () => {
  const x = await setup();
  await x.admissions.run([x.f.project],{kind:'source',id:newResourceId(),inputDigest:jsonHash('input')},async()=>undefined);
  // Simulate a legacy unfinished record, rather than permitting ordinary writers to roll back actual exit.
  await x.f.tdb.db.execute(sql`ALTER TABLE runtime_environment.deletion_callbacks DISABLE TRIGGER runtime_project_callback_guard`);
  await x.f.tdb.db.execute(sql`UPDATE runtime_environment.deletion_callbacks SET exited_at=NULL,exit_digest=NULL`);
  await x.f.tdb.db.execute(sql`ALTER TABLE runtime_environment.deletion_callbacks ENABLE TRIGGER runtime_project_callback_guard`);
  const confirmed=await x.owner.inspect(x.target); await x.owner.run(x.context(confirmed,'seal'));
  await x.f.tdb.db.execute(sql`ALTER TABLE runtime_environment.deletion_callbacks DISABLE TRIGGER runtime_project_callback_guard`);
  await x.f.tdb.db.execute(sql`UPDATE runtime_environment.deletion_callbacks SET backend_pid=backend_pid+1`);
  await x.f.tdb.db.execute(sql`ALTER TABLE runtime_environment.deletion_callbacks ENABLE TRIGGER runtime_project_callback_guard`);
  await expect(x.owner.run(x.context(confirmed,'stop'))).rejects.toThrow('原');
  expect((await x.f.tdb.db.execute(sql`SELECT exited_at FROM runtime_environment.deletion_callbacks`))[0]!.exited_at).toBeNull();
});

test('两千条内容全部在原范围内，metadata 全量清理并保留外项目', async () => {
  const x = await setup();
  await x.f.tdb.db.execute(sql`INSERT INTO runtime_environment.allocation_receipts(operation_id,project_id,payload) SELECT gen_random_uuid()::text,${x.f.project},jsonb_build_object('private','value-'||n) FROM generate_series(1,2001) n`);
  const confirmed=await x.owner.inspect(x.target); expect(confirmed.complete).toBe(true);
  expect(confirmed.resources.find((r)=>r.kind==='runtime-image:allocation_receipts')!.count).toBe(2002);
  for(const phase of PROJECT_DELETION_PHASES) expect((await x.owner.run(x.context(confirmed,phase))).kind).toBe('done');
  expect(await x.f.tdb.db.execute(sql`SELECT operation_id FROM runtime_environment.allocation_receipts`)).toHaveLength(1);
});

test('模块默认不提供删除入口；持久 owner 必须同时装配回调准入和独立物理端口', async () => {
  const x=await setup(); expect(x.f.api.deletionOwner).toBeUndefined();
  const deps = {db:x.f.tdb.db,limits:x.f.limits,isAdmin:async()=>true,authorizer:{authorize:async()=>undefined},validationContracts:{fingerprint:async()=>jsonHash('contract')},
    sources:{prepare:async(_actor:unknown,_project:unknown,source:RuntimeImageSource)=>({source})},buildExecutor:{reconcile:async()=>{throw new Error('no native calls');},inspect:async()=>{throw new Error('no native calls');}},deletion:{physics:x.physics,assertGrant:x.assertGrant}};
  expect(()=>createRuntimeEnvironmentModule(deps)).toThrow('原回调准入');
  const mod=createRuntimeEnvironmentModule({...deps,projectAdmission:{protectCurrent:async()=>processIdentity,assertAvailable:async()=>undefined}});
  const confirmed=await mod.api.deletionOwner!.inspect(x.target);
  for(const phase of PROJECT_DELETION_PHASES) expect((await mod.api.deletionOwner!.run(x.context(confirmed,phase))).kind).toBe('done');
  expect((await x.repository.content(x.target)).rows).toHaveLength(0);
});

test('原回调退出经独立原身份恢复，journal 与其他内容最终清理且回执可重放', async () => {
  const x=await setup();
  await x.admissions.run([x.f.project],{kind:'source',id:newResourceId(),inputDigest:jsonHash('input')},async()=>undefined);
  await x.f.tdb.db.execute(sql`ALTER TABLE runtime_environment.deletion_callbacks DISABLE TRIGGER runtime_project_callback_guard`);
  await x.f.tdb.db.execute(sql`UPDATE runtime_environment.deletion_callbacks SET exited_at=NULL,exit_digest=NULL`);
  await x.f.tdb.db.execute(sql`ALTER TABLE runtime_environment.deletion_callbacks ENABLE TRIGGER runtime_project_callback_guard`);
  const confirmed=await x.owner.inspect(x.target);
  await x.owner.run(x.context(confirmed,'seal')); expect((await x.owner.run(x.context(confirmed,'stop'))).kind).toBe('done');
  const stopped=await x.repository.content(x.target); expect(stopped.callbacks[0]!.exited).toBe(true); expect(stopped.callbacks[0]!.recoveryDigest).toMatch(/^[a-f0-9]{64}$/); expect(stopped.inventory.complete).toBe(true);
  for(const phase of PROJECT_DELETION_PHASES.slice(2)) expect((await x.owner.run(x.context(confirmed,phase))).kind).toBe('done');
  expect((await x.repository.content(x.target)).rows).toHaveLength(0);
  expect(await x.f.tdb.db.execute(sql`SELECT id FROM runtime_environment.deletion_callbacks`)).toHaveLength(0);
});

test('metadata 后半段失败会原子回滚前面所有删除与实体墓碑，重试沿同范围继续', async () => {
  const x=await setup();
  await x.f.uow.run(async(s)=>{await s.developmentPolicies.save({projectId:x.f.project,revision:1,developmentTask:{},developmentAgents:[]});});
  const confirmed=await x.owner.inspect(x.target);
  for(const phase of PROJECT_DELETION_PHASES.slice(0,5)) await x.owner.run(x.context(confirmed,phase));
  await x.f.tdb.db.execute(sql`CREATE FUNCTION runtime_environment.test_reject_purge() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected metadata failure'; END $$`);
  await x.f.tdb.db.execute(sql`CREATE TRIGGER test_reject_purge BEFORE DELETE ON runtime_environment.allocation_receipts FOR EACH ROW EXECUTE FUNCTION runtime_environment.test_reject_purge()`);
  await expect(x.owner.run(x.context(confirmed,'metadata'))).rejects.toMatchObject({cause:{message:'injected metadata failure'}});
  expect((await x.repository.content(x.target)).rows).toHaveLength(2);
  expect(await x.f.tdb.db.execute(sql`SELECT kind FROM runtime_environment.deletion_entities`)).toHaveLength(0);
  expect((await x.repository.load(x.context(confirmed,'metadata'))).receipts.metadata).toBeUndefined();
  await x.f.tdb.db.execute(sql`DROP TRIGGER test_reject_purge ON runtime_environment.allocation_receipts`);
  expect((await x.owner.run(x.context(confirmed,'metadata'))).kind).toBe('done');
  expect((await x.owner.run(x.context(confirmed,'verify'))).kind).toBe('done');
});

test('原生来源缺失或类别不完整时连空项目也不能封闭为已验证范围', async () => {
  const x=await setup(), missing=runtimeImageProjectDeletionOwner({repository:x.repository,assertGrant:x.assertGrant,physics:{...x.physics,capture:async()=>({complete:false,blockers:[],references:[],scope:null})}});
  const incomplete=await missing.inspect(x.target); expect(incomplete.complete).toBe(false); expect(incomplete.blockers[0]!.code).toBe('runtime-image-native-source-missing');
  await expect(missing.run(x.context(incomplete,'seal'))).rejects.toThrow('完整确认');
  const partial=runtimeImageProjectDeletionOwner({repository:x.repository,assertGrant:x.assertGrant,physics:{...x.physics,capture:async(target,content)=>{
    const capture=await x.physics.capture(target,content); return {...capture,scope:{...capture.scope!,coverage:capture.scope!.coverage.filter((entry)=>entry.kind!=='artifact')}};
  }}});
  await expect(partial.inspect(x.target)).rejects.toThrow('范围不完整');
});

test('平台构建纳入来源项目全量私有内容，版本通过最小沿革继续保留', async () => {
  const x=await setup(), version=await builtVersion(x.f);
  await x.f.tdb.db.execute(sql`INSERT INTO runtime_environment.build_logs(build_id,stage,text,created_at) SELECT ${version.buildId},'build','private-source-content-'||n,now() FROM generate_series(1,2001) n`);
  const content=await x.repository.content(x.target);
  expect(content.rows.filter((entry)=>entry.table==='builds')).toHaveLength(1);
  expect(content.rows.filter((entry)=>entry.table==='build_logs')).toHaveLength(2001);
  expect(content.inventory.references).toHaveLength(0);
  expect(content.inventory.complete).toBe(true); expect(JSON.stringify(content)).not.toContain('private-source-content-');
  const foreign=await x.f.uow.read.projectContent(x.f.otherProject);
  expect(foreign.rows).toHaveLength(1); expect(foreign.rows[0]!.table).toBe('allocation_receipts');
});

test('已发布版本移交最小沿革后真实清理原构建、日志、凭据和执行字段，保留其他项目的版本引用', async () => {
  const x=await setup(),version=await builtVersion(x.f),marker='private-build-output';
  await x.f.tdb.db.execute(sql`UPDATE runtime_environment.builds SET payload=payload||jsonb_build_object('pendingOutcome',jsonb_build_object('error',${marker}::text),'gitCredentialIds',jsonb_build_array(${newResourceId()}::text)) WHERE id=${version.buildId}`);
  await x.f.tdb.db.execute(sql`INSERT INTO runtime_environment.build_logs(build_id,stage,text,created_at) SELECT ${version.buildId},'build',${marker},now() FROM generate_series(1,2001) n`);
  await x.f.api.shareImage(x.f.admin,x.f.project,version.imageId,'shared',1);
  const reference=await x.f.api.startValidation(x.f.developer,x.f.otherProject,version.id,{requestKey:'foreign-version-reference',target:{usage:'task'}});
  const physics:RuntimeImageDeletionPhysics={...x.physics,capture:async(target,content)=>{
    const capture=await x.physics.capture(target,content);
    return {...capture,scope:{...capture.scope!,objects:[...capture.scope!.objects,...content.inventory.resources.filter((entry)=>entry.scope==='physical').map((entry)=>({
      kind:entry.kind==='runtime-image:build'?'builder' as const:'validation' as const,id:'original-native:'+entry.id,identity:jsonHash({native:entry.id,birth:1}),sourceIdentity:jsonHash('independent-source'),count:1,consumerId:entry.id,consumerIdentity:entry.sourceIdentity??entry.identity,
    }))]}};
  }};
  const owner=runtimeImageProjectDeletionOwner({repository:x.repository,assertGrant:x.assertGrant,physics}),confirmed=await owner.inspect(x.target);expect(confirmed.complete).toBe(true);
  for(const phase of PROJECT_DELETION_PHASES) expect((await owner.run(x.context(confirmed,phase))).kind).toBe('done');
  expect(await x.f.uow.read.builds.get(version.buildId)).toBeUndefined();expect(await x.f.uow.read.logs.bytes(version.buildId)).toBe(0);
  expect(await x.f.uow.read.versions.get(version.id)).toEqual(version);
  const minimum=await x.f.tdb.db.execute(sql`SELECT * FROM runtime_environment.build_provenance WHERE id=${version.buildId}`);
  expect(minimum).toHaveLength(1);expect(minimum[0]).toEqual({id:version.buildId,image_id:version.imageId,revision_id:version.revisionId});
  expect(JSON.stringify(minimum)).not.toContain(marker);expect(await x.f.uow.read.validations.get(reference.id)).toBeDefined();
  expect((await x.repository.content(x.target)).rows).toHaveLength(0);
  await expect(x.f.tdb.db.transaction(async(tx)=>{await tx.execute(sql`UPDATE runtime_environment.build_provenance SET revision_id=${newResourceId()} WHERE id=${version.buildId}`);})).rejects.toMatchObject({cause:{code:'55000'}});
  await expect(x.f.tdb.db.transaction(async(tx)=>{await tx.execute(sql`DELETE FROM runtime_environment.build_provenance WHERE id=${version.buildId}`);})).rejects.toMatchObject({cause:{code:'55000'}});
  await expect(x.f.tdb.db.transaction(async(tx)=>{await tx.execute(sql`TRUNCATE runtime_environment.build_provenance CASCADE`);})).rejects.toMatchObject({cause:{code:'55000'}});
});

test('既有平台版本沿革回填依据原构建和配方，内容私有字段不进入最小记录',async()=>{
  const f=await previousFixture();fixtures.push(f);const version=await builtVersion(f);
  expect(await runMigrations(f.tdb.db, [runtimeEnvironmentMigrations])).toEqual(['runtime-environment/0007_project_deletion.sql','runtime-environment/0008_native_registry_admission.sql']);
  const minimum=await f.tdb.db.execute(sql`SELECT * FROM runtime_environment.build_provenance`);
  expect(minimum).toHaveLength(1);expect(minimum[0]).toEqual({id:version.buildId,image_id:version.imageId,revision_id:version.revisionId});
  expect((await f.uow.read.projectContent(f.project)).inventory).toMatchObject({complete:true,blockers:[],references:[]});
  expect(await runMigrations(f.tdb.db, [runtimeEnvironmentMigrations])).toEqual([]);
});

test('既有版本错绑原构建配方会拒绝迁移，不能把错误当前指针当成原沿革',async()=>{
  const f=await previousFixture();fixtures.push(f);const version=await builtVersion(f),other=await f.revision(version.imageId);
  await f.tdb.db.execute(sql`UPDATE runtime_environment.versions SET payload=payload||jsonb_build_object('revisionId',${other.id}::text) WHERE id=${version.id}`);
  await expect(runMigrations(f.tdb.db, [runtimeEnvironmentMigrations])).rejects.toMatchObject({cause:{code:'55000',message:'Runtime image stored version provenance mismatches original build'}});
  expect((await f.uow.read.versions.get(version.id))!.revisionId).toBe(other.id);
  expect((await f.tdb.db.execute(sql`SELECT to_regclass('runtime_environment.build_provenance') AS relation`))[0]!.relation).toBeNull();
});

test('独立来源只报类别已覆盖但漏掉已知原 builder 对象时拒绝完整证明', async () => {
  const x=await setup(), image=await x.f.image(), revision=await x.f.revision(image.id);
  await x.f.api.startBuild(x.f.admin,x.f.project,image.id,{revisionId:revision.id,requestKey:'known-builder'});
  await expect(x.owner.inspect(x.target)).rejects.toThrow('原消费者');
});

test('原生对象与已知原 builder 输入逐项绑定后可清理未发布构建、全部日志和私有请求，保留平台配方', async () => {
  const x=await setup(), image=await x.f.image(), revision=await x.f.revision(image.id), build=await x.f.api.startBuild(x.f.admin,x.f.project,image.id,{revisionId:revision.id,requestKey:'unpublished-builder'});
  const marker='private-original-request-key';
  await x.f.tdb.db.execute(sql`INSERT INTO runtime_environment.build_logs(build_id,stage,text,created_at) SELECT ${build.id},'build','private-build-'||n,now() FROM generate_series(1,2001) n`);
  await x.f.tdb.db.execute(sql`INSERT INTO runtime_environment.creation_requests VALUES(${x.f.project},${x.f.admin.userId},${marker},${jsonHash(marker)},${image.id},${revision.id})`);
  const physics:RuntimeImageDeletionPhysics={...x.physics,capture:async(target,content)=>{
    const capture=await x.physics.capture(target,content);
    return {...capture,scope:{...capture.scope!,objects:[...capture.scope!.objects,...content.inventory.resources.filter((entry)=>entry.scope==='physical').map((entry)=>({
      kind:entry.kind==='runtime-image:build'?'builder' as const:'validation' as const,id:'original-native:'+entry.id,identity:jsonHash({native:entry.id,birth:1}),sourceIdentity:jsonHash('independent-source'),count:1,consumerId:entry.id,consumerIdentity:entry.sourceIdentity??entry.identity,
    }))]}};
  }};
  const owner=runtimeImageProjectDeletionOwner({repository:x.repository,assertGrant:x.assertGrant,physics}), confirmed=await owner.inspect(x.target);
  expect(confirmed.complete).toBe(true);
  for(const phase of PROJECT_DELETION_PHASES) expect((await owner.run(x.context(confirmed,phase))).kind).toBe('done');
  expect(await x.f.uow.read.builds.get(build.id)).toBeUndefined(); expect(await x.f.uow.read.logs.bytes(build.id)).toBe(0);
  expect(await x.f.uow.read.images.get(image.id)).toBeDefined(); expect(await x.f.uow.read.revisions.get(revision.id)).toEqual(revision);
  expect(await x.f.tdb.db.execute(sql`SELECT request_scope FROM runtime_environment.creation_requests`)).toHaveLength(0);
  const keys=await x.f.tdb.db.execute<{entity_key:string}>(sql`SELECT entity_key FROM runtime_environment.deletion_entities WHERE kind='creation_requests'`);
  expect(keys).toHaveLength(1); expect(keys[0]!.entity_key).toMatch(/^[a-f0-9]{64}$/); expect(JSON.stringify(keys)).not.toContain(marker);
  await expect(x.f.tdb.db.transaction(async(tx)=>{await tx.execute(sql`INSERT INTO runtime_environment.creation_requests VALUES(${x.f.project},${x.f.admin.userId},${marker},${jsonHash(marker)},${image.id},${revision.id})`);})).rejects.toMatchObject({cause:{code:'55000'}});
});

test('确认摘要包含原生对象与原输入的绑定；同一批原生 ID 被重新映射后必须重新确认', async () => {
  const x=await setup(), image=await x.f.image(), revision=await x.f.revision(image.id);
  for(const requestKey of ['first','second']) await x.f.api.startBuild(x.f.admin,x.f.project,image.id,{revisionId:revision.id,requestKey});
  let remapped=false;
  const physics:RuntimeImageDeletionPhysics={...x.physics,capture:async(target,content)=>{
    const capture=await x.physics.capture(target,content), consumers=content.inventory.resources.filter((entry)=>entry.scope==='physical');
    return {...capture,scope:{...capture.scope!,objects:consumers.map((native,index)=>{
      const binding=consumers[remapped?consumers.length-1-index:index]!;
      return {kind:'builder' as const,id:'native:'+native.id,identity:jsonHash({birth:native.id}),sourceIdentity:jsonHash('native-source'),count:1,consumerId:binding.id,consumerIdentity:binding.sourceIdentity??binding.identity};
    })}};
  }};
  const owner=runtimeImageProjectDeletionOwner({repository:x.repository,assertGrant:x.assertGrant,physics}), before=await owner.inspect(x.target);
  expect(before.complete).toBe(true); remapped=true;
  expect((await owner.inspect(x.target)).revision).not.toBe(before.revision);
  expect((await owner.run(x.context(before,'seal'))).kind).toBe('blocked');
});

});


test.skipIf(!available)('lease recovery preserves original seal runtime-environment and current grant', async () => {
  const x = await setup(); x.controls.generation = 3;
  const confirmed = await x.owner.inspect(x.target); await x.owner.run(x.context(confirmed, 'seal', 3));
  const sealed = (await x.f.tdb.db.execute<{generation:number;revision:string;original:unknown;receipts:Partial<Record<ProjectDeletionContext['phase'],ProjectDeletionEvidence>>}>(sql`SELECT generation,revision,original,receipts FROM runtime_environment.deletion_fences WHERE project_id=${x.f.project}`))[0]!;
  x.controls.generation = 7;
  const proofCalls = x.controls.proofs;
  await expect(x.owner.run(x.context(confirmed,'stop',3))).rejects.toThrow('世代');
  expect(x.controls.proofs).toBe(proofCalls);
  x.controls.generation = 1;
  await expect(x.owner.run(x.context(confirmed,'stop',1))).rejects.toThrow('世代');
  x.controls.generation = 7;
  await expect(x.owner.run(x.context({...confirmed,revision:'0'.repeat(64)},'stop',7))).rejects.toThrow('修订');
  expect((await x.owner.run(x.context(confirmed,'stop',7))).kind).toBe('done');
  for (const phase of PROJECT_DELETION_PHASES.slice(2)) {
    x.controls.generation++;
    expect((await x.owner.run(x.context(confirmed,phase,x.controls.generation))).kind).toBe('done');
  }
  const final = await x.repository.load(x.context(confirmed,'verify',x.controls.generation));
  expect(final.phaseIndex).toBe(6); expect(Object.keys(final.receipts)).toHaveLength(7);
  expect(final.receipts.seal).toEqual(sealed.receipts.seal);
  const fence = (await x.f.tdb.db.execute<{generation:number;revision:string;original:unknown}>(sql`SELECT generation,revision,original FROM runtime_environment.deletion_fences WHERE project_id=${x.f.project}`))[0]!;
  expect(fence).toEqual({generation:sealed.generation,revision:sealed.revision,original:sealed.original});
  x.controls.generation++;
  expect(await x.owner.run(x.context(confirmed,'metadata',x.controls.generation))).toEqual({kind:'done',evidence:final.receipts.metadata!});
  expect((await x.f.uow.read.projectContent(x.f.otherProject)).rows.some(row=>row.table==='allocation_receipts')).toBe(true);
});
