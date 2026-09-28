import { precondition } from '@crewstation/kernel';

/** Stable within one validated backup: all permitted replays write exactly the same bytes. */
export function restoredObjectLocation(backupId: string, object: { id: string; backendId: string; placementRevision: number; sha256: string }, placements: readonly { backendId: string; sourceRevision: number; targetRevision: number }[]) {
  const placement = placements.find((p) => p.backendId === object.backendId && p.sourceRevision === object.placementRevision);
  if (!placement) throw precondition('恢复目标未覆盖对象位置');
  return { backendId: object.backendId, placementRevision: placement.targetRevision, key: `restores/${backupId}/${object.id}/${object.sha256}` };
}
