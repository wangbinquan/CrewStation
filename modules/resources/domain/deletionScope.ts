import type { ProjectDeletionInventory } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';

/** 原 PVC 的在途供给可首次绑定 PV；已确认的供应器绝不换 UID 或位置。 */
export function compatiblePhysicalScope(expected: ProjectDeletionInventory['resources'], current: ProjectDeletionInventory['resources']): boolean {
  if (expected.length !== current.length) return false;
  return expected.every((original) => {
    const observed = current.find((entry) => entry.id === original.id && entry.kind === original.kind);
    if (!observed || observed.count !== original.count) return false;
    if (original.kind !== 'protected:PVC') return jsonHash(original) === jsonHash(observed);
    const before = JSON.parse(original.identity), after = JSON.parse(observed.identity);
    return before.uid === after.uid && (!before.target || jsonHash(before.target) === jsonHash(after.target));
  });
}
