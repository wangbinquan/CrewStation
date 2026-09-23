import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, ProjectId } from '@crewstation/contracts';
import { createFakeK8sClient } from '@crewstation/k8s';
import { noopLogger } from '@crewstation/kernel';
import { runMigrations } from '@crewstation/persistence';
import { loadPlatformSettings } from '@crewstation/settings';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { PlatformModule } from '../wiring';
import { createPlatformModule } from '../wiring';

const available = await testDatabaseAvailable();
let db: TestDatabase, platform: PlatformModule;

const TEMPLATE = '01a0bf5d-8f4b-7002-9560-94caf593fb19';
/** 台账里这个项目的一种记录（RFC-025 第四期：命名空间与网络策略写成记录，由调和器建出）。 */
const recordOf = async (projectId: string, kind: 'namespace' | 'network-policy-set') => (await platform.modules.resources.api.list({ projectId: projectId as ProjectId, kind }))[0];
const policyNames = async (projectId: string): Promise<string[]> => ((await recordOf(projectId, 'network-policy-set'))?.spec.children ?? []).map((child) => child.name).sort();

beforeAll(async () => {
  if (!available) return;
  db = await createTestDatabase();
  const k8s = createFakeK8sClient();
  const settings = loadPlatformSettings({ CS_DATABASE_URL: db.url, CS_SECRET_KEY: Buffer.alloc(32, 3).toString('base64'), CS_GITLAB_URL: 'http://127.0.0.1:9' });
  platform = createPlatformModule({ db: db.db, settings, k8s, logger: noopLogger, instance: 'test.namespace-provisioning' });
  await runMigrations(db.db, platform.api.migrations);
});
afterAll(async () => { await db?.drop(); });

/**
 * 「哪类项目拿到哪条网络策略」：RFC-018 的整个安全边界压在 provisioning 的一个 `kind` 分支上，这里从组合根起盯住它——
 * 重下发写进台账的期望（RFC-025 第四期起由调和器照记录建出，渲染与形状在 cluster-control 的用例里核对）。
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

    const outcome = await platform.modules.provisioning.api.reapplyNamespaces();

    expect(outcome.failed).toBe(0);
    expect(outcome.applied).toBe(3);
    // 数字人服务槽不放行：它访问公司系统要经接口目录与网关放行表。
    expect(await policyNames(worker.id)).toEqual(['crewstation-build-egress', 'crewstation-default', 'crewstation-task-egress']);
    for (const p of [proxy, producer]) {
      expect(await policyNames(p.id)).toEqual(['crewstation-build-egress', 'crewstation-default', 'crewstation-integration-egress', 'crewstation-task-egress']);
    }
    // 归档项目不该被重下发唤醒。
    expect(await recordOf(archived.id, 'namespace')).toBeUndefined();
    expect(await policyNames(archived.id)).toEqual([]);

    // 记录归 provisioning，期望里带渲染要用的全部字段：命名空间的项目标签与额度、默认策略放行的系统命名空间。
    const namespace = await recordOf(proxy.id, 'namespace');
    expect(namespace?.owner).toEqual({ module: 'provisioning', ref: proxy.id });
    expect(namespace?.spec).toMatchObject({ children: [{ kind: 'Namespace', name: proxy.namespace }, { kind: 'ResourceQuota', namespace: proxy.namespace, name: 'crewstation-project' }], labels: { 'crewstation.io/project': 'ns-proxy' }, quota: { hard: { pods: '30' } } });
    expect((await recordOf(proxy.id, 'network-policy-set'))?.spec['systemNamespace']).toBe('crewstation-system');
    // 再跑一遍：同样的期望不写库（版本不变）。
    const version = namespace?.version;
    await platform.modules.provisioning.api.reapplyNamespaces();
    expect((await recordOf(proxy.id, 'namespace'))?.version).toBe(version);
  }, 30_000);
});
