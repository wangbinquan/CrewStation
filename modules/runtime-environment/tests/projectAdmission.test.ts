import { testDatabaseAvailable } from '@crewstation/testkit';
import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { withExclusiveDatabaseAdmission } from '@crewstation/persistence';
import { newResourceId } from '@crewstation/kernel';
import { CreateRuntimeImageRevisionSchema } from '@crewstation/contracts';
import { runtimeImageFixture, type RuntimeImageFixture } from './runtimeImageFixture';
import { runtimeImageAdmissionKey, runtimeImageProjectAdmissions } from '../adapters/persistence/unitOfWork';
import { builtVersion, passedValidation } from './versionFixture';
import { imageContentDigest } from '../domain/contentDigest';
import { buildExecutorFixture } from './buildExecutorFixture';
import { k8sBuildFixture } from './k8sBuildFixture';
import { runtimeImageBuildSecretValues } from '../application/buildSecretValues';
import { runtimeImageCallbackReceipt } from '../domain/records';
import type { RuntimeImageBuildExecutor } from '../ports/buildExecutor';
import type { RuntimeImageValidationExecutor } from '../ports/validationExecutor';

const fixtures: RuntimeImageFixture[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.tdb.drop(); });
const processIdentity = { podUid: '91754092-388a-4131-a452-f9d4b75f0766', nodeUid: '8acdd9b0-3dd8-4a8a-afdf-a1d90a17cf1a', nodeName: 'original-node', containerId: 'containerd://' + 'a'.repeat(64) };
const deferred = () => Promise.withResolvers<void>();
const one = <T>(rows: readonly T[]): T => { expect(rows).toHaveLength(1); return rows[0]!; };
async function setup(buildExecutor?: RuntimeImageBuildExecutor, validationExecutor?: RuntimeImageValidationExecutor, configured = false) {
  const unavailable = new Set<string>();
  const projectAdmission = { protectCurrent: async () => processIdentity, assertAvailable: async (id: string) => { if (unavailable.has(id)) throw new Error('project deleting'); } };
  const f = await runtimeImageFixture(buildExecutor, undefined, validationExecutor, undefined, undefined, configured ? projectAdmission : undefined); fixtures.push(f);
  const admissions = runtimeImageProjectAdmissions({ db: f.tdb.db, ...projectAdmission });
  return { f, admissions, unavailable };
}
const callback = (id = newResourceId()) => ({ kind: 'source' as const, id, inputDigest: 'b'.repeat(64) });
async function seal(f: RuntimeImageFixture, projectId: string) {
  return withExclusiveDatabaseAdmission(f.tdb.db, runtimeImageAdmissionKey(projectId), async (tx) => {
    const operationId=newResourceId();
    await tx.execute(sql`SELECT set_config('crewstation.runtime_deletion_owner',${operationId+':1:seal'},true)`);
    await tx.execute(sql`INSERT INTO runtime_environment.deletion_fences(project_id,operation_id,generation,revision,original,scope_verified)
      VALUES(${projectId},${operationId},1,${'c'.repeat(64)},${JSON.stringify({target:{projectId}})}::jsonb,false)`);
  });
}

