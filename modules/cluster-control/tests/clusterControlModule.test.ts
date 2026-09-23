import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, ProjectId, UserId } from '@crewstation/contracts';
import { AdoptionReportSchema, healthOfSlotRecord, IDENTITY_HEADERS } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import type { FakeK8sClient, K8sObject } from '@crewstation/k8s';
import { createFakeK8sClient, Resources } from '@crewstation/k8s';
import { isPlatformError, noopLogger } from '@crewstation/kernel';
import type { ResourcesModule } from '@crewstation/module-resources';
import { createResourcesModule, resourcesMigrations } from '@crewstation/module-resources';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { kubernetesClusterWriter } from '../adapters/k8s/managedObjects';
import { newObservationStats } from '../application/observeChange';
import { reconcileRecord } from '../application/reconcileObservations';
import type { LegacyTask } from '../domain/adoption';
import { CRASH_LOOP_WINDOW_MS } from '../domain/observation';
import type { ClusterWriter, ManagedObjectFeed, ObjectChange } from '../ports/cluster';
import type { LedgerObservations } from '../ports/ledger';
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
  // 调和器的删除：按 UID 删假集群里的对象，并像真实观测缓存那样随即报一次消失。路由的应用用真实适配器落到假集群，写了就报一次变化。
  const removals: string[] = [], routeApplies: string[] = [];
  // 身份索引（gateway）收到的 Pod：变化逐条、首次全量同步后一份全量；名字是 pod-identity-broken 的模拟身份索引出错。
  const podEvents: string[] = [], relisted: number[] = [];
  // 调和器的调试日志（路由在等中间件时记一条）：用例据此确认那一支真的走到了。
  const debugs: string[] = [];
  const writer = kubernetesClusterWriter(k8s);
  const cluster: ClusterWriter = {
    remove: async ({ kind, namespace, name, uid }) => {
      removals.push(`${kind}/${name}`);
      await k8s.delete(Resources[kind]!, name, namespace, { preconditions: { uid } });
      const cached = feed.cache.get(`${kind}/${namespace ?? ''}/${name}`);
      if (cached?.metadata.uid === uid) await feed.emit({ kind, object: cached, gone: true });
    },
    applyRoute: async (route, current) => {
      const outcome = await writer.applyRoute(route, current);
      if (outcome !== 'applied') return outcome;
      routeApplies.push(`${current ? 'drift' : 'missing'}:${route.name}`);
      const stored = await k8s.get<K8sObject>(Resources.IngressRoute!, route.name, route.namespace);
      if (stored) await feed.emit({ kind: 'IngressRoute', object: stored, gone: false });
      return outcome;
    },
    applyMiddleware: async (middleware, resourceId, current) => {
      const outcome = await writer.applyMiddleware(middleware, resourceId, current);
      if (outcome !== 'applied') return outcome;
      routeApplies.push(`${current ? 'drift' : 'missing'}:${middleware.namespace}/${middleware.name}`);
      const stored = await k8s.get<K8sObject>(Resources.Middleware!, middleware.name, middleware.namespace);
      if (stored) await feed.emit({ kind: 'Middleware', object: stored, gone: false });
      return outcome;
    },
  };
  let control: ReturnType<typeof createClusterControlModule>;
  let ledger: LedgerObservations;

  beforeAll(async () => {
    database = await createTestDatabase([resourcesMigrations]);
    resources = createResourcesModule({ db: database.db, quotas: { limitFor: async () => 4 }, authorizer: { projectAccess: async () => ({ operate: true }) }, isAdmin: async (id) => id === ADMIN.userId });
    const system: K8sObject = { ...pod('cs-api-1'), metadata: { ...pod('cs-api-1').metadata, namespace: 'crewstation-system' } };
    const objects = [pod('task-owned'), pod('task-live', { 'crewstation.io/task': 't-live' }), pod('task-failed', { 'crewstation.io/task': 't-failed' }), pod('task-gone', { 'crewstation.io/task': 't-missing' }),
      pvc('work-released', { 'crewstation.io/task': 't-released' }), pod('svc-prod', { 'crewstation.io/workload': 'service', 'crewstation.io/release': 'rel-1' }), pod('loose'), system,
      pvc('work-legacy', { 'crewstation.io/task': 'tsk_01a0954107447000b7936485fb80d15d' }), pvc('work-legacy-gone', { 'crewstation.io/task': 'tsk_unknown' }),
      // 第二期起也列带任务标签的 Runner Secret 与预览路由；不带任务标签的（服务槽的 Service、Git 凭据）留给第三期，不列。
      { ...pvc('task-rel-runner', { 'crewstation.io/task': 't-released' }), kind: 'Secret' }, { ...pvc('demo-green', { 'crewstation.io/workload': 'service' }), kind: 'Service' }];
    ledger = {
      observe: (input) => resources.api.observe(input), claimOf: (child) => resources.api.claimOf(child), get: (id) => resources.api.get(id),
      listLive: () => resources.api.list({}), changesSince: resources.api.changesSince, latestChange: resources.api.latestChange,
      observeConditions: (id, conditions) => resources.api.observeConditions(id, conditions), children: (parentId) => resources.api.list({ parentId, includeStopped: true }),
      adoptOrphanVolume: async () => undefined,
    };
    control = createClusterControlModule({
      k8s, feed, cluster, isAdmin: async (id) => id === ADMIN.userId, systemNamespace: 'crewstation-system',
      logger: { ...noopLogger, debug: (msg: string) => { debugs.push(msg); } },
      reader: { list: async (kind) => objects.filter((o) => o.kind === kind) },
      ledger,
      // 孤儿回收单独在 orphanSweep.test.ts 里核对；这里关掉，免得它的定时轮次与本文件的用例交错。
      orphanSweep: false,
      reconciler: { pollMs: 20, retryMs: 50 },
      pods: {
        changed: async (object, gone) => {
          if (object.metadata.name === 'pod-identity-broken') throw new Error('身份索引暂时不可用');
          podEvents.push(`${object.metadata.namespace}/${object.metadata.name}:${gone ? 'gone' : 'present'}`);
        },
        synced: async (list) => { relisted.push(list.length); },
      },
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

  // RFC-025 第三期：服务槽的副本由槽记录认领（设计 §6.5「第三期由对应记录认领」），崩溃重启按 G22 汇总成条件。
  const deployment = (ready: number): K8sObject => ({ ...child('Deployment', 'shop-blue', 'uid-shop-blue'), apiVersion: 'apps/v1', metadata: { ...child('Deployment', 'shop-blue', 'uid-shop-blue').metadata, generation: 1 }, spec: { replicas: 2 },
    status: { observedGeneration: 1, replicas: 2, updatedReplicas: 2, readyReplicas: ready, conditions: [{ type: 'Progressing', status: 'True', reason: 'NewReplicaSetAvailable' }] } });
  const replica = (name: string, restartCount = 0, finishedAt?: string, replicaSet = 'shop-blue-5d8f7c'): K8sObject => ({
    ...pod(name, { 'pod-template-hash': '5d8f7c' }, { phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }], containerStatuses: [{ ready: true, restartCount, ...(finishedAt ? { lastState: { terminated: { finishedAt } } } : {}) }] }),
    metadata: { ...pod(name, { 'pod-template-hash': '5d8f7c' }).metadata, ownerReferences: [{ apiVersion: 'apps/v1', kind: 'ReplicaSet', name: replicaSet, uid: `uid-${replicaSet}`, controller: true }] },
  });

  test('服务槽：Deployment 名下的 Pod 作为观测到的子对象入账（新建的与台账接上前就在的）；副本数照观测；崩溃重启汇总后判降级，副本消失后撤掉', async () => {
    const slot = await resources.api.owner('release').declare({ kind: 'service-slot', ref: 'svc-shop/blue', projectId: PROJECT, spec: { children: [{ kind: 'Deployment', namespace: 'cs-demo', name: 'shop-blue' }] }, display: { physical: 'blue', role: 'prod' } });
    await resources.api.owner('release').report(slot.id, { conditions: [{ type: 'Serving', status: 'true' }] });
    // 台账接上之前就在的副本：只在观测缓存里，按记录核对时认领。
    feed.cache.set('Pod/cs-demo/shop-blue-5d8f7c-early', replica('shop-blue-5d8f7c-early'));
    await feed.emit({ kind: 'Deployment', object: deployment(2), gone: false });
    await feed.emit({ kind: 'Pod', object: replica('shop-blue-5d8f7c-a1'), gone: false });
    const pods = async () => (await resources.api.get(slot.id))?.children.filter((entry) => entry.kind === 'Pod').map((entry) => entry.name).sort();
    await until('两个副本入账', async () => (await pods())?.length === 2);
    await control.reconciled();
    const ready = (await resources.api.get(slot.id))!;
    expect(await pods()).toEqual(['shop-blue-5d8f7c-a1', 'shop-blue-5d8f7c-early']);
    expect(ready).toMatchObject({ phase: 'ready' });
    expect(ready.children.find((entry) => entry.kind === 'Deployment')).toMatchObject({ replicas: 2, readyReplicas: 2 });
    expect(ready.conditions.find((entry) => entry.type === 'CrashLooping')?.status).toBe('false');
    // 一个副本 10 分钟内重启到第 3 次：汇总成立，副本眼下都就绪也是降级；旧健康接口是 crash-looping。
    await feed.emit({ kind: 'Pod', object: replica('shop-blue-5d8f7c-a1', 3, new Date(Date.now() - 60_000).toISOString()), gone: false });
    await until('崩溃重启', async () => (await resources.api.get(slot.id))?.phase === 'degraded');
    const looping = (await resources.api.get(slot.id))!;
    expect(looping.reason).toMatchObject({ code: 'crash-looping', message: '容器反复重启：累计重启 3 次，10 分钟内仍有重启' });
    expect(healthOfSlotRecord({ ...looping, phaseSince: looping.phaseSince.toISOString() })).toMatchObject({ state: 'crash-looping', replicas: 2, readyReplicas: 2, restarts: 3 });
    // 那个副本被换掉：子对象随之删去，汇总只剩没重启过的副本，条件撤掉，回到运行中。
    await feed.emit({ kind: 'Pod', object: replica('shop-blue-5d8f7c-a1', 3), gone: true });
    await until('恢复', async () => (await resources.api.get(slot.id))?.phase === 'ready');
    expect(await pods()).toEqual(['shop-blue-5d8f7c-early']);
    // 别的 Deployment 的副本与裸 Pod 不会被这条记录认领。
    await feed.emit({ kind: 'Pod', object: replica('other-blue-5d8f7c-z', 0, undefined, 'other-blue-5d8f7c'), gone: false });
    await control.reconciled();
    expect(await pods()).toEqual(['shop-blue-5d8f7c-early']);
  });

  test('构建 Job：它的 Pod 由记录认领，跑起来是运行中；结束时资源中心记下结果，Job 被 TTL 删掉之后仍是已结束', async () => {
    const record = await resources.api.owner('release').declare({ kind: 'build-job', ref: 'rel-9/build', projectId: PROJECT, spec: { children: [{ kind: 'Job', namespace: 'cs-demo', name: 'build-rel9' }] }, display: { releaseId: 'rel-9', tag: 'v0.9.0' } });
    const job = (status: Record<string, unknown>): K8sObject => ({ ...child('Job', 'build-rel9', 'uid-build-rel9'), apiVersion: 'batch/v1', status });
    const builder: K8sObject = { ...pod('build-rel9-x7k2p', { 'crewstation.io/release': 'rel-9' }), metadata: { ...pod('build-rel9-x7k2p').metadata, ownerReferences: [{ apiVersion: 'batch/v1', kind: 'Job', name: 'build-rel9', uid: 'uid-build-rel9', controller: true }] } };
    await feed.emit({ kind: 'Job', object: job({ active: 1 }), gone: false });
    await feed.emit({ kind: 'Pod', object: builder, gone: false });
    await until('运行中', async () => (await resources.api.get(record.id))?.phase === 'ready');
    expect((await resources.api.get(record.id))?.children.map((entry) => `${entry.kind}/${entry.name}`).sort()).toEqual(['Job/build-rel9', 'Pod/build-rel9-x7k2p']);
    await feed.emit({ kind: 'Job', object: job({ succeeded: 1, conditions: [{ type: 'Complete', status: 'True' }] }), gone: false });
    await until('已完成', async () => (await resources.api.get(record.id))?.phase === 'stopped');
    expect((await resources.api.get(record.id))?.reason).toEqual({ code: 'completed', message: '已完成' });
    // Kubernetes 的 TTL 删掉 Job 与 Pod：结果留在台账里。
    await feed.emit({ kind: 'Pod', object: builder, gone: true });
    await feed.emit({ kind: 'Job', object: job({ succeeded: 1 }), gone: true });
    await control.reconciled();
    expect(await resources.api.get(record.id)).toMatchObject({ phase: 'stopped', desired: 'present', reason: { code: 'completed' } });
    expect((await resources.api.get(record.id))?.children.map((entry) => `${entry.kind}/${entry.phase}`)).toEqual(['Job/absent']);
  });

  // RFC-025 第三期后半：路由的建与改由调和器按期望应用（设计 §7.1：网关写期望、调和器应用）。
  test('路由：IngressRoute 缺了按期望建出，被人改了改回，与期望一致不写；期望不完整、系统命名空间的不碰；不要了的删掉', async () => {
    type Route = K8sObject & { spec: { entryPoints?: string[]; routes: Array<Record<string, unknown>> } };
    const gateway = resources.api.owner('gateway');
    const chain = [{ name: 'drop-identity-headers', namespace: 'crewstation-system' }, { name: 'forward-auth-user', namespace: 'crewstation-system' }];
    const spec = (name: string, namespace = 'cs-demo', extra: Record<string, unknown> = {}) => ({
      children: [{ kind: 'IngressRoute', namespace, name }], service: 'shop', host: `${name}.cs.localhost`, target: { namespace: 'cs-demo', service: 'shop-blue', port: 80 }, middlewares: chain, ...extra,
    });
    const record = await gateway.declare({ kind: 'route', ref: 'svc-shop/prod', projectId: PROJECT, spec: spec('shop-prod') });
    await until('路由运行中', async () => (await resources.api.get(record.id))?.phase === 'ready');
    const created = await k8s.get<Route>(Resources.IngressRoute!, 'shop-prod', 'cs-demo');
    expect(created?.spec).toEqual({ entryPoints: ['web'], routes: [{ match: 'Host(`shop-prod.cs.localhost`)', kind: 'Rule', services: [{ name: 'shop-blue', port: 80, namespace: 'cs-demo' }], middlewares: chain }] });
    expect(created?.metadata.labels).toEqual({ 'app.kubernetes.io/managed-by': 'crewstation', 'crewstation.io/service': 'shop', 'app.kubernetes.io/component': 'route' });
    // 与期望一致：展示字段变了、再核对几轮也不写。
    await gateway.declare({ kind: 'route', ref: 'svc-shop/prod', projectId: PROJECT, spec: spec('shop-prod'), display: { role: 'prod' } });
    await control.reconciled();
    expect(routeApplies).toEqual(['missing:shop-prod']);
    // 被人改了目标（generation 随之加一，观测变了）：改回。
    const drifted: Route = { ...created!, metadata: { ...created!.metadata, generation: 2 }, spec: { ...created!.spec, routes: [{ ...created!.spec.routes[0], services: [{ name: 'shop-green', port: 80, namespace: 'cs-demo' }] }] } };
    await k8s.apply(drifted);
    await feed.emit({ kind: 'IngressRoute', object: drifted, gone: false });
    await until('改回', () => routeApplies.length === 2);
    expect(routeApplies[1]).toBe('drift:shop-prod');
    expect((await k8s.get<Route>(Resources.IngressRoute!, 'shop-prod', 'cs-demo'))?.spec.routes[0]?.['services']).toEqual([{ name: 'shop-blue', port: 80, namespace: 'cs-demo' }]);
    // 引用的项目中间件还没建出来：线上那一版不动，等中间件出现后再建（T10：限流中间件由限流记录渲染，可能晚一步）。
    const waiting = await gateway.declare({ kind: 'route', ref: 'svc-shop/service', projectId: PROJECT, spec: spec('shop-service', 'cs-demo', { middlewares: [...chain, { name: 'rate-limit-source' }] }) });
    await until('调和器在等中间件', () => debugs.includes('resource route waiting for middleware'));
    expect(await k8s.get(Resources.IngressRoute!, 'shop-service', 'cs-demo')).toBeUndefined();
    await place({ ...child('Middleware', 'rate-limit-source'), apiVersion: 'traefik.io/v1alpha1' });
    await until('中间件出现后建出路由', async () => (await resources.api.get(waiting.id))?.phase === 'ready');
    expect(routeApplies).toContain('missing:shop-service');
    // 期望不完整、在系统命名空间：不渲染。
    await gateway.declare({ kind: 'route', ref: 'svc-shop/broken', projectId: PROJECT, spec: spec('shop-broken', 'cs-demo', { target: { namespace: 'cs-demo' } }) });
    await gateway.declare({ kind: 'route', ref: 'svc-shop/system', projectId: PROJECT, spec: spec('shop-system', 'crewstation-system') });
    await control.reconciled();
    expect(routeApplies).toHaveLength(3);
    // 不要了：IngressRoute 删掉，记录进入已结束。
    await gateway.requestRelease(record.id, { code: 'route-retired', message: '不再需要这条路由' });
    await until('路由删掉', async () => (await resources.api.get(record.id))?.phase === 'stopped');
    expect(removals).toContain('IngressRoute/shop-prod');
    expect(routeApplies).toHaveLength(3);
  });

  // RFC-025 T10：限流策略的 Middleware 由调和器照记录渲染；系统命名空间里的（平台接口）带资源 ID 标签，照常观测与回收。
  test('限流策略：中间件缺了按期望建出（含系统命名空间里的），都在即运行中；被人改了改回；与期望一致不写；不要了的删掉', async () => {
    type Middleware = K8sObject & { spec: Record<string, unknown> };
    const gateway = resources.api.owner('gateway');
    const middlewares = [
      { namespace: 'cs-demo', name: 'rate-limit-user', rateLimit: { average: 30, burst: 60, key: { header: 'x-cs-user-id' } } },
      { namespace: 'crewstation-system', name: 'in-flight-platform-api', inFlight: { amount: 16, key: { header: 'x-cs-user-id' } } },
    ];
    const spec = { children: middlewares.map((entry) => ({ kind: 'Middleware', namespace: entry.namespace, name: entry.name })), middlewares };
    const record = await gateway.declare({ kind: 'rate-limit-policy', ref: 'policy-test', projectId: PROJECT, spec });
    await until('策略运行中', async () => (await resources.api.get(record.id))?.phase === 'ready');
    const user = await k8s.get<Middleware>(Resources.Middleware!, 'rate-limit-user', 'cs-demo');
    expect(user?.spec).toEqual({ rateLimit: { average: 30, burst: 60, period: '1s', sourceCriterion: { requestHeaderName: 'x-cs-user-id' } } });
    expect(user?.metadata.labels?.['crewstation.io/resource-id']).toBe(record.id);
    expect((await k8s.get<Middleware>(Resources.Middleware!, 'in-flight-platform-api', 'crewstation-system'))?.spec).toEqual({ inFlightReq: { amount: 16, sourceCriterion: { requestHeaderName: 'x-cs-user-id' } } });
    const applies = routeApplies.filter((entry) => entry.includes('/')).length;
    expect(applies).toBe(2);
    // 与期望一致：再核对也不写。
    await gateway.declare({ kind: 'rate-limit-policy', ref: 'policy-test', projectId: PROJECT, spec, display: { scope: 'project' } });
    await control.reconciled();
    expect(routeApplies.filter((entry) => entry.includes('/'))).toHaveLength(2);
    // 被人把平均改大了（generation 加一）：改回。
    const drifted: Middleware = { ...user!, metadata: { ...user!.metadata, generation: 2 }, spec: { rateLimit: { average: 9999, burst: 9999, period: '1s', sourceCriterion: { requestHeaderName: 'x-cs-user-id' } } } };
    await k8s.apply(drifted);
    await feed.emit({ kind: 'Middleware', object: drifted, gone: false });
    await until('改回', () => routeApplies.filter((entry) => entry.includes('/')).length === 3);
    expect((await k8s.get<Middleware>(Resources.Middleware!, 'rate-limit-user', 'cs-demo'))?.spec).toMatchObject({ rateLimit: { average: 30 } });
    // 期望不完整（缺桶的取值）：整条不渲染。
    await gateway.declare({ kind: 'rate-limit-policy', ref: 'policy-broken', projectId: PROJECT, spec: { children: [{ kind: 'Middleware', namespace: 'cs-demo', name: 'rate-limit-broken' }], middlewares: [{ namespace: 'cs-demo', name: 'rate-limit-broken' }] } });
    await control.reconciled();
    expect(await k8s.get(Resources.Middleware!, 'rate-limit-broken', 'cs-demo')).toBeUndefined();
    expect(routeApplies.filter((entry) => entry.includes('/'))).toHaveLength(3);
    // 不要了：两个中间件都删掉（系统命名空间里的也删，它带资源 ID 标签），记录进入已结束。
    await gateway.requestRelease(record.id, { code: 'project-archived', message: '项目已归档' });
    await until('中间件删掉', async () => (await resources.api.get(record.id))?.phase === 'stopped');
    expect(removals).toEqual(expect.arrayContaining(['Middleware/rate-limit-user', 'Middleware/in-flight-platform-api']));
  });

  // RFC-025 设计 §7.4：身份索引改读观测缓存，全平台只剩这一条 Pod watch。
  test('观测到的 Pod 交给身份索引：平台组件也在内、消失照报；首次全量同步后交一次全部 Pod；身份索引失败不耽误台账观测', async () => {
    await until('首次全量交过', () => relisted.length === 1);
    const before = podEvents.length;
    const platformPod = pod('cs-mcp-1');
    await feed.emit({ kind: 'Pod', object: { ...platformPod, metadata: { ...platformPod.metadata, namespace: 'crewstation-system' } }, gone: false });
    await feed.emit({ kind: 'Pod', object: pod('task-identity'), gone: true });
    expect(podEvents.slice(before)).toEqual(['crewstation-system/cs-mcp-1:present', 'cs-demo/task-identity:gone']);
    const record = await resources.api.owner('task-runtime').declare({ kind: 'dev-workspace', ref: 'identity-broken', projectId: PROJECT, spec: { children: [{ kind: 'Pod', namespace: 'cs-demo', name: 'pod-identity-broken' }] } });
    await feed.emit({ kind: 'Pod', object: pod('pod-identity-broken'), gone: false });
    expect((await resources.api.get(record.id))?.children[0]).toMatchObject({ name: 'pod-identity-broken', phase: 'Running' });
    expect(relisted).toHaveLength(1);
  });

  test('崩溃重启的到期复核：成立时按最近一次退出满 10 分钟约下一次核对，到时不再重启就撤掉', async () => {
    const slot = await resources.api.owner('release').declare({ kind: 'service-slot', ref: 'svc-shop/green', projectId: PROJECT, spec: { children: [{ kind: 'Deployment', namespace: 'cs-demo', name: 'shop-green' }] } });
    const exited = new Date('2026-09-24T01:00:00.000Z');
    feed.cache.set('Pod/cs-demo/shop-green-5d8f7c-b1', replica('shop-green-5d8f7c-b1', 4, exited.toISOString(), 'shop-green-5d8f7c'));
    const queued: [string, number | undefined][] = [];
    const at = (ms: number) => ({ ledger, feed, cluster, clock: { now: () => new Date(exited.getTime() + ms) }, systemNamespace: 'crewstation-system', stats: newObservationStats(), logger: noopLogger });
    await reconcileRecord(at(120_000), slot.id, (id, afterMs) => { queued.push([id, afterMs]); });
    expect(queued).toEqual([[slot.id, CRASH_LOOP_WINDOW_MS - 120_000]]);
    expect((await resources.api.get(slot.id))?.conditions.find((entry) => entry.type === 'CrashLooping')?.status).toBe('true');
    await reconcileRecord(at(CRASH_LOOP_WINDOW_MS), slot.id, (id, afterMs) => { queued.push([id, afterMs]); });
    expect(queued).toHaveLength(1);
    expect((await resources.api.get(slot.id))?.conditions.find((entry) => entry.type === 'CrashLooping')?.status).toBe('false');
    feed.cache.delete('Pod/cs-demo/shop-green-5d8f7c-b1');
  });
});
