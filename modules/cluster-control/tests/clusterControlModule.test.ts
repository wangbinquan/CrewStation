import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, ProjectId, UserId } from '@crewstation/contracts';
import { AdoptionReportSchema, IDENTITY_HEADERS } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import type { K8sClient, K8sObject } from '@crewstation/k8s';
import { createFakeK8sClient } from '@crewstation/k8s';
import { isPlatformError } from '@crewstation/kernel';
import type { ResourcesModule } from '@crewstation/module-resources';
import { createResourcesModule, resourcesMigrations } from '@crewstation/module-resources';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { LegacyTask } from '../domain/adoption';
import type { ManagedObjectFeed, ObjectChange } from '../ports/cluster';
import { createClusterControlModule } from '../wiring';

const available = await testDatabaseAvailable();
const PROJECT = '01a0bf5d-8f4b-7c01-8e19-e226732a75a4' as ProjectId;
const ADMIN: Actor = { userId: '01a0bf5d-8f4b-7c01-8e19-e226732a7504' as UserId, isAdmin: true };
const DEVELOPER: Actor = { userId: '01a0bf5d-8f4b-7c01-8e19-e226732a7501' as UserId, isAdmin: false };

const pod = (name: string, labels: Record<string, string> = {}, status: unknown = { phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }] }): K8sObject => ({
  apiVersion: 'v1', kind: 'Pod', metadata: { name, namespace: 'cs-demo', uid: `uid-${name}`, labels: { 'app.kubernetes.io/managed-by': 'crewstation', ...labels } }, spec: { nodeName: 'desktop-worker' }, status,
});
const pvc = (name: string, labels: Record<string, string>): K8sObject => ({ apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: { name, namespace: 'cs-demo', uid: `uid-${name}`, labels: { 'app.kubernetes.io/managed-by': 'crewstation', ...labels } }, status: { phase: 'Bound' } });

/** 手动驱动的变化流：用例决定什么时候来一条变化；缓存里放的对象供按记录核对时查。 */
function manualFeed(): ManagedObjectFeed & { emit(change: ObjectChange): Promise<void>; readonly cache: Map<string, K8sObject> } {
  let handle: ((change: ObjectChange) => Promise<void>) | undefined;
  const cache = new Map<string, K8sObject>();
  return {
    cache, start: (next) => { handle = next; }, stop: async () => { handle = undefined; }, synced: async () => undefined,
    // 与真实观测缓存一致：先更新缓存，再把变化交给处理者。
    emit: async (change) => {
      const at = `${change.kind}/${change.object.metadata.namespace ?? ''}/${change.object.metadata.name}`;
      if (change.gone) cache.delete(at); else cache.set(at, change.object as K8sObject);
      await handle?.(change);
    },
    cached: (kind, namespace, name) => cache.get(`${kind}/${namespace ?? ''}/${name}`),
  };
}

