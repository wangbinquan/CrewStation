import type { ClusterResource } from '@crewstation/contracts';

/** Resolve one physical controller chain using immutable owner UIDs. */
export function physicalWorkloadOwner(resource: ClusterResource, resources: readonly ClusterResource[]) {
  let current = resource;
  const seen = new Set<string>();
  for (let i = 0; i < 8 && !seen.has(current.uid); i++) {
    seen.add(current.uid);
    if (['Deployment', 'Job'].includes(current.kind)) return current;
    const owners = resources.filter((r) => current.owners.some((owner) => owner.uid === r.uid));
    if (owners.length !== 1) return undefined;
    current = owners[0]!;
  }
  return undefined;
}
