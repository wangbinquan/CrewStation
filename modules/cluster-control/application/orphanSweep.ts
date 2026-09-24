import type { Clock, Logger } from '@crewstation/kernel';
import type { ObservedObject } from '../domain/observation';
import type { ClusterWriter, ManagedObjectFeed, ObservedKind } from '../ports/cluster';
import type { LedgerObservations, LegacyOwners } from '../ports/ledger';
import type { ObservationStats } from './observeChange';

const TASK_LABEL = 'crewstation.io/task';
const SWEPT: readonly ObservedKind[] = ['Pod', 'Secret', 'Service', 'IngressRoute', 'PersistentVolumeClaim'];
/** 任务环境还在（失败保留中的也算）：这时它的台账记录应该在，还没在就是台账没跟上，等补投影。 */
const LIVE_TASK_STATES: readonly string[] = ['creating', 'running', 'paused', 'releasing', 'failed'];

export interface SweepDeps {
  readonly feed: ManagedObjectFeed;
  readonly ledger: LedgerObservations;
  readonly legacy: LegacyOwners;
  readonly cluster: ClusterWriter;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly stats: ObservationStats;
  /** 建出来不满这么久的对象不判孤儿：避开「对象先建、记录后到」的空档。 */
  readonly minAgeMs: number;
  /** 平台组件所在的系统命名空间：那里的中间件不在回收范围。 */
  readonly systemNamespace?: string;
}

export interface SweepResult {
  removed: number;
  volumes: number;
}

const identityOf = (object: ObservedObject) => ({ kind: object.kind, ...(object.metadata.namespace ? { namespace: object.metadata.namespace } : {}), name: object.metadata.name, ...(object.metadata.uid ? { uid: object.metadata.uid } : {}) });

/**
 * 孤儿（设计 §6.4、D8）：带任务标签、建出来有一阵子了、台账里没有记录认领、它的任务环境要么已不在（已释放或查不到），
 * 要么在台账里有记录却不列它（重建换下的旧 Runner Secret、RFC-013 改名前留下的同 Host 预览路由）。
 * 任务环境还在而台账里没有它的记录时不判——那是台账没跟上。旧标签上的 `tsk_…` 先经身份目录换成现 ID。
 */
async function isOrphan(deps: SweepDeps, object: ObservedObject, taskOf: (label: string) => Promise<{ readonly id: string; readonly live: boolean }>): Promise<boolean> {
  const label = object.metadata.labels?.[TASK_LABEL];
  if (!label || !object.metadata.uid || object.metadata.deletionTimestamp) return false;
  if (!ageOk(deps, object)) return false;
  if (await deps.ledger.claimOf(identityOf(object))) return false;
  const task = await taskOf(label);
  return !task.live || (await deps.ledger.get(task.id)) !== undefined;
}

const ageOk = (deps: SweepDeps, object: ObservedObject): boolean => {
  const created = Date.parse(object.metadata.creationTimestamp ?? '');
  return !Number.isNaN(created) && deps.clock.now().getTime() - created >= deps.minAgeMs;
};

type Fields = Readonly<Record<string, unknown>>;
const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);

/** 观测缓存里所有 IngressRoute 引用的中间件（`命名空间/名字`；没写命名空间的是路由自己的命名空间）。 */
function referencedMiddlewares(feed: ManagedObjectFeed): Set<string> {
  const referenced = new Set<string>();
  for (const route of feed.list('IngressRoute')) {
    const routes = isFields(route.spec) && Array.isArray(route.spec['routes']) ? route.spec['routes'] : [];
    for (const entry of routes) {
      const chain = isFields(entry) && Array.isArray(entry['middlewares']) ? entry['middlewares'] : [];
      for (const middleware of chain) {
        if (!isFields(middleware) || typeof middleware['name'] !== 'string') continue;
        referenced.add(`${typeof middleware['namespace'] === 'string' ? middleware['namespace'] : route.metadata.namespace ?? ''}/${middleware['name']}`);
      }
    }
  }
  return referenced;
}

