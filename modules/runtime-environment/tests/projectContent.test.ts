import { afterEach, describe, expect, test } from 'bun:test';
import { newResourceId } from '@crewstation/kernel';
import { ProjectIdSchema } from '@crewstation/contracts';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { runtimeImageFixture, type RuntimeImageFixture } from './runtimeImageFixture';
import { builtVersion, passedValidation } from './versionFixture';
import { runtimeEnvironmentMigrations } from '../wiring';

const available = await testDatabaseAvailable(), cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function fixture() {
  // 旧库盘点必须拒绝缺少原沿革和控制表的完成证明；新版 owner 在独立用例中验证。
  const previous = { ...runtimeEnvironmentMigrations, files: runtimeEnvironmentMigrations.files.filter((file) => file.name < '0007') };
  const f = await runtimeImageFixture(undefined, undefined, undefined, undefined, undefined, undefined, previous); cleanups.push(() => f.tdb.drop());
  const version = await builtVersion(f); return { ...f, version };
}
const count = (content: Awaited<ReturnType<RuntimeImageFixture['uow']['read']['projectContent']>>, table: string) => content.inventory.resources.find((entry) => entry.kind === 'runtime-image:' + table)?.count ?? 0;

describe.skipIf(!available)('永久删除的完整运行镜像内容来源', () => {
  test('全量纳入超过目录页的过期引用、验证、策略和回执；保留其他项目与平台定义且只返回摘要', async () => {
    const f = await fixture(), validation = await passedValidation(f, f.version.id);
    await f.api.shareImage(f.admin, f.project, f.version.imageId, 'shared', 1);
    const foreign = await f.api.startValidation(f.developer, f.otherProject, f.version.id, { requestKey: 'foreign', target: { usage: 'task' } });
    const marker = 'private-content-must-not-escape';
    await f.tdb.db.execute(sql`INSERT INTO runtime_environment.references(id,version_id,project_id,owner_type,owner_id,payload)
      SELECT gen_random_uuid()::text,${f.version.id},${f.project},'task','owned-'||n,jsonb_build_object('projectId',${f.project}::text,'expiresAt','2000-01-01T00:00:00Z','marker',${marker}::text) FROM generate_series(1,2001) n`);
    await f.uow.run(async (s) => {
      await s.developmentPolicies.save({ projectId: f.project, revision: 1, developmentTask: { runtimeImageVersionId: f.version.id }, developmentAgents: [] });
      await s.projectImagePolicies.save({ projectId: ProjectIdSchema.parse(f.project), revision: 1, updatedAt: null, policy: { mode: 'restricted', allowedImageIds: [f.version.imageId], additionalImageIds: [], excludedImageIds: [] } });
    });
    await f.tdb.db.execute(sql`INSERT INTO runtime_environment.allocation_receipts VALUES (${newResourceId()},${f.project},${JSON.stringify({ marker })}::jsonb),(${newResourceId()},${f.otherProject},'{}'::jsonb)`);
    await f.tdb.db.execute(sql`INSERT INTO runtime_environment.creation_requests VALUES (${f.project},${f.admin.userId},'own',${marker},${f.version.imageId},${f.version.revisionId}),(${f.otherProject},${f.admin.userId},'other','foreign',${f.version.imageId},${f.version.revisionId}),('platform',${f.admin.userId},'global','platform',${f.version.imageId},${f.version.revisionId})`);
    const before = [...await f.tdb.db.execute(sql`SELECT 'image' AS kind,payload FROM runtime_environment.images UNION ALL SELECT 'validation',payload FROM runtime_environment.validations UNION ALL SELECT 'reference',payload FROM runtime_environment.references ORDER BY kind,payload`)];
    const content = await f.uow.read.projectContent(f.project);
    expect(content.inventory).toMatchObject({ participant: 'runtime-environment', complete: false, blockers: [], references: [{ kind: 'platform-image-provenance', id: f.version.id }] });
    expect(count(content, 'references')).toBe(2001); expect(count(content, 'validations')).toBe(1);
    for (const table of ['image_project_grants', 'development_policies', 'project_image_policies', 'creation_requests', 'allocation_receipts']) expect(count(content, table)).toBe(1);
    for (const table of ['images', 'revisions', 'versions']) expect(count(content, table)).toBe(0);
    expect(count(content, 'builds')).toBe(1);
    expect(content.consumers.map((entry) => entry.id).sort()).toEqual([validation.id, f.version.buildId].sort());
    expect(content.consumers.some((entry) => entry.id === foreign.id)).toBe(false);
    expect(content.inventory.resources.filter((entry) => entry.scope === 'physical').map((entry) => entry.id).sort()).toEqual([validation.id, f.version.buildId].sort());
    expect(content.dependencies).toEqual([{ kind: 'source', revisionId: f.version.revisionId, imageId: f.version.imageId }]);
    expect(JSON.stringify(content)).not.toContain(marker);
    expect(await f.uow.read.projectContent(f.project)).toEqual(content);
    expect([...await f.tdb.db.execute(sql`SELECT 'image' AS kind,payload FROM runtime_environment.images UNION ALL SELECT 'validation',payload FROM runtime_environment.validations UNION ALL SELECT 'reference',payload FROM runtime_environment.references ORDER BY kind,payload`)]).toEqual(before);
    await f.tdb.db.execute(sql`UPDATE runtime_environment.allocation_receipts SET payload='{"foreignChange":true}'::jsonb WHERE project_id=${f.otherProject}`);
    expect((await f.uow.read.projectContent(f.project)).inventory.revision).toBe(content.inventory.revision);
    await f.tdb.db.execute(sql`UPDATE runtime_environment.allocation_receipts SET payload='{"ownChange":true}'::jsonb WHERE project_id=${f.project}`);
    expect((await f.uow.read.projectContent(f.project)).inventory.revision).not.toBe(content.inventory.revision);
    await f.tdb.db.execute(sql`UPDATE runtime_environment.builds SET lease_until=now(),payload=payload||'{"leaseUntil":"2030-01-01T00:00:00Z"}'::jsonb WHERE id=${f.version.buildId}`);
    const leaseChanged = await f.uow.read.projectContent(f.project);
    expect(leaseChanged.inventory.resources.filter((entry) => entry.scope === 'physical')).toEqual(content.inventory.resources.filter((entry) => entry.scope === 'physical'));
    await f.tdb.db.execute(sql`UPDATE runtime_environment.builds SET payload=payload||'{"resourcePlan":{"namespace":"original","name":"builder"}}'::jsonb WHERE id=${f.version.buildId}`);
    const planChanged = await f.uow.read.projectContent(f.project);
    expect(planChanged.consumers.find((entry) => entry.id === f.version.buildId)?.planIdentity).toMatch(/^[a-f0-9]{64}$/);
    expect(planChanged.inventory.resources.find((entry) => entry.kind === 'runtime-image:build')?.sourceIdentity).not.toBe(content.inventory.resources.find((entry) => entry.kind === 'runtime-image:build')?.sourceIdentity);
  });

  test('旧项目 builder 全量日志和原物理身份保留；平台版本的沿革引用不能被当成可删', async () => {
    const f = await fixture();
    await f.tdb.db.execute(sql`UPDATE runtime_environment.builds SET project_id=${f.project},payload=payload||jsonb_build_object('projectId',${f.project}::text,'podUid','original-pod') WHERE id=${f.version.buildId}`);
    await f.tdb.db.execute(sql`INSERT INTO runtime_environment.build_logs(build_id,stage,text,created_at) SELECT ${f.version.buildId},'build','private-source-'||n,now() FROM generate_series(1,2001) n`);
    const content = await f.uow.read.projectContent(f.project);
    expect(count(content, 'builds')).toBe(1); expect(count(content, 'build_logs')).toBe(2001);
    expect(count(content, 'versions')).toBe(0); expect(count(content, 'images')).toBe(0);
    expect(content.consumers).toHaveLength(1);
    expect(content.consumers[0]).toMatchObject({ kind: 'build', id: f.version.buildId, state: 'succeeded', podUid: 'original-pod', executionEpoch: 1 });
    expect(content.consumers[0]?.resourceId).toBeDefined();
    expect(content.inventory).toMatchObject({ complete: false, references: [{ kind: 'platform-image-provenance', id: f.version.id }] });
    expect(JSON.stringify(content)).not.toContain('private-source-');
    const foreign = await f.uow.read.projectContent(f.otherProject);
    expect(foreign.rows).toHaveLength(0); expect(foreign.consumers).toHaveLength(0);
  });

  test('平台 builder 的全部日志也属于原来源清理范围；外项目拥有的 builder 只能报告引用，不能纳入删除', async () => {
    const f = await fixture();
    await f.tdb.db.execute(sql`INSERT INTO runtime_environment.build_logs(build_id,stage,text,created_at) SELECT ${f.version.buildId},'build','private-platform-source-'||n,now() FROM generate_series(1,2001) n`);
    const own = await f.uow.read.projectContent(f.project);
    expect(count(own, 'builds')).toBe(1); expect(count(own, 'build_logs')).toBe(2001);
    expect(own.inventory.references).toMatchObject([{ kind: 'platform-image-provenance', id: f.version.id }]);
    expect(JSON.stringify(own)).not.toContain('private-platform-source-');
    await f.tdb.db.execute(sql`UPDATE runtime_environment.builds SET project_id=${f.otherProject},payload=payload||jsonb_build_object('projectId',${f.otherProject}::text) WHERE id=${f.version.buildId}`);
    const foreign = await f.uow.read.projectContent(f.project);
    expect(count(foreign, 'builds')).toBe(0); expect(count(foreign, 'build_logs')).toBe(0);
    expect(foreign.inventory).toMatchObject({ complete: false, references: [{ kind: 'runtime-image-foreign-build-content', id: f.version.buildId, projectId: f.otherProject }] });
    expect(foreign.consumers.map((entry) => entry.id)).toEqual([f.version.buildId]);
    expect(count(await f.uow.read.projectContent(f.otherProject), 'build_logs')).toBe(2001);
  });

  test('列与文档原归属冲突、空验证归属和非法项目键均明确阻断', async () => {
    const f = await fixture(), validation = await passedValidation(f, f.version.id);
    await f.tdb.db.execute(sql`INSERT INTO runtime_environment.references VALUES (${newResourceId()},${f.version.id},${f.project},'task','conflict',jsonb_build_object('projectId',${f.otherProject}::text))`);
    const conflict = await f.uow.read.projectContent(f.project);
    expect(conflict.inventory.complete).toBe(false); expect(conflict.inventory.blockers.some((entry) => entry.code === 'runtime-image-owner-conflict')).toBe(true);
    expect(count(conflict, 'references')).toBe(0);
    await f.tdb.db.execute(sql`DELETE FROM runtime_environment.references WHERE owner_id='conflict'`);
    await f.tdb.db.execute(sql`UPDATE runtime_environment.validations SET payload=payload-'projectId' WHERE id=${validation.id}`);
    expect((await f.uow.read.projectContent(f.project)).inventory.blockers.some((entry) => entry.code === 'runtime-image-owner-conflict')).toBe(true);
    await f.tdb.db.execute(sql`UPDATE runtime_environment.validations SET payload=payload||'{"projectId":"unverified-old-key"}'::jsonb WHERE id=${validation.id}`);
    expect((await f.uow.read.projectContent(f.project)).inventory.blockers.some((entry) => entry.code === 'runtime-image-owner-conflict')).toBe(true);
    await f.tdb.db.execute(sql`UPDATE runtime_environment.validations SET payload=payload||jsonb_build_object('projectId',${f.project}::text,'versionId',${newResourceId()}::text) WHERE id=${validation.id}`);
    const mismatch = await f.uow.read.projectContent(f.project);
    expect(mismatch.inventory.complete).toBe(false); expect(count(mismatch, 'validations')).toBe(0);
    await f.tdb.db.execute(sql`UPDATE runtime_environment.validations SET payload=payload||jsonb_build_object('versionId',${f.version.id}::text) WHERE id=${validation.id}`);
    await f.tdb.db.execute(sql`UPDATE runtime_environment.revisions SET payload=payload||'{"sourceProjectId":"unverified-source"}'::jsonb WHERE id=${f.version.revisionId}`);
    expect((await f.uow.read.projectContent(f.project)).inventory.blockers.some((entry) => entry.code === 'runtime-image-owner-conflict')).toBe(true);
  });

  test('未知内容表或列拒绝完整证明；空项目也核对 schema 和项目身份', async () => {
    const f = await fixture(), empty = newResourceId();
    expect((await f.uow.read.projectContent(empty)).inventory).toMatchObject({ complete: true, resources: [], blockers: [], references: [] });
    await expect(f.uow.read.projectContent('project-slug')).rejects.toThrow();
    await f.tdb.db.execute(sql`ALTER TABLE runtime_environment.images ADD COLUMN unclassified jsonb`);
    await expect(f.uow.read.projectContent(empty)).rejects.toThrow('未知或缺失');
    await f.tdb.db.execute(sql`ALTER TABLE runtime_environment.images DROP COLUMN unclassified`);
    await f.tdb.db.execute(sql`CREATE TABLE runtime_environment.unknown_project_content(id text,body jsonb)`);
    await expect(f.uow.read.projectContent(empty)).rejects.toThrow('未知或缺失');
  });

  test('在途验证缺失、跨项目或替换版本的执行快照阻断；已结束验证不强求已释放引用', async () => {
    const f = await fixture(), validation = await f.api.startValidation(f.developer, f.project, f.version.id, { requestKey: 'running-origin', target: { usage: 'task' } });
    const original = (await f.uow.read.references.get(f.version.id, 'validation', validation.id))!;
    expect((await f.uow.read.projectContent(f.project)).inventory.blockers).toHaveLength(0);
    await f.uow.read.references.remove(original.id);
    const missing = await f.uow.read.projectContent(f.project);
    expect(missing.inventory).toMatchObject({ complete: false, blockers: [{ code: 'runtime-image-validation-origin-missing', resourceId: validation.id }] });
    await f.uow.read.references.insert({ ...original, projectId: f.otherProject });
    expect((await f.uow.read.projectContent(f.project)).inventory.blockers.some((entry) => entry.code === 'runtime-image-validation-origin-missing')).toBe(true);
    await f.uow.read.references.remove(original.id);
    await f.uow.read.references.insert({ ...original, snapshot: { ...original.snapshot!, versionId: newResourceId() } });
    expect((await f.uow.read.projectContent(f.project)).inventory.blockers.some((entry) => entry.code === 'runtime-image-validation-origin-missing')).toBe(true);
    await f.uow.read.references.remove(original.id);
    await f.uow.read.validations.update({ ...(await f.uow.read.validations.get(validation.id))!, state: 'passed' });
    expect((await f.uow.read.projectContent(f.project)).inventory.blockers).toHaveLength(0);
  });

  test('超过两千项在途验证逐项核对原快照，末项损坏明确阻断且不截断完整清单', async () => {
    const f = await fixture(), validation = await f.api.startValidation(f.developer, f.project, f.version.id, { requestKey: 'bulk-origin', target: { usage: 'task' } });
    const original = (await f.uow.read.references.get(f.version.id, 'validation', validation.id))!, payload = (await f.uow.read.validations.get(validation.id))!;
    const inputs = Array.from({ length: 2001 }, (_, n) => ({ id: newResourceId(), reference_id: newResourceId(), n }));
    await f.tdb.db.execute(sql`WITH inputs AS MATERIALIZED (SELECT * FROM jsonb_to_recordset(${JSON.stringify(inputs)}::jsonb) AS input(id text,reference_id text,n integer)), inserted AS (
      INSERT INTO runtime_environment.validations(id,version_id,actor_id,request_key,contract_digest,state,payload)
      SELECT id,${f.version.id},${f.developer.userId},'bulk-'||n,${payload.contractDigest},'queued',${JSON.stringify(payload)}::jsonb||jsonb_build_object('id',id,'requestKey','bulk-'||n) FROM inputs RETURNING id
    ) INSERT INTO runtime_environment.references(id,version_id,project_id,owner_type,owner_id,payload)
      SELECT inputs.reference_id,${f.version.id},${f.project},'validation',inserted.id,${JSON.stringify(original)}::jsonb||jsonb_build_object('id',inputs.reference_id,'ownerId',inserted.id,'snapshot',${JSON.stringify(original.snapshot)}::jsonb||jsonb_build_object('validationId',inserted.id)) FROM inserted JOIN inputs USING(id)`);
    const complete = await f.uow.read.projectContent(f.project);
    expect(complete.inventory.blockers).toHaveLength(0); expect(complete.inventory.references).toMatchObject([{ kind: 'platform-image-provenance', id: f.version.id }]);
    expect(count(complete, 'validations')).toBe(2002); expect(count(complete, 'references')).toBe(2002);
    expect(complete.consumers.filter((entry) => entry.kind === 'validation')).toHaveLength(2002);
    const last = (await f.tdb.db.execute<{ owner_id: string }>(sql`SELECT owner_id FROM runtime_environment.references WHERE owner_type='validation' ORDER BY owner_id DESC LIMIT 1`))[0]!.owner_id;
    await f.tdb.db.execute(sql`UPDATE runtime_environment.references SET payload=payload-'snapshot' WHERE owner_type='validation' AND owner_id=${last}`);
    const damaged = await f.uow.read.projectContent(f.project);
    expect(damaged.inventory).toMatchObject({ complete: false, blockers: [{ code: 'runtime-image-validation-origin-missing', resourceId: last }] });
    expect(damaged.inventory.blockers).toHaveLength(1); expect(count(damaged, 'validations')).toBe(2002); expect(count(damaged, 'references')).toBe(2002);
  });
});
