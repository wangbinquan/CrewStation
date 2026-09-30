import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createFakeK8sClient } from '@crewstation/k8s';
import { newResourceId, noopLogger } from '@crewstation/kernel';
import { runMigrations } from '@crewstation/persistence';
import { loadPlatformSettings } from '@crewstation/settings';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { createPlatformModule } from '../wiring';

const additions = new Set([
  'business_task/0029_storage_control_outbox.sql', 'business_task/0030_finalizations.sql',
  'data_control/0003_object_endpoints.sql', 'data/0005_object_storage.sql',
  'gateway/0008_development_source.sql', 'resources/0003_workload_safety.sql',
  'session/0008_execution_completion_proofs.sql', 'task_runtime/0017_archive_executions.sql',
]);
const available = await testDatabaseAvailable();
let tdb: TestDatabase;
beforeAll(async () => { if (available) tdb = await createTestDatabase(); });
afterAll(async () => { await tdb?.drop(); });

describe.skipIf(!available)('对象存储升级保持既有任务和身份', () => {
  test('旧策略两种卷寿命及原卷标识不变，新能力默认关闭，八项迁移可重放', async () => {
    const settings = loadPlatformSettings({ CS_DATABASE_URL: tdb.url,
      CS_SECRET_KEY: Buffer.alloc(32, 3).toString('base64'), CS_GITLAB_URL: 'http://127.0.0.1:9' });
    const platform = createPlatformModule({ db: tdb.db, k8s: createFakeK8sClient(), settings,
      logger: noopLogger, instance: 'synthetic-storage-upgrade' });
    // 固定升级前的边界；之后追加的迁移也必须等待它依赖的对象存储／安全表先建立。
    const previous = platform.api.migrations.map((set) => {
      const first = [...additions].filter((path) => path.startsWith(`${set.module}/`)).map((path) => path.split('/')[1]!).sort()[0];
      return { ...set, files: set.files.filter((file) => !first || file.name < first) };
    });
    await runMigrations(tdb.db, previous);
    expect(await platform.api.storageContract.check()).toMatchObject({ enabled: false, requiredVersion: 0 });
    await seedPreviousRows();
    const before = await snapshot();

    const pending = platform.api.migrations.flatMap((set, index) => set.files.filter((file) => !previous[index]!.files.includes(file)).map((file) => `${set.module}/${file.name}`));
    expect((await runMigrations(tdb.db, platform.api.migrations)).sort()).toEqual(pending.sort());
    expect([...additions].every((path) => pending.includes(path))).toBe(true);

    expect(await snapshot()).toEqual(before);
    expect(await platform.api.storageContract.check()).toMatchObject({ enabled: false, requiredVersion: 0 });
    expect([...(await tdb.handle.client`SELECT development_source FROM gateway.pod_identities`)])
      .toEqual([{ development_source: null }]);
    for (const table of ['data.objects', 'data.finalization_bindings', 'business_task.finalizations',
      'task_runtime.archive_executions', 'task_runtime.unprovisioned_storage']) {
      expect((await tdb.handle.client.unsafe(`SELECT count(*)::integer AS count FROM ${table}`))[0]?.count).toBe(0);
    }
    expect(await runMigrations(tdb.db, platform.api.migrations)).toEqual([]);
    expect(await snapshot()).toEqual(before);
  }, 60_000);
});

async function seedPreviousRows(): Promise<void> {
  const project = newResourceId(), service = newResourceId(), profile = newResourceId();
  for (const mode of ['persistent', 'follow-container']) {
    const id = newResourceId(), now = '2026-09-27T00:00:00Z';
    await tdb.handle.client`INSERT INTO business_task.tasks
      (id, service_id, project_id, caller_identity, state, trace_id, volume_mode, profile, labels, created_at, updated_at)
      VALUES (${id}, ${service}, ${project}, 'synthetic-service', 'paused', 'synthetic-trace', ${mode}, ${profile}, '{}', ${now}, ${now})`;
    await tdb.handle.client`INSERT INTO task_runtime.environments
      (id, project_id, service_id, kind, state, volume_mode, profile, namespace, pod_name, pvc_name,
       trace_id, runner_token_hash, labels, pod_uid, business_workspace, created_at, updated_at, last_activity_at)
      VALUES (${id}, ${project}, ${service}, 'business', 'paused', ${mode}, ${profile}, 'synthetic-upgrade',
       ${`task-${id}`}, ${`work-${id}`}, 'synthetic-trace', 'synthetic-token-hash', '{}', 'original-pod-uid',
       ${JSON.stringify({ generation: 3, volumeUid: `original-pvc-${mode}`, storage: 'isolated-v1' })}::jsonb, ${now}, ${now}, ${now})`;
  }
  await tdb.handle.client`INSERT INTO gateway.pod_identities
    (namespace, pod_name, ip, project, service, workload, version, updated_at, service_source)
    VALUES ('synthetic-upgrade', 'service-blue', '192.0.2.10', ${project}, ${service}, 'service', 1, now(),
      ${JSON.stringify({ slot: 'blue', releaseId: newResourceId() })}::jsonb)`;
}

async function snapshot(): Promise<unknown> {
  return {
    tasks: await tdb.handle.client`SELECT to_jsonb(t) AS value FROM business_task.tasks t ORDER BY id`,
    environments: await tdb.handle.client`SELECT to_jsonb(t) AS value FROM task_runtime.environments t ORDER BY id`,
    identities: await tdb.handle.client`SELECT to_jsonb(t)-'development_source' AS value FROM gateway.pod_identities t ORDER BY pod_name`,
  };
}