/**
 * 没有任务标签的中间件（设计 §6.4 的孤儿不限任务标签）：前缀剥离中间件由内部 API 路由记录认领、限流中间件由限流策略记录认领之后，
 * 项目命名空间里既没有记录认领、又没有任何路由引用、建出满一阵子的，是代理改名或不再暴露内部 API 后留下的，按 UID 删。
 */
async function sweepMiddlewares(deps: SweepDeps, result: SweepResult): Promise<void> {
  const referenced = referencedMiddlewares(deps.feed);
  for (const object of deps.feed.list('Middleware')) {
    const namespace = object.metadata.namespace ?? '';
    if (!object.metadata.uid || object.metadata.deletionTimestamp || object.metadata.labels?.[TASK_LABEL] || namespace === deps.systemNamespace || !namespace) continue;
    if (!ageOk(deps, object) || referenced.has(`${namespace}/${object.metadata.name}`) || (await deps.ledger.claimOf(identityOf(object)))) continue;
    await deps.cluster.remove({ kind: 'Middleware', namespace, name: object.metadata.name, uid: object.metadata.uid });
    result.removed += 1;
    deps.stats.removed += 1;
    deps.logger.info('resource orphan removed', { kind: 'Middleware', namespace, name: object.metadata.name, reason: 'unreferenced' });
  }
}

/** 命名空间属于哪个项目：认领 Namespace 对象的命名空间记录（provisioning 写的）上的项目；查不到就不归项目。 */
async function projectOfNamespace(ledger: LedgerObservations, namespace: string | undefined): Promise<string | undefined> {
  const id = namespace ? await ledger.claimOf({ kind: 'Namespace', name: namespace }) : undefined;
  const record = id ? await ledger.get(id) : undefined;
  return record?.kind === 'namespace' ? record.projectId : undefined;
}

/**
 * 一轮孤儿回收：Pod、Secret、Service、路由按 UID 删；PVC 可能有数据，不删，建一条归资源中心的工作卷记录并写「待回收」，
 * 等管理员确认。每删一个、每登记一个都记一行日志（谁、哪个对象、归属的任务）。
 */
export async function sweepOrphans(deps: SweepDeps): Promise<SweepResult> {
  const result: SweepResult = { removed: 0, volumes: 0 };
  const tasks = new Map<string, Promise<{ readonly id: string; readonly live: boolean }>>();
  const taskOf = (label: string) => {
    if (!tasks.has(label)) tasks.set(label, (async () => {
      const id = label.startsWith('tsk_') ? (await deps.legacy.resolveTaskId(label)) ?? label : label;
      const task = await deps.legacy.task(id);
      return { id, live: !!task && LIVE_TASK_STATES.includes(task.state) };
    })());
    return tasks.get(label)!;
  };
  for (const kind of SWEPT) {
    for (const object of deps.feed.list(kind)) {
      if (!(await isOrphan(deps, object, taskOf))) continue;
      const identity = identityOf(object), taskId = object.metadata.labels?.[TASK_LABEL];
      if (kind === 'PersistentVolumeClaim') {
        const projectId = await projectOfNamespace(deps.ledger, identity.namespace);
        await deps.ledger.adoptOrphanVolume({ ...identity, uid: object.metadata.uid!, ...(projectId ? { projectId } : {}) });
        result.volumes += 1;
        deps.logger.info('resource orphan volume registered', { namespace: identity.namespace, name: identity.name, taskId });
        continue;
      }
      await deps.cluster.remove({ kind, ...(identity.namespace ? { namespace: identity.namespace } : {}), name: identity.name, uid: object.metadata.uid! });
      result.removed += 1;
      deps.stats.removed += 1;
      deps.logger.info('resource orphan removed', { kind, namespace: identity.namespace, name: identity.name, taskId });
    }
  }
  await sweepMiddlewares(deps, result);
  return result;
}
