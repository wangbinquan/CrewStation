import type { ResourceChild } from '@crewstation/contracts';
import type { Clock } from '@crewstation/kernel';
import { jsonHash } from '@crewstation/kernel';
import type { ChildObservation, ObservationOutcome } from '../api/types';
import { mergeConditions } from '../domain/conditions';
import type { LedgerRecord } from '../domain/record';
import { childKey, unobservedChild } from '../domain/record';
import type { LedgerScope, LedgerUnitOfWork } from '../ports/repositories';
import { commitRecord } from './commit';

function nextChildren(record: LedgerRecord, observation: ChildObservation): readonly ResourceChild[] | undefined {
  const key = childKey(observation.child);
  const at = record.children.findIndex((child) => childKey(child) === key);
  const current = at >= 0 ? record.children[at] : undefined;
  if (observation.gone) {
    // 同名的新对象已经建起来时，旧实例迟到的删除事件不算数。
    if (!current || (current.uid && observation.child.uid && current.uid !== observation.child.uid)) return undefined;
    const expected = record.spec.children.some((child) => childKey(child) === key);
    const children = [...record.children];
    if (expected) children[at] = unobservedChild(observation.child);
    else children.splice(at, 1);
    return children;
  }
  // 观测内容（除观测时刻外）没变就保留原来的：否则同一个对象每报一次都算变化，按记录核对会自己跟自己转圈。
  if (current && sameObservation(current, observation.child)) return undefined;
  const children = [...record.children];
  if (at >= 0) children[at] = observation.child;
  else children.push(observation.child);
  return children;
}

function sameObservation(a: ResourceChild, b: ResourceChild): boolean {
  const { observedAt: _a, ...left } = a;
  const { observedAt: _b, ...right } = b;
  return jsonHash(left) === jsonHash(right);
}

export async function observeIn(scope: LedgerScope, observation: ChildObservation, now: Date): Promise<ObservationOutcome> {
  const id = observation.resourceId ?? await scope.records.findByChild(observation.child);
  if (!id) return { status: 'unowned' };
  const record = await scope.records.get(id, { forUpdate: true });
  if (!record) return { status: 'unowned' };
  const children = nextChildren(record, observation) ?? record.children;
  const draft: LedgerRecord = { ...record, children, conditions: mergeConditions(record.conditions, observation.conditions ?? [], now) };
  const saved = await commitRecord(scope, record, draft, now);
  return saved === record ? { status: 'unchanged', record } : { status: 'recorded', record: saved };
}

/** 调和器的观测写入口：每条观测一个短事务，同一记录的写入由行锁串行。 */
export function observationWriter(uow: LedgerUnitOfWork, clock: Clock) {
  return {
    observe: (observation: ChildObservation) => uow.run((scope) => observeIn(scope, observation, clock.now())),
  };
}
