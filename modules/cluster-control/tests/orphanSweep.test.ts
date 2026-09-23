import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { ProjectId } from '@crewstation/contracts';
import type { K8sObject } from '@crewstation/k8s';
import { noopLogger } from '@crewstation/kernel';
import type { ResourcesModule } from '@crewstation/module-resources';
import { createResourcesModule, resourcesMigrations } from '@crewstation/module-resources';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { newObservationStats } from '../application/observeChange';
import { sweepOrphans } from '../application/orphanSweep';
import type { LegacyTask } from '../domain/adoption';
import type { ManagedObjectFeed, ObservedKind } from '../ports/cluster';
import type { LedgerObservations } from '../ports/ledger';
import { orphanSweeper } from '../workers/orphanSweeper';

const available = await testDatabaseAvailable();
const PROJECT = '01a0bf5d-8f4b-7c01-8e19-e226732a75a4' as ProjectId;
const LIVE = '01a0bf5d-8f4b-7c01-8e19-e226732a7a01', LATE = '01a0bf5d-8f4b-7c01-8e19-e226732a7a02', RELEASED = '01a0bf5d-8f4b-7c01-8e19-e226732a7a03';
const now = new Date('2026-09-23T12:00:00.000Z'), hourAgo = '2026-09-23T11:00:00Z';
const object = (kind: string, name: string, task: string | undefined, extra: Partial<K8sObject['metadata']> = {}): K8sObject => ({
  apiVersion: kind === 'IngressRoute' ? 'traefik.io/v1alpha1' : 'v1', kind,
  metadata: { name, namespace: 'cs-demo', uid: `uid-${name}`, creationTimestamp: hourAgo, labels: { 'app.kubernetes.io/managed-by': 'crewstation', ...(task ? { 'crewstation.io/task': task } : {}) }, ...extra },
});