describe.skipIf(!available)('cluster-control：观测写回台账与收编空跑（RFC-025 第一期）', () => {
  let database: TestDatabase;
  let resources: ResourcesModule;
  const tasks = new Map<string, LegacyTask>([
    ['t-live', { kind: 'dev-session', state: 'running', execution: false }],
    ['t-failed', { kind: 'dev-session', state: 'failed', execution: false }],
    ['t-released', { kind: 'business', state: 'released', execution: false }],
  ]);
  const k8s: K8sClient = createFakeK8sClient();
  const feed = manualFeed();
  let control: ReturnType<typeof createClusterControlModule>;

  beforeAll(async () => {
    database = await createTestDatabase([resourcesMigrations]);
    resources = createResourcesModule({ db: database.db, quotas: { limitFor: async () => 4 }, authorizer: { projectAccess: async () => ({ operate: true }) }, isAdmin: async (id) => id === ADMIN.userId });
    const system: K8sObject = { ...pod('cs-api-1'), metadata: { ...pod('cs-api-1').metadata, namespace: 'crewstation-system' } };
    const objects = [pod('task-owned'), pod('task-live', { 'crewstation.io/task': 't-live' }), pod('task-failed', { 'crewstation.io/task': 't-failed' }), pod('task-gone', { 'crewstation.io/task': 't-missing' }),
      pvc('work-released', { 'crewstation.io/task': 't-released' }), pod('svc-prod', { 'crewstation.io/workload': 'service', 'crewstation.io/release': 'rel-1' }), pod('loose'), system,
      pvc('work-legacy', { 'crewstation.io/task': 'tsk_01a0954107447000b7936485fb80d15d' }), pvc('work-legacy-gone', { 'crewstation.io/task': 'tsk_unknown' })];
    control = createClusterControlModule({
      k8s, feed, isAdmin: async (id) => id === ADMIN.userId, systemNamespace: 'crewstation-system',
      reader: { list: async (kind) => objects.filter((o) => o.kind === kind) },
      ledger: {
        observe: (input) => resources.api.observe(input), claimOf: (child) => resources.api.claimOf(child), get: (id) => resources.api.get(id),
        listLive: () => resources.api.list({}), changesSince: resources.api.changesSince, latestChange: resources.api.latestChange,
      },
      reconciler: { pollMs: 20 },
      legacy: { resolveTaskId: async (legacyId) => (legacyId === 'tsk_01a0954107447000b7936485fb80d15d' ? 't-live' : undefined), task: async (taskId) => tasks.get(taskId) },
    });
    control.observer.start();
  });
  afterAll(async () => { await control.observer.stop(); await database.drop(); });

  test('观测：台账认领的 Pod 写进子对象并推动阶段；没人认领的记 unowned；消失记 absent', async () => {
    const record = await resources.api.owner('task-runtime').declare({ kind: 'dev-workspace', ref: 'owned', projectId: PROJECT, spec: { children: [{ kind: 'Pod', namespace: 'cs-demo', name: 'task-owned' }] } });
    await feed.emit({ kind: 'Pod', object: pod('task-owned'), gone: false });
    const observed = await resources.api.get(record.id);
    expect(observed?.children[0]).toMatchObject({ name: 'task-owned', uid: 'uid-task-owned', phase: 'Running', ready: true, node: 'desktop-worker' });
    expect(observed?.conditions.find((c) => c.type === 'CrashLooping')?.status).toBe('false');
    expect(observed?.phase).toBe('starting');
    await feed.emit({ kind: 'Pod', object: pod('loose'), gone: false });
    await feed.emit({ kind: 'Pod', object: { ...pod('cs-api-1'), metadata: { ...pod('cs-api-1').metadata, namespace: 'crewstation-system' } }, gone: false });
    // 档位测试的 Pod 在系统命名空间但带任务标签：照常观测（台账里没人认领时记 unowned）
    await feed.emit({ kind: 'Pod', object: { ...pod('task-probe', { 'crewstation.io/task': 't-probe' }), metadata: { ...pod('task-probe', { 'crewstation.io/task': 't-probe' }).metadata, namespace: 'crewstation-system' } }, gone: false });
    await feed.emit({ kind: 'Pod', object: pod('task-owned'), gone: true });
    expect((await resources.api.get(record.id))?.children[0]?.phase).toBe('absent');
    await control.reconciled();
    // 按记录核对也会对同一对象再报一次观测（台账去重，记为 unchanged），次数取决于核对轮次，这里不数。
    expect(control.stats()).toMatchObject({ recorded: 2, unowned: 2, platform: 1 });
  });

  test('按记录核对：对象先在、记录后声明时，从观测缓存补上观测；缓存里没了的补消失', async () => {
    feed.cache.set('Pod/cs-demo/task-late', pod('task-late'));
    const record = await resources.api.owner('task-runtime').declare({ kind: 'dev-workspace', ref: 'late', projectId: PROJECT, spec: { children: [{ kind: 'Pod', namespace: 'cs-demo', name: 'task-late' }] } });
    const deadline = Date.now() + 3_000;
    while ((await resources.api.get(record.id))?.children[0]?.phase !== 'Running' && Date.now() < deadline) await Bun.sleep(20);
    expect((await resources.api.get(record.id))?.children[0]).toMatchObject({ name: 'task-late', uid: 'uid-task-late', phase: 'Running' });
    feed.cache.delete('Pod/cs-demo/task-late');
    await resources.api.owner('task-runtime').report(record.id, { display: { branch: 'dev' } });
    while ((await resources.api.get(record.id))?.children[0]?.phase !== 'absent' && Date.now() < deadline + 3_000) await Bun.sleep(20);
    expect((await resources.api.get(record.id))?.children[0]?.phase).toBe('absent');
  });

  test('收编空跑：逐个判定归属，孤儿排在前面，计数覆盖全部；只读，不写台账', async () => {
    const before = (await resources.api.list({ includeStopped: true })).length;
    const report = AdoptionReportSchema.parse(await control.api.adoptionReport(ADMIN));
    expect(report.dryRun).toBe(true);
    expect(report.counts).toEqual({ owned: 1, adoptable: 3, orphan: 3, retained: 1, platform: 1, unclassified: 1 });
    expect(report.items.at(-1)).toMatchObject({ name: 'cs-api-1', verdict: 'platform' });
    expect(report.items.slice(0, 3).map((i) => i.name).sort()).toEqual(['task-gone', 'work-legacy-gone', 'work-released']);
    // RFC-013 之前的旧 ID 经身份目录换成现 ID：它的会话还在，工作卷是可收编，不是孤儿
    expect(report.items.find((i) => i.name === 'work-legacy')).toMatchObject({ verdict: 'adoptable', candidateKind: 'volume', ownerRef: 't-live' });
    expect(report.items.find((i) => i.name === 'work-legacy-gone')).toMatchObject({ verdict: 'orphan', ownerRef: 'tsk_unknown' });
    expect(report.items.find((i) => i.name === 'task-live')).toMatchObject({ verdict: 'adoptable', candidateKind: 'dev-workspace', ownerRef: 't-live' });
    expect(report.items.find((i) => i.name === 'task-owned')?.verdict).toBe('owned');
    expect((await resources.api.list({ includeStopped: true })).length).toBe(before);
  });

  test('只给管理员：用例与 HTTP 路由都拒绝非管理员', async () => {
    let kind: string | undefined;
    try { await control.api.adoptionReport(DEVELOPER); } catch (error) { kind = isPlatformError(error) ? error.kind : String(error); }
    expect(kind).toBe('forbidden');
    const app = createApp({ name: 'cluster-control-test' });
    for (const router of control.http) app.route('/', router);
    const as = (actor: Actor) => ({ [IDENTITY_HEADERS.userId]: actor.userId, [IDENTITY_HEADERS.userName]: 'n', [IDENTITY_HEADERS.userEmail]: 'e@x' });
    expect((await app.request('/v1/admin/resources/adoption-report', { headers: as(DEVELOPER) })).status).toBe(403);
    const ok = await app.request('/v1/admin/resources/adoption-report', { headers: as(ADMIN) });
    expect(ok.status).toBe(200);
    expect(AdoptionReportSchema.parse(await ok.json()).counts.owned).toBe(1);
  });
});
