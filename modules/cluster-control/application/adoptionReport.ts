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
  readonly systemNamespace: string;
}

const ORDER: readonly AdoptionVerdict[] = ['orphan', 'retained', 'adoptable', 'unclassified', 'owned', 'platform'];
const MAX_ITEMS = 500;

function sortItems(items: AdoptionItem[]): AdoptionItem[] {
  return items.sort((a, b) => ORDER.indexOf(a.verdict) - ORDER.indexOf(b.verdict) || (a.namespace ?? '').localeCompare(b.namespace ?? '') || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}

/**
 * 收编空跑（设计 §6.5，只报告不改动）：列出集群里全部受管 Pod 与 PVC，以及带任务标签的 Runner Secret、预览 Service 与路由
 * （第二期起台账认领它们；不带任务标签的 Secret、Service、路由属于服务槽与构建，第三期再列），逐个判定归属与将来的处理。
 * 同一个任务环境只查一次；计数覆盖全部对象，明细最多 500 条（孤儿与保留中的排在前面）。
 */
export async function adoptionReport(deps: AdoptionDeps): Promise<AdoptionReport> {
  const taskScoped = async (kind: 'Secret' | 'Service' | 'IngressRoute') => (await deps.reader.list(kind)).filter((object) => object.metadata.labels?.['crewstation.io/task']);
  const objects: ObservedObject[] = [...(await deps.reader.list('Pod')), ...(await deps.reader.list('PersistentVolumeClaim')), ...(await taskScoped('Secret')), ...(await taskScoped('Service')), ...(await taskScoped('IngressRoute'))];
  const tasks = new Map<string, Promise<{ readonly id: string; readonly task: LegacyTask | 'missing' }>>();
  // 旧对象上的任务标签可能还是 RFC-013 之前的 tsk_…：先经身份目录换成现在的 ID，否则活着的会话会被判成孤儿。
  const lookup = async (label: string) => {
    const id = label.startsWith('tsk_') ? (await deps.legacy.resolveTaskId(label)) ?? label : label;
    return { id, task: (await deps.legacy.task(id)) ?? ('missing' as const) };
  };
  const taskOf = (label: string) => {
    if (!tasks.has(label)) tasks.set(label, lookup(label));
    return tasks.get(label)!;
  };
  const items: AdoptionItem[] = [];
  const now = deps.clock.now();
  for (const object of objects) {
    const identity = { kind: object.kind, ...(object.metadata.namespace ? { namespace: object.metadata.namespace } : {}), name: object.metadata.name, ...(object.metadata.uid ? { uid: object.metadata.uid } : {}) };
    const claimedBy = await deps.ledger.claimOf(identity);
    const label = object.metadata.labels?.['crewstation.io/task'];
    const legacy = !claimedBy && label ? await taskOf(label) : undefined;
    items.push(classifyObject({
      object, systemNamespace: deps.systemNamespace, now, ...(claimedBy ? { claimedBy } : {}),
      ...(legacy ? { legacyTask: legacy.task, ...(legacy.id !== label ? { legacyTaskId: legacy.id } : {}) } : {}),
    }));
  }
  return { generatedAt: deps.clock.now().toISOString(), dryRun: true, counts: countVerdicts(items), items: sortItems(items).slice(0, MAX_ITEMS) };
}