describe.skipIf(!available)('孤儿回收（RFC-025 设计 §6.4、D8）', () => {
  let database: TestDatabase;
  let resources: ResourcesModule;
  let ledger: LedgerObservations;
  const tasks = new Map<string, LegacyTask>([[LIVE, { kind: 'dev-session', state: 'running', execution: false }], [LATE, { kind: 'dev-session', state: 'running', execution: false }], [RELEASED, { kind: 'business', state: 'released', execution: false }]]);
  const objects: K8sObject[] = [];
  const feed: ManagedObjectFeed = { start: () => undefined, stop: async () => undefined, synced: async () => undefined, cached: () => undefined, list: (kind: ObservedKind) => objects.filter((o) => o.kind === kind) };
  const removed: string[] = [];

  beforeAll(async () => {
    database = await createTestDatabase([resourcesMigrations]);
    resources = createResourcesModule({ db: database.db, quotas: { limitFor: async () => 4 }, authorizer: { projectAccess: async () => ({ operate: true }) }, isAdmin: async () => true });
    ledger = {
      observe: (input) => resources.api.observe(input), claimOf: (child) => resources.api.claimOf(child), get: (id) => resources.api.get(id), listLive: () => resources.api.list({}),
      changesSince: resources.api.changesSince, latestChange: resources.api.latestChange, observeConditions: (id, conditions) => resources.api.observeConditions(id, conditions),
      children: (parentId) => resources.api.list({ parentId, includeStopped: true }),
      adoptOrphanVolume: async (child) => {
        const record = await resources.api.owner('cluster-control').declare({ kind: 'volume', ref: `orphan:${child.namespace ?? ''}/${child.name}`, spec: { children: [{ kind: child.kind, ...(child.namespace ? { namespace: child.namespace } : {}), name: child.name }] } });
        await resources.api.observeConditions(record.id, [{ type: 'PendingReclaim', status: 'true', reason: 'orphaned', message: '孤儿工作卷' }]);
      },
    };
    // 在运行的会话：台账里有它的记录，列着当前的 Pod 与 Runner Secret。
    await resources.api.owner('task-runtime').declare({ id: LIVE, kind: 'dev-workspace', ref: LIVE, projectId: PROJECT, spec: { children: [{ kind: 'Pod', namespace: 'cs-demo', name: 'task-r-new' }, { kind: 'Secret', namespace: 'cs-demo', name: 'task-r-new-runner' }] } });
    objects.push(
      object('Pod', 'task-r-new', LIVE), object('Secret', 'task-r-new-runner', LIVE),
      object('Secret', 'task-r-old-runner', LIVE), object('IngressRoute', 'task-legacy', 'tsk_legacy_live'),
      object('Service', 'task-late', LATE), object('Pod', 'task-gone', RELEASED), object('PersistentVolumeClaim', 'task-gone-work', RELEASED),
      object('Pod', 'task-young', RELEASED, { creationTimestamp: '2026-09-23T11:58:00Z' }), object('Pod', 'task-ending', RELEASED, { deletionTimestamp: '2026-09-23T11:59:00Z' }),
      object('Service', 'demo-green', undefined), object('Secret', 'task-missing-runner', '01a0bf5d-8f4b-7c01-8e19-e226732a7aff'),
    );
  });
  afterAll(async () => { await database.drop(); });

  const deps = () => ({
    feed, ledger, cluster: { remove: async (target: { kind: string; name: string }) => { removed.push(`${target.kind}/${target.name}`); }, applyRoute: async () => 'unchanged' as const, applyMiddleware: async () => 'unchanged' as const }, clock: { now: () => now }, logger: noopLogger, stats: newObservationStats(), minAgeMs: 600_000,
    legacy: { resolveTaskId: async (legacyId: string) => (legacyId === 'tsk_legacy_live' ? LIVE : undefined), task: async (taskId: string) => tasks.get(taskId) },
  });

  test('删的：已释放或查不到的任务留下的、在运行的会话记录里不列的（旧 Runner Secret、改名前的同 Host 路由）；PVC 只登记待回收', async () => {
    const result = await sweepOrphans(deps());
    expect(removed.sort()).toEqual(['IngressRoute/task-legacy', 'Pod/task-gone', 'Secret/task-missing-runner', 'Secret/task-r-old-runner']);
    expect(result).toEqual({ removed: 4, volumes: 1 });
    const volume = (await resources.api.list({ kind: 'volume', includeStopped: true })).find((record) => record.owner.module === 'cluster-control');
    expect(volume).toMatchObject({ owner: { ref: 'orphan:cs-demo/task-gone-work' }, phase: 'stopped', reason: { code: 'orphaned' } });
  });

  test('不动的：台账认领的、建出不满 10 分钟的、删除中的、没有任务标签的、任务还在而台账没跟上的；登记过的孤儿卷下一轮不重复', async () => {
    removed.length = 0;
    const again = await sweepOrphans(deps());
    expect(again.volumes).toBe(0);
    expect(removed.sort()).toEqual(['IngressRoute/task-legacy', 'Pod/task-gone', 'Secret/task-missing-runner', 'Secret/task-r-old-runner']);
    for (const kept of ['task-r-new', 'task-r-new-runner', 'task-young', 'task-ending', 'demo-green', 'task-late']) expect(removed.some((entry) => entry.endsWith(`/${kept}`))).toBe(false);
  });

  test('节奏：同步后先等一阵再做第一轮，此后按周期；失败只记告警；停止时等本轮跑完', async () => {
    let calls = 0;
    const seen: string[] = [];
    const logger = { ...noopLogger, info: (msg: string) => { seen.push(msg); }, warn: (msg: string) => { seen.push(msg); } };
    const worker = orphanSweeper(feed, async () => { calls += 1; if (calls === 2) throw new Error('台账暂时不可用'); return { removed: calls, volumes: 0 }; }, logger, { firstDelayMs: 10, everyMs: 10 });
    worker.start(); worker.start();
    const deadline = Date.now() + 2_000;
    while (calls < 3 && Date.now() < deadline) await Bun.sleep(5);
    await worker.stop();
    expect(calls).toBeGreaterThanOrEqual(3);
    expect(seen).toContain('resource orphan sweep'); expect(seen).toContain('resource orphan sweep failed');
  });
});
