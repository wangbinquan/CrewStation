import { afterEach, describe, expect, test } from 'bun:test';
import type { ProjectDeletionContext, ProjectDeletionOwner, ProjectDeletionTarget, ProjectId, ServiceId } from '@crewstation/contracts';
import { PROJECT_DELETION_PHASES, ProjectIdSchema } from '@crewstation/contracts';
import { generateSecretKey } from '@crewstation/secretbox';
import { runMigrations } from '@crewstation/persistence';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { createDataModule, dataMigrations } from '../wiring';
import type { DataModuleDeps } from '../wiring';

const available = await testDatabaseAvailable();
const project = '01a0fa00-0000-7000-8000-000000000001' as ProjectId;
const other = '01a0fa00-0000-7000-8000-000000000002' as ProjectId;
const service = '01a0fa00-0000-7000-8000-000000000003' as ServiceId;
const foreignService = '01a0fa00-0000-7000-8000-000000000004' as ServiceId;
const target: ProjectDeletionTarget = { id: project, serviceId: service, slug: 'data-deletion', name: 'Data deletion', namespace: 'cs-data-deletion', kind: 'DigitalWorker', state: 'active', revision: '1', prodHost: 'data.local', previewHost: 'preview.data.local', serviceHost: 'data.svc.local' };
let database: TestDatabase | undefined;

async function fixture() {
  const db = await createTestDatabase([dataMigrations]); database = db;
  let allowed = true;
  const input: DataModuleDeps = {
    db: db.db, isAdmin: async () => true, services: { resolveServiceById: async (id: ServiceId) => ({ projectId: id === service ? project : other, slug: 'data-deletion' }) },
    authorizer: { authorize: async () => undefined }, settings: { defaultPlan: 'db-small', secretKeyBase64: generateSecretKey(), postgres: { adminUrl: db.url, visibleHost: 'unused', visiblePort: 5432 } },
    deletion: { sources: { resolve: async (kind, key) => ({ complete: true, id: key, projectId: kind === 'project' ? ProjectIdSchema.parse(key) : key === service ? project : other }), assertGrant: async () => { if (!allowed) throw new Error('grant revoked'); } } },
  };
  const data = createDataModule(input);
  const owner = data.api.deletionOwner;
  return { db, owner, revoke: () => { allowed = false; } };
}
async function resource(db: TestDatabase, id: string, projectId = project, serviceId = service) {
  await db.db.execute(sql`INSERT INTO data.resources(id,project_id,service_id,kind,env,plan,state,env_var,object_name,secret_box,created_at,updated_at)
    VALUES(${id},${projectId},${serviceId},'postgres','production','db-small','released','CS_DATABASE_URL','original-db','original-secret-ciphertext',now(),now())`);
}
const context = async (owner: ProjectDeletionOwner): Promise<ProjectDeletionContext> => ({ operationId: Bun.randomUUIDv7(), generation: 1, target, phase: 'seal', confirmed: await owner.inspect(target) });
const originalSqlError = (work: Promise<unknown>) => work.catch(error => { throw error.cause ?? error; });

