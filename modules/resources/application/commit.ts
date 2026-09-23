import { jsonHash } from '@crewstation/kernel';
import type { LedgerRecord } from '../domain/record';
import { childKey, inKeyOrder, isPresent, mergeChildren } from '../domain/record';
import { settlePhase } from '../domain/phase';
import type { LedgerScope, StoredChild } from '../ports/repositories';

/** 比较两条记录的实质内容：版本号与更新时间不算；对象键的顺序不算（jsonb 读回来会重排），子对象的先后也不算。 */
function substance(record: LedgerRecord): string {
  const { version: _version, updatedAt: _updatedAt, children, ...rest } = record;
  return jsonHash({ ...rest, children: inKeyOrder(children, childKey) });
}

function storedChildren(record: LedgerRecord): StoredChild[] {
  const expected = new Set(record.spec.children.map(childKey));
  return record.children.map((child) => ({ child, expected: expected.has(childKey(child)) }));
}

const storedHash = (record: LedgerRecord): string => jsonHash(inKeyOrder(storedChildren(record), (stored) => childKey(stored.child)));

/**
 * 子对象的收束：要的时候，期望里的每一个都在（没观测到的记 absent），换下的旧对象留到观测到它消失；
 * 不要了的时候，只留还在的（全都回收了阶段就是「已结束」，名字随即释放）。
 */
export function settleChildren(record: LedgerRecord): LedgerRecord {
  const next = record.desired === 'absent' ? record.children.filter(isPresent) : mergeChildren(record.spec.children, record.children);
  return jsonHash(inKeyOrder(next, childKey)) === jsonHash(inKeyOrder(record.children, childKey)) ? record : { ...record, children: next };
}

/**
 * 台账的唯一写入口（设计 §3 写入规则）：收束子对象与阶段；与上一版实质相同就不写；
 * 否则版本加一、写记录与子对象、追加一行变更日志——同一事务里完成。
 */
export async function commitRecord(scope: LedgerScope, previous: LedgerRecord | undefined, draft: LedgerRecord, now: Date): Promise<LedgerRecord> {
  const settled = settlePhase(settleChildren(draft), now);
  if (previous && substance(previous) === substance(settled)) return previous;
  const saved: LedgerRecord = { ...settled, version: (previous?.version ?? 0) + 1, updatedAt: now };
  if (previous) await scope.records.update(saved);
  else await scope.records.insert(saved);
  if (!previous || storedHash(previous) !== storedHash(saved)) await scope.records.replaceChildren(saved.id, storedChildren(saved));
  await scope.changes.append({ ...(saved.projectId ? { projectId: saved.projectId } : {}), resourceId: saved.id, version: saved.version, change: 'upsert' });
  return saved;
}
