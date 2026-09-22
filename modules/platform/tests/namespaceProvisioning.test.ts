import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor } from '@crewstation/contracts';
import type { FakeK8sClient } from '@crewstation/k8s';
import { createFakeK8sClient } from '@crewstation/k8s';
import { noopLogger } from '@crewstation/kernel';
import { runMigrations } from '@crewstation/persistence';
import { loadPlatformSettings } from '@crewstation/settings';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { PlatformModule } from '../wiring';
import { createPlatformModule } from '../wiring';

const available = await testDatabaseAvailable();
let db: TestDatabase, platform: PlatformModule, k8s: FakeK8sClient;

const TEMPLATE = '01a0bf5d-8f4b-7002-9560-94caf593fb19';
const policyNames = (namespace: string): string[] =>
  k8s.applied.filter((o) => o.kind === 'NetworkPolicy' && o.metadata.namespace === namespace).map((o) => o.metadata.name).sort();

beforeAll(async () => {
  if (!available) return;
  db = await createTestDatabase();
  k8s = createFakeK8sClient();
  const settings = loadPlatformSettings({ CS_DATABASE_URL: db.url, CS_SECRET_KEY: Buffer.alloc(32, 3).toString('base64'), CS_GITLAB_URL: 'http://127.0.0.1:9' });
  platform = createPlatformModule({ db: db.db, settings, k8s, logger: noopLogger, instance: 'test.namespace-provisioning' });
  await runMigrations(db.db, platform.api.migrations);
});
afterAll(async () => { await db?.drop(); });

/**
 * 「哪类项目拿到哪条网络策略」这条判断只活在组合根里：`packages/k8s` 的用例看得见策略形状，
 * 看不见谁会收到它。RFC-018 的整个安全边界就压在这一个 `kind` 分支上，所以在这里盯住它。
 */
describe.skipIf(!available)('项目命名空间的网络策略下发（RFC-018）', () => {
  test('接入容器项目多一条出站策略，数字人项目没有；重下发遍历未归档项目且不碰已归档的', async () => {
    const { identity, project } = platform.modules;
    const adminUser = await identity.api.ensureUser({ externalId: 'ns-admin', name: 'Admin', email: 'admin@ns.test' });
    const admin: Actor = { userId: adminUser.id, isAdmin: true };

    const worker = await project.api.createProject(admin, { name: '数字人', slug: 'ns-worker', kind: 'DigitalWorker', template: TEMPLATE });
    const proxy = await project.api.createProject(admin, { name: '接入代理', slug: 'ns-proxy', kind: 'APIProxy', template: TEMPLATE });
    const producer = await project.api.createProject(admin, { name: '事件来源', slug: 'ns-producer', kind: 'EventProducer', template: TEMPLATE });
    const archived = await project.api.createProject(admin, { name: '已归档接入', slug: 'ns-archived', kind: 'APIProxy', template: TEMPLATE });
    await project.api.setProjectState(archived.id, 'active');
    await project.api.setProjectState(archived.id, 'archived');

    k8s.applied.length = 0;
    const outcome = await platform.modules.provisioning.api.reapplyNamespaces();

    expect(outcome.failed).toBe(0);
    expect(outcome.applied).toBe(3);
    // 数字人服务槽不放行：它访问公司系统要经接口目录与网关放行表。
    expect(policyNames(worker.namespace)).toEqual(['crewstation-build-egress', 'crewstation-default', 'crewstation-task-egress']);
    for (const p of [proxy, producer]) {
      expect(policyNames(p.namespace)).toEqual(['crewstation-build-egress', 'crewstation-default', 'crewstation-integration-egress', 'crewstation-task-egress']);
    }
    // 归档项目不该被重下发唤醒。
    expect(policyNames(archived.namespace)).toEqual([]);

    const integration = k8s.applied.find((o) => o.metadata.name === 'crewstation-integration-egress' && o.metadata.namespace === proxy.namespace);
    expect((integration as unknown as { spec: Record<string, unknown> }).spec).toMatchObject({
      podSelector: { matchLabels: { 'crewstation.io/workload': 'service' } }, policyTypes: ['Egress'], egress: [{}],
    });
  }, 30_000);
});
