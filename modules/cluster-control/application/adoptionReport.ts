import type { AdoptionItem, AdoptionReport, AdoptionVerdict } from '@crewstation/contracts';
import type { Clock } from '@crewstation/kernel';
import type { LegacyTask } from '../domain/adoption';
import { classifyObject, countVerdicts } from '../domain/adoption';
import type { ObservedObject } from '../domain/observation';
import type { ManagedObjectReader } from '../ports/cluster';
import type { LedgerObservations, LegacyOwners } from '../ports/ledger';

export interface AdoptionDeps {
  readonly reader: ManagedObjectReader;
  readonly ledger: LedgerObservations;
  readonly legacy: LegacyOwners;
  readonly clock: Clock;
}

const ORDER: readonly AdoptionVerdict[] = ['orphan', 'retained', 'adoptable', 'unclassified', 'owned'];
const MAX_ITEMS = 500;

function sortItems(items: AdoptionItem[]): AdoptionItem[] {
  return items.sort((a, b) => ORDER.indexOf(a.verdict) - ORDER.indexOf(b.verdict) || (a.namespace ?? '').localeCompare(b.namespace ?? '') || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}

/**
 * 收编空跑（设计 §6.5，第一期只报告不改动）：列出集群里全部受管 Pod 与 PVC，逐个判定归属与将来的处理。
 * 同一个任务环境只查一次；计数覆盖全部对象，明细最多 500 条（孤儿与保留中的排在前面）。
 */
export async function adoptionReport(deps: AdoptionDeps): Promise<AdoptionReport> {
  const objects: ObservedObject[] = [...(await deps.reader.list('Pod')), ...(await deps.reader.list('PersistentVolumeClaim'))];
  const tasks = new Map<string, Promise<LegacyTask | 'missing'>>();
  const taskOf = (taskId: string) => {
    if (!tasks.has(taskId)) tasks.set(taskId, deps.legacy.task(taskId).then((task) => task ?? 'missing'));
    return tasks.get(taskId)!;
  };
  const items: AdoptionItem[] = [];
  for (const object of objects) {
    const identity = { kind: object.kind, ...(object.metadata.namespace ? { namespace: object.metadata.namespace } : {}), name: object.metadata.name, ...(object.metadata.uid ? { uid: object.metadata.uid } : {}) };
    const claimedBy = await deps.ledger.claimOf(identity);
    const taskId = object.metadata.labels?.['crewstation.io/task'];
    const legacyTask = !claimedBy && taskId ? await taskOf(taskId) : undefined;
    items.push(classifyObject({ object, ...(claimedBy ? { claimedBy } : {}), ...(legacyTask ? { legacyTask } : {}) }));
  }
  return { generatedAt: deps.clock.now().toISOString(), dryRun: true, counts: countVerdicts(items), items: sortItems(items).slice(0, MAX_ITEMS) };
}
