import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import type { ProjectId, ServiceId } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { noopLogger } from '@crewstation/kernel';
import type { DataControlModule } from '@crewstation/module-data-control';
import { createDataControlModule, dataControlMigrations } from '@crewstation/module-data-control';
import type { ResourcesModule } from '@crewstation/module-resources';
import { createResourcesModule, resourcesMigrations } from '@crewstation/module-resources';
import { generateSecretKey } from '@crewstation/secretbox';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, DEFAULT_TEST_DATABASE_URL, testDatabaseAvailable } from '@crewstation/testkit';
import type { DataLedger } from '../ports/ledger';
import { createDataModule, dataMigrations } from '../wiring';

// RFC-025 I28 裁定 (b)：生产库、开发库由 data-control 建——data 受理只写期望（标明由它建）并等记录就绪；data-control 生成口令、
// 加密存自己的表，再建运行角色与库；data 渲染连接串时经端口要口令，自己不存。这里接真实的台账与数据面，连接串要真的连得上。
const available = await testDatabaseAvailable();
const adminUrl = process.env.CS_TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
const suffix = Bun.randomUUIDv7().replace(/-/g, '').slice(-8);
const slug = `dcp${suffix}`;
const serviceId = '01a0bf5d-8f4b-76c5-866c-f1feda3d6401' as ServiceId;
const projectId = '01a0bf5d-8f4b-7178-82e1-9a99060b1402' as ProjectId;

describe.skipIf(!available)('data：生产库、开发库由 data-control 建（RFC-025 I28）', () => {
  let tdb: TestDatabase;
  let resources: ResourcesModule;
  let control: DataControlModule;
  const key = generateSecretKey();
  const settings = (url: URL) => ({ defaultPlan: 'db-small', secretKeyBase64: key, postgres: { adminUrl, visibleHost: url.hostname, visiblePort: Number(url.port) } });
  const services = { resolveServiceById: async () => ({ projectId, slug }) };
  let ledger: DataLedger;

  beforeAll(async () => {
    tdb = await createTestDatabase([eventbusMigrations, dataMigrations, resourcesMigrations, dataControlMigrations]);
    resources = createResourcesModule({ db: tdb.db, quotas: { limitFor: async () => 4 }, authorizer: { projectAccess: async () => ({ operate: true }) }, isAdmin: async () => false });
    ledger = {
      declare: (input) => resources.api.owner('data').declare(input), get: (id) => resources.api.get(id),
      requestRelease: (id, reason) => resources.api.owner('data').requestRelease(id, reason),
      presentBindings: async () => (await resources.api.list({ kind: 'data-binding' })).filter((entry) => entry.desired === 'present'),
    };
    control = createDataControlModule({
      adminUrl, db: tdb.db, secretKeyBase64: key, observer: { pollMs: 20, resyncMs: 200 },
      ledger: {
        get: (id) => resources.api.get(id), changesSince: resources.api.changesSince, latestChange: resources.api.latestChange, observe: (input) => resources.api.observe(input),
        listLive: async () => [...await resources.api.list({ kind: 'database' }), ...await resources.api.list({ kind: 'data-binding' })],
      },
    });
    control.observer.start();
  });
  afterAll(async () => {
    await control?.observer.stop();
    const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
    // 第二条用例的期望也会被 data-control 接着建出来：一并清掉。
    const names = [`cs_${slug}`, `cs_${slug}_dev`, `cs_x${suffix}`, `cs_x${suffix}_dev`];
    for (const db of names) await admin.unsafe(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    for (const role of names) await admin.unsafe(`DROP ROLE IF EXISTS "${role}"`);
    await admin.end();
    await tdb?.drop();
  });

  test('开通：等 data-control 建好才就绪，data 不存连接串；渲染的连接串用它存的口令、连得上；期望里标明由它建、没有口令', async () => {
    const data = createDataModule({
      db: tdb.db, ledger, credentials: control.api, provisioningTiming: { waitMs: 15_000, pollMs: 50 }, authorizer: { authorize: async () => undefined },
      services, isAdmin: async () => false, settings: settings(new URL(adminUrl)), logger: noopLogger,
    });
    const [prod, dev] = await data.api.ensureServiceData(serviceId);
    expect([prod?.state, dev?.state]).toEqual(['ready', 'ready']);
    const stored = await tdb.db.execute(`SELECT env, secret_box FROM data.resources WHERE service_id = '${serviceId}' ORDER BY env`) as unknown as Array<{ env: string; secret_box: string | null }>;
    expect(stored.map((row) => [row.env, row.secret_box])).toEqual([['development', null], ['production', null]]);
    const url = (await data.api.envFor(serviceId, 'production'))['CS_DATABASE_URL']!;
    const credential = (await control.api.credentialOf(prod!.id))!;
    expect(new URL(url)).toMatchObject({ username: `cs_${slug}`, pathname: `/cs_${slug}` });
    expect(decodeURIComponent(new URL(url).password)).toBe(credential.password);
    const client = postgres(url, { max: 1, onnotice: () => undefined, connect_timeout: 5 });
    try { expect((await client<{ one: number }[]>`SELECT 1 AS one`)[0]?.one).toBe(1); } finally { await client.end(); }
    const record = (await resources.api.get(prod!.id))!;
    expect(record.spec['provision']).toBe('data-control');
    expect(JSON.stringify(record)).not.toContain(credential.password);
    expect((await data.api.envFor(serviceId, 'development'))['CS_DATABASE_URL']).toContain(`/cs_${slug}_dev`);
  });

  test('过了等待时限还没建好：记失败（期望留着，调和器会接着建），下次开通重试；这时 data 不自己建、连接串没有', async () => {
    const other = '01a0bf5d-8f4b-76c5-866c-f1feda3d6409' as ServiceId;
    const never = { credentialOf: async () => undefined };
    const slow = createDataModule({
      db: tdb.db, ledger: { ...ledger, get: async (id) => ({ id, desired: 'present' as const, phase: 'provisioning' }) }, credentials: never, provisioningTiming: { waitMs: 60, pollMs: 20 },
      authorizer: { authorize: async () => undefined }, services: { resolveServiceById: async () => ({ projectId, slug: `x${suffix}` }) }, isAdmin: async () => false,
      settings: settings(new URL(adminUrl)), logger: noopLogger,
      provider: { provisionDatabase: async () => { throw new Error('不该由 data 建'); }, createTemporaryRole: async () => { throw new Error('unused'); }, dropRole: async () => undefined, dropDatabase: async () => undefined },
    });
    const [prod] = await slow.api.ensureServiceData(other);
    expect(prod).toMatchObject({ state: 'failed', message: '数据库没有在时限内建好，平台会继续建，稍后重试开通即可' });
    expect(await slow.api.envFor(other, 'production')).toEqual({});
  });
});
