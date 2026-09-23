import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, ProjectId, UserId } from '@crewstation/contracts';
import { AdoptionReportSchema, IDENTITY_HEADERS } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import type { FakeK8sClient, K8sObject } from '@crewstation/k8s';
import { createFakeK8sClient, Resources } from '@crewstation/k8s';
import { isPlatformError } from '@crewstation/kernel';
import type { ResourcesModule } from '@crewstation/module-resources';
import { createResourcesModule, resourcesMigrations } from '@crewstation/module-resources';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { LegacyTask } from '../domain/adoption';
import type { ClusterWriter, ManagedObjectFeed, ObjectChange } from '../ports/cluster';
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
    list: (kind) => [...cache.entries()].filter(([at]) => at.startsWith(`${kind}/`)).map(([, object]) => object),
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
  const k8s: FakeK8sClient = createFakeK8sClient();
  const feed = manualFeed();
  // 调和器的删除：按 UID 删假集群里的对象，并像真实观测缓存那样随即报一次消失。
  const removals: string[] = [];
  const cluster: ClusterWriter = {
    remove: async ({ kind, namespace, name, uid }) => {
      removals.push(`${kind}/${name}`);
      await k8s.delete(Resources[kind]!, name, namespace, { preconditions: { uid } });
      const cached = feed.cache.get(`${kind}/${namespace ?? ''}/${name}`);
      if (cached?.metadata.uid === uid) await feed.emit({ kind, object: cached, gone: true });
    },
  };
  let control: ReturnType<typeof createClusterControlModule>;

  beforeAll(async () => {
    database = await createTestDatabase([resourcesMigrations]);
    resources = createResourcesModule({ db: database.db, quotas: { limitFor: async () => 4 }, authorizer: { projectAccess: async () => ({ operate: true }) }, isAdmin: async (id) => id === ADMIN.userId });
    const system: K8sObject = { ...pod('cs-api-1'), metadata: { ...pod('cs-api-1').metadata, namespace: 'crewstation-system' } };
    const objects = [pod('task-owned'), pod('task-live', { 'crewstation.io/task': 't-live' }), pod('task-failed', { 'crewstation.io/task': 't-failed' }), pod('task-gone', { 'crewstation.io/task': 't-missing' }),
      pvc('work-released', { 'crewstation.io/task': 't-released' }), pod('svc-prod', { 'crewstation.io/workload': 'service', 'crewstation.io/release': 'rel-1' }), pod('loose'), system,
      pvc('work-legacy', { 'crewstation.io/task': 'tsk_01a0954107447000b7936485fb80d15d' }), pvc('work-legacy-gone', { 'crewstation.io/task': 'tsk_unknown' }),
      // 第二期起也列带任务标签的 Runner Secret 与预览路由；不带任务标签的（服务槽的 Service、Git 凭据）留给第三期，不列。
      { ...pvc('task-rel-runner', { 'crewstation.io/task': 't-released' }), kind: 'Secret' }, { ...pvc('demo-green', { 'crewstation.io/workload': 'service' }), kind: 'Service' }];
    control = createClusterControlModule({
      k8s, feed, cluster, isAdmin: async (id) => id === ADMIN.userId, systemNamespace: 'crewstation-system',
      reader: { list: async (kind) => objects.filter((o) => o.kind === kind) },
      ledger: {
        observe: (input) => resources.api.observe(input), claimOf: (child) => resources.api.claimOf(child), get: (id) => resources.api.get(id),
        listLive: () => resources.api.list({}), changesSince: resources.api.changesSince, latestChange: resources.api.latestChange,
        observeConditions: (id, conditions) => resources.api.observeConditions(id, conditions), children: (parentId) => resources.api.list({ parentId, includeStopped: true }),
        adoptOrphanVolume: async () => undefined,
      },
      // 孤儿回收单独在 orphanSweep.test.ts 里核对；这里关掉，免得它的定时轮次与本文件的用例交错。
      orphanSweep: false,
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

  const until = async (label: string, predicate: () => Promise<boolean> | boolean, ms = 3_000) => {
    const deadline = Date.now() + ms;
    while (!(await predicate())) { if (Date.now() > deadline) throw new Error(`等待超时：${label}`); await Bun.sleep(20); }
  };
  const child = (kind: string, name: string, uid = `uid-${name}`, extra: Record<string, unknown> = {}): K8sObject => ({ apiVersion: kind === 'IngressRoute' ? 'traefik.io/v1alpha1' : 'v1', kind, metadata: { name, namespace: 'cs-demo', uid, labels: { 'app.kubernetes.io/managed-by': 'crewstation' } }, ...extra });
  const place = async (object: K8sObject) => { await k8s.create(object); await feed.emit({ kind: object.kind as ObjectChange['kind'], object, gone: false }); };

  test('「不要了」的记录：按 Pod、Secret、Service、路由的顺序按 UID 删子对象；删除中的不重复删，系统命名空间的平台组件不碰；删完进入已结束', async () => {
    const names = ['Pod/task-rel', 'Secret/task-rel-runner', 'Service/task-rel', 'IngressRoute/task-rel'];
    const record = await resources.api.owner('task-runtime').declare({ kind: 'agent-execution', ref: 'rel', projectId: PROJECT, spec: { children: [...names, 'Pod/task-rel-old'].map((entry) => ({ kind: entry.split('/')[0]!, namespace: 'cs-demo', name: entry.split('/')[1]! })) } });
    for (const entry of names) await place(child(entry.split('/')[0]!, entry.split('/')[1]!, `uid-${entry}`, entry.startsWith('Pod') ? { spec: {}, status: { phase: 'Running' } } : {}));
    // 已在删除中的旧 Pod：不再发删除，等它自己消失。
    const terminating = child('Pod', 'task-rel-old', 'uid-old', { spec: {}, status: { phase: 'Running' } });
    await place({ ...terminating, metadata: { ...terminating.metadata, deletionTimestamp: '2026-09-23T12:00:00Z' } });
    await resources.api.owner('task-runtime').requestRelease(record.id, { code: 'execution-ended', message: '执行已结束' });
    await until('子对象删除', () => removals.length >= 4);
    await control.reconciled();
    expect(removals).toEqual(['Pod/task-rel', 'Secret/task-rel-runner', 'Service/task-rel', 'IngressRoute/task-rel']);
    expect((await resources.api.get(record.id))?.phase).toBe('stopping');
    await feed.emit({ kind: 'Pod', object: terminating, gone: true });
    expect((await resources.api.get(record.id))?.phase).toBe('stopped');
    expect(control.stats().removed).toBe(4);
  });

  test('工作卷：上级保留期满或持久卷的上级结束时写「待回收」（按已结束算，卷不删）；跟随容器的卷等所属模块自己标「不要了」', async () => {
    const owner = resources.api.owner('task-runtime');
    const scenario = async (ref: string, reclaim: 'delete' | 'retain', reason: string) => {
      const workload = await owner.declare({ kind: 'dev-workspace', ref, projectId: PROJECT, spec: { children: [{ kind: 'Pod', namespace: 'cs-demo', name: `task-${ref}` }] } });
      const volume = await owner.declare({ kind: 'volume', ref: `${ref}/work`, projectId: PROJECT, parentId: workload.id, spec: { children: [{ kind: 'PersistentVolumeClaim', namespace: 'cs-demo', name: `task-${ref}-work` }], reclaim } });
      await place(child('PersistentVolumeClaim', `task-${ref}-work`, `uid-${ref}-work`, { status: { phase: 'Bound' } }));
      await owner.requestRelease(workload.id, { code: reason, message: reason });
      return volume.id;
    };
    const expired = await scenario('exp', 'delete', 'retention-expired'), persistent = await scenario('keep', 'retain', 'business'), follow = await scenario('follow', 'delete', 'user');
    await until('待回收', async () => (await resources.api.get(expired))?.phase === 'stopped' && (await resources.api.get(persistent))?.phase === 'stopped');
    expect((await resources.api.get(expired))?.reason?.code).toBe('retention-expired');
    expect((await resources.api.get(persistent))?.reason?.code).toBe('parent-ended');
    await control.reconciled();
    expect((await resources.api.get(follow))?.phase).toBe('ready');
    expect(removals.some((entry) => entry.endsWith('-work'))).toBe(false);
    expect(control.stats().reclaimable).toBe(2);
  });

  test('收编空跑：逐个判定归属，孤儿排在前面，计数覆盖全部；只读，不写台账', async () => {
    const before = (await resources.api.list({ includeStopped: true })).length;
    const report = AdoptionReportSchema.parse(await control.api.adoptionReport(ADMIN));
    expect(report.dryRun).toBe(true);
    expect(report.counts).toEqual({ owned: 1, adoptable: 3, orphan: 4, retained: 1, platform: 1, unclassified: 1 });
    expect(report.items.at(-1)).toMatchObject({ name: 'cs-api-1', verdict: 'platform' });
    expect(report.items.slice(0, 4).map((i) => i.name).sort()).toEqual(['task-gone', 'task-rel-runner', 'work-legacy-gone', 'work-released']);
    expect(report.items.some((i) => i.name === 'demo-green')).toBe(false);
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
