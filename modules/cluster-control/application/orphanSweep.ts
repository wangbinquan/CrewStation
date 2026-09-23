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
  const created = Date.parse(object.metadata.creationTimestamp ?? '');
  if (Number.isNaN(created) || deps.clock.now().getTime() - created < deps.minAgeMs) return false;
  if (await deps.ledger.claimOf(identityOf(object))) return false;
  const task = await taskOf(label);
  return !task.live || (await deps.ledger.get(task.id)) !== undefined;
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
        await deps.ledger.adoptOrphanVolume({ ...identity, uid: object.metadata.uid! });
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
  return result;
}
