import { expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import type { ProjectId } from '@crewstation/contracts';
import { createDataModule, dataMigrations } from '@crewstation/module-data';
import { createResourcesModule, resourcesMigrations } from '@crewstation/module-resources';
import { precondition } from '@crewstation/kernel';
import { generateSecretKey, encryptString } from '@crewstation/secretbox';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { nativeDeletionRetainedHistory } from '../application/deletion/resourcePhysics';

const available = await testDatabaseAvailable();
test.skipIf(!available)('实际模块只读端口组合保留 released 数据、旧 UUID 别名和 development 哨兵，不续发凭据', async () => {
  const db = await createTestDatabase([dataMigrations, resourcesMigrations]), project = Bun.randomUUIDv7() as ProjectId, id = Bun.randomUUIDv7(), binding = Bun.randomUUIDv7(), name = 'cs_history_' + id.replaceAll('-', '').slice(-16), role = name + '_r';
  const secretKey = generateSecretKey(), cipher = { encrypt: (plain: string) => encryptString(secretKey, plain) };
  const resources = createResourcesModule({ db: db.db, quotas: { limitFor: async () => 20 }, authorizer: { projectAccess: async () => { throw precondition('closed'); } }, isAdmin: async () => false });
  const data = createDataModule({ db: db.db, authorizer: { authorize: async () => { throw precondition('closed'); }, assertProjectAvailable: async () => { throw precondition('deleting'); } }, services: { resolveServiceById: async () => { throw new Error('history must not resolve a service'); } }, isAdmin: async () => false,
    settings: { defaultPlan: 'basic', secretKeyBase64: secretKey, postgres: { adminUrl: db.url, visibleHost: 'unused', visiblePort: 5432 } }, credentials: { credentialOf: async () => { throw new Error('history must not issue credentials'); } }, provider: { provisionDatabase: async () => { throw new Error('history must not provision'); }, createTemporaryRole: async () => { throw new Error('history must not create a role'); }, dropRole: async () => { throw new Error('history must not delete a role'); }, dropDatabase: async () => { throw new Error('history must not drop a database'); } } });
  try {
    const dsn = new URL(db.url); dsn.username = role; dsn.password = 'history-secret-not-for-inventory'; dsn.pathname = '/' + name;
    await db.db.execute(sql`INSERT INTO data.resources(id,project_id,service_id,kind,env,plan,state,env_var,object_name,secret_box,created_at,updated_at) VALUES (${id},${project},${id},'postgres','production','basic','released','CS_DATABASE_URL',${name},${await cipher.encrypt(dsn.toString())},now(),now())`);
    await db.db.execute(sql`INSERT INTO data.task_bindings(id,task_id,service_id,project_id,legacy_resource_id,mode,state,requested_by,ttl_minutes,role_name,secret_box,created_at,updated_at) VALUES (${binding},${binding},${id},${project},'old-binding-id','development','revoked',${project},30,'development',${await cipher.encrypt(dsn.toString())},now(),now())`);
    await db.db.execute(sql`INSERT INTO data.resource_identity_aliases(kind,key,id) VALUES ('data-resource',${JSON.stringify(['old-data-id'])},${id}),('data-binding',${JSON.stringify(['other-binding-alias'])},${binding})`);
    const ledger = await resources.api.owner('data').declare({ kind: 'database', ref: id, projectId: project, spec: { children: [{ kind: 'PostgresDatabase', name }, { kind: 'PostgresRole', name: role }] } });
    const history = nativeDeletionRetainedHistory(data.api, resources.api, db.url), report = await history.read(project);
    expect(report.complete).toBe(true); expect(report.currentRecordsComplete).toBe(true); expect(report.blockers).toEqual([]);
    expect(report.records.some((row) => row.aliases.includes('old-data-id'))).toBe(true);
    expect(report.records.some((row) => row.aliases.includes('old-binding-id') && row.aliases.includes('other-binding-alias'))).toBe(true);
    expect(report.records.flatMap((row) => row.names).some((row) => row.name === 'development')).toBe(false);
    expect(report.records.flatMap((row) => row.names)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'database', name }), expect.objectContaining({ kind: 'role', name: role })]));
    expect(JSON.stringify(report)).not.toContain(dsn.password); expect(JSON.stringify(report)).not.toContain('postgres://');
    const foreignUrl = new URL(dsn); foreignUrl.hostname = 'unverified-native.example';
    await db.db.execute(sql`UPDATE data.resources SET secret_box=${await cipher.encrypt(foreignUrl.toString())} WHERE id=${id}`);
    const foreign = await history.read(project);
    expect(foreign.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'legacy-endpoint-unverified' })])); expect(foreign.currentRecordsComplete).toBe(false);
    await db.db.execute(sql`UPDATE data.resources SET secret_box=null WHERE id=${id}`);
    await resources.api.owner('data').requestRelease(ledger.id, { code: 'released', message: 'retained fixture' });
    const retained = await history.read(project);
    expect(retained.complete).toBe(false); expect(retained.currentRecordsComplete).toBe(true); expect(retained.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'native-revisions-unavailable' })]));
    await expect(nativeDeletionRetainedHistory({}, resources.api, db.url).read(project)).rejects.toThrow('保留历史端口');
  } finally { await resources.streamWorker.stop(); await resources.maintenanceWorker.stop(); await db.drop(); }
}, 20_000);
