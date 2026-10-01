import { afterEach, describe, expect, test } from 'bun:test';
import { eventbusMigrations } from '@crewstation/eventbus';
import { ReleaseIdSchema, TaskIdSchema } from '@crewstation/contracts';
import { runMigrations } from '@crewstation/persistence';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { drizzlePodIdentityRepository } from '../adapters/persistence/drizzleRepositories';
import { gatewayMigrations } from '../wiring';

const available = await testDatabaseAvailable();
let database: TestDatabase;
afterEach(async () => { await database?.drop(); });

describe.skipIf(!available)('原 Pod 索引升级（真实 PG）', () => {
  test('无损回填旧服务／开发 UID；未知旧业务实例保持未确认，不凭同名索引伪造 UID', async () => {
    database = await createTestDatabase([eventbusMigrations, { ...gatewayMigrations, files: gatewayMigrations.files.filter((f) => f.name < '0010_') }]);
    const releaseId = ReleaseIdSchema.parse(Bun.randomUUIDv7()), taskId = TaskIdSchema.parse(Bun.randomUUIDv7());
    const source = { podUid: 'service-original', ip: '10.1.2.1', releaseId, physicalSlot: 'blue' as const, ready: false };
    const development = { podUid: 'dev-original', podName: 'dev', ip: '10.1.2.2', taskId, ready: true };
    for (const [name, ip, kind, service, dev] of [['service', '10.1.2.1', 'service', source, null], ['dev', '10.1.2.2', 'dev-session', null, development], ['business', '10.1.2.3', 'business-task', null, null]] as const)
      await database.db.execute(sql`INSERT INTO gateway.pod_identities(namespace,pod_name,ip,project,service,workload,task_id,version,updated_at,service_source,development_source)
        VALUES ('cs-demo',${name},${ip},'demo','demo',${kind},${taskId},7,now(),${JSON.stringify(service)}::jsonb,${JSON.stringify(dev)}::jsonb)`);
    const before = await database.db.execute(sql`SELECT to_jsonb(p) AS body FROM gateway.pod_identities p ORDER BY pod_name`);
    await runMigrations(database.db, [gatewayMigrations]);
    expect(await database.db.execute(sql`SELECT to_jsonb(p)-'pod_uid' AS body FROM gateway.pod_identities p ORDER BY pod_name`)).toEqual(before);
    const repository = drizzlePodIdentityRepository(database.db);
    expect((await repository.byIp('10.1.2.1'))?.podUid).toBe('service-original');
    expect((await repository.byIp('10.1.2.2'))?.podUid).toBe('dev-original');
    expect((await repository.byIp('10.1.2.3'))?.podUid).toBeUndefined();
    expect((await repository.byIp('10.1.2.1'))?.source).toEqual(source);
    expect((await repository.byIp('10.1.2.2'))?.developmentSource).toEqual(development);
  });
});