describe.skipIf(!available)('actual data project deletion owner', () => {
  afterEach(async () => { await database?.drop(); database = undefined; });

  test('actual factory reads every original page, clears owned metadata, retains other projects and fences late SQL', async () => {
    const { db, owner } = await fixture();
    expect(owner).toBeDefined();
    const own = Bun.randomUUIDv7(), foreign = Bun.randomUUIDv7();
    await resource(db, own); await resource(db, foreign, other, foreignService);
    await db.db.execute(sql`INSERT INTO data.resources SELECT left(${own},24)||lpad(n::text,12,'0'),project_id,service_id,kind,'test-'||n,plan,state,env_var,object_name,secret_box,message,created_at,updated_at FROM data.resources CROSS JOIN generate_series(1,1000) n WHERE id=${own}`);
    await db.db.execute(sql`INSERT INTO data.object_project_policies VALUES (${project},'{}'),(${other},'{}')`);
    await db.db.execute(sql`INSERT INTO data.resource_allocations VALUES ('owned-allocation',${project},'{}'),('foreign-allocation',${other},'{}')`);
    await db.db.execute(sql`INSERT INTO data.resource_identity_aliases(kind,key,id) VALUES ('data-resource','["old-owned"]',${own}),('data-resource','["old-foreign"]',${foreign})`);
    const ctx = await context(owner!);
    expect(ctx.confirmed.complete).toBe(true);
    expect(ctx.confirmed.resources.find(r => r.id === 'resources')?.count).toBe(1001);
    expect(JSON.stringify(ctx.confirmed)).not.toContain('original-secret-ciphertext');
    const foreignBefore = await db.db.execute(sql`SELECT to_jsonb(r) AS body FROM data.resources r WHERE id=${foreign}`);
    for (const phase of PROJECT_DELETION_PHASES) expect((await owner!.run({ ...ctx, phase })).kind).toBe('done');
    expect((await owner!.inspect(target)).resources.every(r => r.count === 0)).toBe(true);
    expect(await db.db.execute(sql`SELECT to_jsonb(r) AS body FROM data.resources r WHERE id=${foreign}`)).toEqual(foreignBefore);
    expect((await db.db.execute(sql`SELECT project_id FROM data.object_project_policies`)).map(r => r['project_id'])).toEqual([other]);
    await expect(originalSqlError(resource(db, own))).rejects.toMatchObject({ code: '55000', message: 'data project content is sealed for deletion' });
    await expect(originalSqlError(db.db.execute(sql`INSERT INTO data.object_write_control VALUES (${service},'{}')`))).rejects.toMatchObject({ code: '55000', message: 'data project content is sealed for deletion' });
    await db.db.execute(sql`UPDATE data.resources SET message='healthy' WHERE id=${foreign}`);
  }, 15_000);

  test('unknown tables and conflicting original ownership block inspection without modifying original rows', async () => {
    const { db, owner } = await fixture(); expect(owner).toBeDefined();
    await resource(db, Bun.randomUUIDv7(), project, foreignService);
    const conflict = await owner!.inspect(target);
    expect(conflict.complete).toBe(false); expect(conflict.blockers.length).toBeGreaterThan(0);
    expect((await db.db.execute(sql`SELECT id FROM data.resources`)).length).toBe(1);
    await db.db.execute(sql`CREATE TABLE data.unregistered_content(project_id text)`);
    expect((await owner!.inspect(target)).complete).toBe(false);
  });

  test('changed content seals admission but requires renewed confirmation; stale grants and out of order cleanup are rejected', async () => {
    const { db, owner, revoke } = await fixture(); expect(owner).toBeDefined();
    await resource(db, Bun.randomUUIDv7());
    const old = await context(owner!);
    await db.db.execute(sql`INSERT INTO data.resource_allocations VALUES ('late-before-seal',${project},'{}')`);
    expect((await owner!.run(old)).kind).toBe('blocked');
    await expect(originalSqlError(resource(db, Bun.randomUUIDv7()))).rejects.toMatchObject({ code: '55000', message: 'data project content is sealed for deletion' });
    const renewed = { ...old, generation: 2, confirmed: await owner!.inspect(target) };
    expect((await owner!.run(renewed)).kind).toBe('done');
    await expect(owner!.run({ ...renewed, phase: 'metadata' })).rejects.toThrow('phase');
    await expect(owner!.run(old)).rejects.toThrow();
    revoke(); await expect(owner!.run({ ...renewed, phase: 'stop' })).rejects.toThrow('grant revoked');
    expect((await db.db.execute(sql`SELECT id FROM data.resources`)).length).toBe(1);
  });

  test('global backup cannot export sealed project content; retained full backups remain explicit blockers', async () => {
    const { db, owner } = await fixture(); expect(owner).toBeDefined();
    const ctx = await context(owner!); expect((await owner!.run(ctx)).kind).toBe('done');
    await expect(originalSqlError(db.db.execute(sql`INSERT INTO data.object_backups VALUES ('late-backup','late-request','exporting','{}')`))).rejects.toMatchObject({ code: '55000' });
    expect((await db.db.execute(sql`SELECT id FROM data.object_backups`)).length).toBe(0);
  });

  test('existing shared full backups block erasure and remain intact for other projects', async () => {
    const { db, owner } = await fixture(); expect(owner).toBeDefined();
    await db.db.execute(sql`INSERT INTO data.object_backups VALUES ('original-backup','original-request','completed','{"destination":"original-private-location"}')`);
    const confirmed = await owner!.inspect(target);
    expect(confirmed.complete).toBe(false); expect(confirmed.blockers.length).toBeGreaterThan(0);
    expect(JSON.stringify(confirmed)).not.toContain('original-private-location');
    await expect(owner!.run({ operationId: Bun.randomUUIDv7(),generation: 1,target,phase: 'seal',confirmed })).rejects.toThrow('complete original confirmation');
    expect((await db.db.execute(sql`SELECT body FROM data.object_backups`))[0]?.['body']).toEqual({ destination: 'original-private-location' });
  });

  test('upgrade appends only the new fence, preserves original content and rejects forged scope and truncate', async () => {
    const db = await createTestDatabase([{ ...dataMigrations,files: dataMigrations.files.filter(file => file.name < '0007_project_deletion.sql') }]); database = db;
    const id = Bun.randomUUIDv7(); await resource(db,id);
    const original = await db.db.execute(sql`SELECT to_jsonb(r) AS body FROM data.resources r`);
    const checksums = await db.db.execute(sql`SELECT name,checksum FROM platform_infra.migrations WHERE module='data' ORDER BY name`);
    expect(await runMigrations(db.db,[dataMigrations])).toEqual(['data/0007_project_deletion.sql','data/0008_project_object_work.sql']);
    expect(await db.db.execute(sql`SELECT to_jsonb(r) AS body FROM data.resources r`)).toEqual(original);
    expect(await db.db.execute(sql`SELECT name,checksum FROM platform_infra.migrations WHERE module='data' AND name<'0007_project_deletion.sql' ORDER BY name`)).toEqual(checksums);
    await expect(originalSqlError(db.db.execute(sql`INSERT INTO data.project_deletions VALUES(${project},${Bun.randomUUIDv7()},1,${'a'.repeat(64)},'{}','{}',true,NULL)`))).rejects.toMatchObject({ message: 'data deletion requires the original exclusive grant' });
    await expect(originalSqlError(db.db.execute(sql`INSERT INTO data.content_origins VALUES('service',${service},${service},${project},${'b'.repeat(64)})`))).rejects.toMatchObject({ message: 'data origin requires original seal' });
    await expect(originalSqlError(db.db.execute(sql`TRUNCATE data.resources`))).rejects.toMatchObject({ message: 'data project content and original identities cannot be truncated' });
    expect(await db.db.execute(sql`SELECT to_jsonb(r) AS body FROM data.resources r`)).toEqual(original);
  });
});
