import type { ClusterResource } from '@crewstation/contracts';
import type { ResourceObject } from './inventory';
import { objectArray, objectRecord } from './inventory';

/** A PV belongs to a managed claim only when both directions and the claim UID agree. */
export function boundClaim(volume: ResourceObject, objects: ReadonlyMap<string, ResourceObject>): ResourceObject | undefined {
  const ref = objectRecord(objectRecord(volume.spec).claimRef);
  const claim = objects.get(`${String(ref.namespace)}/PersistentVolumeClaim/${String(ref.name)}`);
  return claim && typeof ref.uid === 'string' && claim.metadata.uid === ref.uid && objectRecord(claim.spec).volumeName === volume.metadata.name ? claim : undefined;
}

/** Whitelist mount metadata; never project volume sources, credentials or host paths. */
export function storageMounts(obj: ResourceObject): NonNullable<ClusterResource['mounts']> {
  const spec = objectRecord(obj.spec), template = obj.kind === 'CronJob' ? objectRecord(objectRecord(spec.jobTemplate).spec) : spec;
  const pod = obj.kind === 'Pod' ? spec : objectRecord(objectRecord(template.template).spec);
  const claims = new Map(objectArray(pod.volumes).map((v) => [v.name, objectRecord(v.persistentVolumeClaim).claimName]));
  return ['containers', 'initContainers'].flatMap((key) => objectArray(pod[key]).flatMap((c) => objectArray(c.volumeMounts).flatMap((m) => {
    const claimName = claims.get(m.name);
    return typeof claimName === 'string' && typeof m.mountPath === 'string' ? [{ claimName, container: String(c.name), mountPath: m.mountPath, readOnly: m.readOnly === true, init: key === 'initContainers', ...(typeof m.subPath === 'string' ? { subPath: m.subPath } : {}), ...(typeof m.subPathExpr === 'string' ? { subPathExpr: m.subPathExpr } : {}) }] : [];
  })));
}

export function storageFacts(obj: ResourceObject): Record<string, string> {
  const spec = objectRecord(obj.spec);
  if (obj.kind === 'PersistentVolumeClaim') return { volumeName: String(spec.volumeName ?? ''), accessModes: Array.isArray(spec.accessModes) ? spec.accessModes.join(', ') : '' };
  if (obj.kind !== 'PersistentVolume') return {};
  const ref = objectRecord(spec.claimRef);
  return { capacity: JSON.stringify(objectRecord(spec.capacity)), storageClass: String(spec.storageClassName ?? 'default'), reclaimPolicy: String(spec.persistentVolumeReclaimPolicy ?? ''), claimUid: String(ref.uid ?? ''), claim: `${String(ref.namespace ?? '')}/${String(ref.name ?? '')}` };
}