const available = await testDatabaseAvailable();
describe.skipIf(!available)('运行镜像项目删除持久回调准入', () => {

test('原 callback 排空前 seal 等待，但另一项目能写；新原回调与迟到普通写永久拒绝', async () => {
  const { f, admissions } = await setup(), started = deferred(), release = deferred();
  const work = admissions.run([f.project], callback(), async () => { started.resolve(); await release.promise;
    await admissions.check([f.project]); await f.uow.run(async (s) => { await s.developmentPolicies.save({ projectId: f.project, revision: 1, developmentTask: {}, developmentAgents: [] }); }); });
  await started.promise;
  let sealed = false;
  const closing = seal(f, f.project).then(() => { sealed = true; });
  try {
    await f.uow.run(async (s) => { await s.developmentPolicies.save({ projectId: f.otherProject, revision: 1, developmentTask: {}, developmentAgents: [] }); });
    expect(sealed).toBe(false);
  } finally { release.resolve(); await work; await closing; }
  const rows = await f.tdb.db.execute(sql`SELECT original_process,exited_at,exit_digest FROM runtime_environment.deletion_callbacks`);
  expect(rows).toHaveLength(1); expect(rows[0]!.original_process).toEqual(processIdentity); expect(rows[0]!.exited_at).not.toBeNull(); expect(rows[0]!.exit_digest).toMatch(/^[a-f0-9]{64}$/);
  await expect(admissions.run([f.project], callback(), async () => { throw new Error('must not enter'); })).rejects.toThrow('永久封闭');
  await expect(f.uow.run(async (s) => { await s.developmentPolicies.save({ projectId: f.project, revision: 2, developmentTask: {}, developmentAgents: [] }); })).rejects.toMatchObject({ cause: { code: '55000', message: 'Runtime image project admission is permanently sealed' } });
  expect((await f.uow.read.developmentPolicies.get(f.otherProject))?.revision).toBe(1);
});

test('伪造会话变量无法绕过 seal；原版平台目录状态不因配方来源项目删除失去维护能力', async () => {
  const { f } = await setup();
  const version = await builtVersion(f), image = (await f.uow.read.images.get(version.imageId))!, revision = (await f.uow.read.revisions.get(version.revisionId))!;
  await seal(f, f.project);
  await expect(f.tdb.db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('crewstation.shared_admission_pid','1',true),set_config('crewstation.shared_admission_keys',${JSON.stringify([runtimeImageAdmissionKey(f.project)])},true)`);
    await tx.execute(sql`INSERT INTO runtime_environment.allocation_receipts VALUES(${newResourceId()},${f.project},'{}'::jsonb)`);
  })).rejects.toMatchObject({ cause: { code: '55000', message: 'Runtime image project admission is permanently sealed' } });
  await f.uow.run(async (s) => { await s.images.update({ ...image, enabled: false }); });
  expect((await f.uow.read.images.get(image.id))?.enabled).toBe(false);
  await f.uow.run(async (s) => { await s.versions.update({ ...version, state: 'disabled' }); await s.images.update({ ...image, enabled: true }); });
  expect((await f.uow.read.versions.get(version.id))?.state).toBe('disabled');
  await expect(f.api.startBuild(f.admin, f.project, image.id, { revisionId: revision.id, requestKey: 'late' })).rejects.toMatchObject({ cause: { code: '55000', message: 'Runtime image project admission is permanently sealed' } });
});

test('多来源共享准入只准原范围，项目开始删除后心跳拒绝；原异常仍留下实际 finally 退出', async () => {
  const { f, admissions, unavailable } = await setup(), key = callback();
  await expect(admissions.run([f.otherProject,f.project,f.project], key, async () => {
    await admissions.run([f.project], {kind:'initializer',id:newResourceId(),inputDigest:'d'.repeat(64)}, async () => { admissions.assertActive([f.project]); });
    await expect(admissions.run([newResourceId()], key, async () => undefined)).rejects.toThrow('不能扩展');
    unavailable.add(f.project); await admissions.check([f.project]);
  })).rejects.toThrow('project deleting');
  const rows = await f.tdb.db.execute(sql`SELECT * FROM runtime_environment.deletion_callbacks`);
  expect(rows).toHaveLength(1); expect(rows[0]!.project_ids).toEqual([f.otherProject,f.project].sort()); expect(rows[0]!.exited_at).not.toBeNull();
  expect(() => admissions.assertActive([f.project])).toThrow('已退出');
});

test('数据库连接消失先释放 SQL 锁，不会把尚未返回的原 callback 记录为退出', async () => {
  const { f, admissions } = await setup(), started = deferred(), release = deferred(), returned = deferred();
  const work = admissions.run([f.project], callback(), async () => { started.resolve(); try { await release.promise; expect(() => admissions.assertActive([f.project])).toThrow('exited'); } finally { returned.resolve(); } });
  const observed = work.catch(() => undefined);
  await started.promise;
  const before = one(await f.tdb.db.execute<{ id: string; backend_pid: number }>(sql`SELECT id,backend_pid FROM runtime_environment.deletion_callbacks`));
  try {
    await f.tdb.db.execute(sql`SELECT pg_terminate_backend(${before.backend_pid})`); await observed; await seal(f,f.project);
    const stillRunning = one(await f.tdb.db.execute(sql`SELECT exited_at,exit_digest FROM runtime_environment.deletion_callbacks WHERE id=${before.id}`));
    expect(stillRunning.exited_at).toBeNull(); expect(stillRunning.exit_digest).toBeNull();
  } finally { release.resolve(); await returned.promise; }
  for (let n=0;n<20;n++) {
    const row = one(await f.tdb.db.execute(sql`SELECT exited_at FROM runtime_environment.deletion_callbacks WHERE id=${before.id}`));
    if (row.exited_at) return;
    await Bun.sleep(20);
  }
  throw new Error('original callback finally did not commit its exit');
});

test('封闭前的 repeatable-read 快照不能在 seal 后复活项目，TRUNCATE 同样不能绕开保护', async () => {
  const { f } = await setup(), seen = deferred(), closing = deferred();
  await f.uow.run(async (s) => { await s.developmentPolicies.save({ projectId: f.project, revision: 1, developmentTask: {}, developmentAgents: [] }); });
  const late = f.tdb.db.transaction(async (tx) => {
    await tx.execute(sql`SELECT * FROM runtime_environment.deletion_fences`); seen.resolve(); await closing.promise;
    await tx.execute(sql`INSERT INTO runtime_environment.allocation_receipts VALUES(${newResourceId()},${f.project},'{}'::jsonb)`);
  }, { isolationLevel: 'repeatable read' });
  const rejected = late.then(() => undefined, (error: unknown) => error);
  await seen.promise; try { await seal(f,f.project); } finally { closing.resolve(); }
  expect(await rejected).toMatchObject({ cause: { code: '40001' } });
  expect(await f.tdb.db.execute(sql`SELECT operation_id FROM runtime_environment.allocation_receipts`)).toHaveLength(0);
  await expect(f.tdb.db.transaction(async (tx) => { await tx.execute(sql`TRUNCATE runtime_environment.allocation_receipts`); })).rejects.toMatchObject({ cause: { code: '55000' } });
});

test('真正接入的 builder callback 先持久登记原进程，原观察返回后才退出；封写后的下一轮零外部调用', async () => {
  const driver = buildExecutorFixture(), { f } = await setup(driver.executor,undefined,true);
  const image = await f.image(), revision = await f.revision(image.id), build = await f.api.startBuild(f.admin,f.project,image.id,{revisionId:revision.id,requestKey:'admitted'});
  driver.block(); const work = f.api.runBuild(build.id); await driver.started;
  const before = one(await f.tdb.db.execute(sql`SELECT * FROM runtime_environment.deletion_callbacks WHERE kind='build'`));
  expect(before.consumer_id).toBe(build.id); expect(before.exited_at).toBeNull(); expect(before.original_process).toEqual(processIdentity);
  const content = await f.uow.read.projectContent(f.project);
  expect(content.inventory.complete).toBe(true); expect(content.callbacks.find((entry)=>entry.id===before.id)).toMatchObject({kind:'build',consumerId:build.id,exited:false,process:processIdentity});
  const closing = seal(f,f.project); driver.unblock(); await work; await closing;
  const after = one(await f.tdb.db.execute(sql`SELECT * FROM runtime_environment.deletion_callbacks WHERE id=${before.id}`));
  expect(after.exited_at).not.toBeNull(); expect(after.exit_digest).toMatch(/^[a-f0-9]{64}$/);
  const count = driver.calls.length;
  await expect(f.api.runBuild(build.id)).rejects.toThrow('永久封闭'); expect(driver.calls).toHaveLength(count);
});

test('真正接入的验证心跳看到删除状态后拒绝继续，原 executor 返回前仍保留在途记录', async () => {
  const started = deferred(), release = deferred(); let allowed: boolean | undefined, stops = 0;
  const executor: RuntimeImageValidationExecutor = { run: async (_context, heartbeat) => { started.resolve(); await release.promise; allowed=await heartbeat(); return {state:'unknown',checks:[]}; },stop:async()=>{stops++;return true;} };
  const { f, unavailable } = await setup(undefined,executor,true), version = await builtVersion(f);
  const validation = await f.api.startValidation(f.developer,f.project,version.id,{requestKey:'admitted-validation',target:{usage:'task'}});
  const work = f.api.runValidation(validation.id); await started.promise;
  const before = one(await f.tdb.db.execute(sql`SELECT * FROM runtime_environment.deletion_callbacks WHERE kind='validation'`));
  expect(before.consumer_id).toBe(validation.id); expect(before.exited_at).toBeNull();
  unavailable.add(f.project);
  const closing = seal(f,f.project); release.resolve(); await work; await closing;
  expect(allowed).toBe(false); expect(stops).toBe(0);
  const after = one(await f.tdb.db.execute(sql`SELECT * FROM runtime_environment.deletion_callbacks WHERE id=${before.id}`));
  expect(after.exited_at).not.toBeNull();
  expect((await f.uow.read.validations.get(validation.id))?.state).toBe('running');
});

test('源码准备经过原准入，封闭后不能继续读取原仓库；平台镜像定义仍可维护', async () => {
  const { f } = await setup(undefined,undefined,true), image = await f.image();
  await f.revision(image.id);
  const before = one(await f.tdb.db.execute(sql`SELECT * FROM runtime_environment.deletion_callbacks WHERE kind='source'`));
  expect(before.project_ids).toEqual([f.project]); expect(before.original_process).toEqual(processIdentity); expect(before.exited_at).not.toBeNull();
  const reads = f.prepares(); await seal(f,f.project);
  await expect(f.revision(image.id)).rejects.toThrow('永久封闭'); expect(f.prepares()).toBe(reads);
  await f.uow.run(async (s) => { await s.images.update({...image,enabled:false}); });
  expect((await f.uow.read.images.get(image.id))?.enabled).toBe(false);
});

test('受控 schema 的原 journal 完整纳入盘点，错绑退出摘要和部分控制表不能被解释为空', async () => {
  const { f, admissions } = await setup();
  await admissions.run([f.project],callback(),async()=>undefined);
  const content = await f.uow.read.projectContent(f.project);
  expect(content.inventory.complete).toBe(true); expect(content.callbacks).toHaveLength(1); expect(content.callbacks[0]!.exited).toBe(true);
  expect(content.rows.map((entry)=>entry.table)).toEqual(['deletion_callbacks']);
  // Legacy/corrupt persisted input is injected behind the guard; ordinary writes are separately rejected below.
  await f.tdb.db.execute(sql`ALTER TABLE runtime_environment.deletion_callbacks DISABLE TRIGGER runtime_project_callback_guard`);
  await f.tdb.db.execute(sql`UPDATE runtime_environment.deletion_callbacks SET exit_digest=${'f'.repeat(64)}`);
  await f.tdb.db.execute(sql`ALTER TABLE runtime_environment.deletion_callbacks ENABLE TRIGGER runtime_project_callback_guard`);
  expect((await f.uow.read.projectContent(f.project)).inventory).toMatchObject({complete:false,blockers:[{code:'runtime-image-callback-origin-invalid'}]});
  await f.tdb.db.execute(sql`DROP TABLE runtime_environment.deletion_entities`);
  await expect(f.uow.read.projectContent(f.otherProject)).rejects.toThrow('未知或缺失');
});

test('已有初始化引用也必须经过持久准入：封闭后零凭据读取，原回调的盘点不含凭据值', async () => {
  const definitionId=newResourceId(), itemId=newResourceId(), stamp={definitionId,itemId,environment:'development' as const,version:1}; let reads=0;
  const f=await runtimeImageFixture(undefined,{versions:async()=>[stamp],values:{render:async()=>{reads++;return {[`development:${definitionId}`]:'fixture-secret-only'};}}},undefined,undefined,undefined,
    {protectCurrent:async()=>processIdentity,assertAvailable:async()=>undefined}); fixtures.push(f);
  const image=await f.image(), revision=await f.api.createRevision(f.admin,f.project,image.id,CreateRuntimeImageRevisionSchema.parse({source:{kind:'existing',reference:'registry.test/project/tools:v1',architecture:'linux/amd64',usage:'task'},initializer:{secrets:[{id:'token',environment:'development',configDefinitionId:definitionId}]}}));
  const build=await f.api.startBuild(f.admin,f.project,image.id,{requestKey:'initializer-build',revisionId:revision.id});
  const version={id:newResourceId(),imageId:image.id,revisionId:revision.id,buildId:build.id,repository:'registry.test/project/tools',digest:'sha256:'+'a'.repeat(64),architecture:'linux/amd64' as const,state:'available' as const,createdAt:build.createdAt,initializerDigest:imageContentDigest(revision.initializer),toolsDigest:imageContentDigest(revision.tools)};
  await f.uow.run(async(s)=>{await s.versions.insert(version);await s.builds.update({... (await s.builds.get(build.id))!,state:'succeeded',versionId:version.id});});
  await passedValidation(f,version.id);
  const owner={type:'task' as const,id:newResourceId()}, snapshot=(await f.api.reserveImage(f.developer,f.project,{owner,selection:{runtimeImageVersionId:version.id},target:{usage:'task'}}))!;
  expect(Object.keys(await f.api.renderInitializationSecrets(f.project,owner,snapshot))).toEqual(['token']); expect(reads).toBe(1);
  const content=await f.uow.read.projectContent(f.project);
  expect(content.inventory).toMatchObject({complete:true,blockers:[],references:[]});
  expect(content.callbacks.find((entry)=>entry.kind==='initializer')).toMatchObject({exited:true,process:processIdentity});
  expect(JSON.stringify(content)).not.toContain('fixture-secret-only');
  await seal(f,f.project); await expect(f.api.renderInitializationSecrets(f.project,owner,snapshot)).rejects.toThrow('永久封闭'); expect(reads).toBe(1);
});

test('builder 凭据读取也登记原回调；seal 后不签 Git token、不读取推送或包凭据', async () => {
  const {f,admissions}=await setup(), native=k8sBuildFixture(); native.update({resourcePlan:native.plan});
  let reads=0;
  const credentials={...native.credentials,issueGit:async (...args:Parameters<typeof native.credentials.issueGit>)=>{reads++;return native.credentials.issueGit(...args);},push:async (...args:Parameters<typeof native.credentials.push>)=>{reads++;return native.credentials.push(...args);},packages:async (...args:Parameters<typeof native.credentials.packages>)=>{reads++;return native.credentials.packages(...args);}};
  const values=runtimeImageBuildSecretValues(native.intents,credentials,async()=>native.revision,admissions), input={recordId:native.plan.resourceId,buildId:native.plan.buildId,executionEpoch:native.plan.executionEpoch};
  expect(Object.keys(await values(input)).sort()).toEqual(['docker-config','git-token']); expect(reads).toBe(3);
  const journal = one(await f.tdb.db.execute(sql`SELECT * FROM runtime_environment.deletion_callbacks WHERE consumer_id=${input.buildId}`));
  expect(journal.exited_at).not.toBeNull();expect(journal.kind).toBe('build');expect(journal.original_process).toEqual(processIdentity);
  await seal(f,native.build().projectId!);await expect(values(input)).rejects.toThrow('永久封闭');expect(reads).toBe(3);
});

test('builder 凭据的原计划在准入前后被替换，未签发任何凭据就拒绝', async () => {
  const {admissions}=await setup(), native=k8sBuildFixture(); native.update({resourcePlan:native.plan});
  let gets=0,issued=0;
  const intents={...native.intents,get:async()=>{gets++;return gets===1?native.build():{...native.build(),resourcePlan:{...native.plan,destination:'replacement.invalid/project/image'}};}};
  const credentials={...native.credentials,issueGit:async(...args:Parameters<typeof native.credentials.issueGit>)=>{issued++;return native.credentials.issueGit(...args);}};
  const values=runtimeImageBuildSecretValues(intents,credentials,async()=>native.revision,admissions);
  await expect(values({recordId:native.plan.resourceId,buildId:native.plan.buildId,executionEpoch:native.plan.executionEpoch})).rejects.toThrow('身份已变化');expect(issued).toBe(0);
});

test('清理阶段即使移除了完整 fence 文档，最小持久封闭标记仍拒绝外部回调和普通写',async()=>{
  const {f,admissions}=await setup(); await seal(f,f.project);
  // Simulate lost legacy full scope without granting normal producers permission to erase it.
  await f.tdb.db.execute(sql`ALTER TABLE runtime_environment.deletion_fences DISABLE TRIGGER runtime_project_control_guard`);
  await f.tdb.db.execute(sql`DELETE FROM runtime_environment.deletion_fences WHERE project_id=${f.project}`);
  await f.tdb.db.execute(sql`ALTER TABLE runtime_environment.deletion_fences ENABLE TRIGGER runtime_project_control_guard`);
  await expect(admissions.run([f.project],callback(),async()=>{throw new Error('must not enter');})).rejects.toThrow('永久封闭');
  await expect(f.uow.run(async(s)=>{await s.developmentPolicies.save({projectId:f.project,revision:1,developmentTask:{},developmentAgents:[]});})).rejects.toMatchObject({cause:{code:'55000',message:'Runtime image project admission is permanently sealed'}});
});

test('普通 SQL 不能改写在途回调的原进程或伪造退出，真正的 finally 仍能完成',async()=>{
  const {f,admissions}=await setup(),started=deferred(),release=deferred();
  const work=admissions.run([f.project],callback(),async()=>{started.resolve();await release.promise;});
  const observed=work.then(()=>undefined,(error:unknown)=>error);await started.promise;
  const before=(await f.uow.read.projectContent(f.project)).callbacks[0]!;
  try {
    await expect(f.tdb.db.transaction(async(tx)=>{await tx.execute(sql`UPDATE runtime_environment.deletion_callbacks SET backend_pid=backend_pid+1 WHERE id=${before.id}`);})).rejects.toMatchObject({cause:{code:'55000'}});
    await expect(f.tdb.db.transaction(async(tx)=>{await tx.execute(sql`UPDATE runtime_environment.deletion_callbacks SET exited_at=now(),exit_digest=${runtimeImageCallbackReceipt(before)} WHERE id=${before.id}`);})).rejects.toMatchObject({cause:{code:'55000'}});
    await expect(f.tdb.db.transaction(async(tx)=>{await tx.execute(sql`DELETE FROM runtime_environment.deletion_callbacks WHERE id=${before.id}`);})).rejects.toMatchObject({cause:{code:'55000'}});
  } finally {release.resolve();await observed;}
  expect((await f.uow.read.projectContent(f.project)).callbacks[0]!.exited).toBe(true);
});

test('永久封闭、原范围和实体身份不能由普通 SQL 删除、倒退、清空或伪造会话变量绕过',async()=>{
  const {f}=await setup();await seal(f,f.project);
  const row = one(await f.tdb.db.execute<{operation_id:string;generation:number}>(sql`SELECT operation_id,generation FROM runtime_environment.deletion_fences WHERE project_id=${f.project}`));
  const attempts=[sql`DELETE FROM runtime_environment.project_admissions WHERE project_id=${f.project}`,sql`UPDATE runtime_environment.project_admissions SET sealed=false WHERE project_id=${f.project}`,sql`DELETE FROM runtime_environment.deletion_fences WHERE project_id=${f.project}`,sql`UPDATE runtime_environment.deletion_fences SET phase_index=6,receipts='{}'::jsonb WHERE project_id=${f.project}`,sql`INSERT INTO runtime_environment.deletion_entities VALUES('builds',${newResourceId()},${f.project})`];
  for(const statement of attempts) await expect(f.tdb.db.transaction(async(tx)=>{
    await tx.execute(sql`SELECT set_config('crewstation.runtime_deletion_owner',${row.operation_id+':'+row.generation+':metadata'},true)`);await tx.execute(statement);
  })).rejects.toMatchObject({cause:{code:'55000'}});
  for(const table of ['deletion_fences','deletion_entities','project_admissions','deletion_callbacks']) await expect(f.tdb.db.transaction(async(tx)=>{await tx.execute(sql`TRUNCATE runtime_environment.${sql.identifier(table)}`);})).rejects.toMatchObject({cause:{code:'55000'}});
});

test('即使持有真实共享准入也不能登记坏原身份或重复、乱序的项目范围',async()=>{
  const {f,admissions}=await setup();
  await admissions.run([f.project,f.otherProject],callback(),async()=>{
    const original=(await f.tdb.db.execute<{body:Record<string,unknown>}>(sql`SELECT to_jsonb(deletion_callbacks) AS body FROM runtime_environment.deletion_callbacks`))[0]!.body;
    for(const invalid of [
      {consumer_id:'project-slug'}, {callback_pid:-1}, {input_digest:'not-a-hash'}, {callback_started_at:'not-a-date'},
      {original_process:{...processIdentity,containerId:'replacement-container'}}, {original_process:{...processIdentity,extra:'unverified'}},
      {original_process:{...processIdentity,podUid:null}}, {original_process:{...processIdentity,nodeName:123}},
      {project_ids:[f.project,f.project],original_project_ids:[f.project,f.project]},
      {project_ids:[f.project,f.otherProject].sort().reverse(),original_project_ids:[f.project,f.otherProject].sort().reverse()},
    ]){
      const body={...original,id:newResourceId(),...invalid};
      await expect(f.tdb.db.transaction(async(tx)=>{await tx.execute(sql`INSERT INTO runtime_environment.deletion_callbacks SELECT (jsonb_populate_record(NULL::runtime_environment.deletion_callbacks,${JSON.stringify(body)}::jsonb)).*`);})).rejects.toMatchObject({cause:{code:'55000'}});
    }
  });
  expect((await f.uow.read.projectContent(f.project)).callbacks).toHaveLength(1);
});

});
