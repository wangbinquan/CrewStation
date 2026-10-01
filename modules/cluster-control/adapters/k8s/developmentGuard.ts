import { AsyncLocalStorage } from 'node:async_hooks';
import { DEVELOPMENT_REMOVAL_ANNOTATION } from '@crewstation/contracts';
import type { K8sClient } from '@crewstation/k8s';
import { Resources } from '@crewstation/k8s';
import { isPlatformError } from '@crewstation/kernel';
import type { ClusterRemovalTarget, ClusterWriter, DevelopmentRemovalDecision, DevelopmentRemovalQuery } from '../../ports/cluster';

const waiting = (reason: string): DevelopmentRemovalDecision => ({ kind: 'waiting', reason });

interface OwnerQueryScope {
  readonly query: DevelopmentRemovalQuery;
  readonly target: ClusterRemovalTarget;
  readonly operation: 'delete' | 'stop-finalizer';
  active: boolean;
}
const ownerQueryScope = new AsyncLocalStorage<OwnerQueryScope>();
function scopedOwnerQuery(target: ClusterRemovalTarget, operation: OwnerQueryScope['operation']): DevelopmentRemovalQuery | undefined {
  const scope = ownerQueryScope.getStore(), original = scope?.target;
  return scope?.active && scope.operation === operation && original?.kind === target.kind
    && original.namespace === target.namespace && original.name === target.name && original.uid === target.uid
    && original.resourceVersion === target.resourceVersion ? scope.query : undefined;
}
async function delegateWithOwnerQuery<T>(query: DevelopmentRemovalQuery | undefined, target: ClusterRemovalTarget,
  operation: OwnerQueryScope['operation'], delegate: () => Promise<T>): Promise<T> {
  const owner = query ?? scopedOwnerQuery(target, operation);
  if (!owner) return delegate();
  const scope: OwnerQueryScope = { query: owner, target: { ...target }, operation, active: true };
  return ownerQueryScope.run(scope, async () => { try { return await delegate(); } finally { scope.active = false; } });
}

/** Live metadata is recognition only. Task alone validates its original digital/material facts. */
export async function inspectClusterDevelopmentRemoval(k8s: K8sClient, query: DevelopmentRemovalQuery | undefined,
  target: ClusterRemovalTarget, operation: 'delete' | 'stop-finalizer'): Promise<DevelopmentRemovalDecision> {
  if (target.kind !== 'Pod' && target.kind !== 'Secret') return { kind: 'unselected' };
  if (!target.namespace) return waiting('development-removal-namespace-missing');
  try {
    const object = await k8s.get(Resources[target.kind]!, target.name, target.namespace, AbortSignal.timeout(15_000));
    const marker = object?.metadata.annotations?.[DEVELOPMENT_REMOVAL_ANNOTATION];
    if (marker !== undefined && marker !== '1') return waiting('development-removal-marker-conflict');
    const owner = query ?? scopedOwnerQuery(target, operation);
    if (!owner) return marker === undefined ? { kind: 'unselected' } : waiting('development-removal-owner-unavailable');
    const result = await owner({ kind: target.kind, namespace: target.namespace, name: target.name, uid: target.uid, operation });
    if (result.kind === 'unselected' && marker !== undefined) return waiting('development-removal-original-missing');
    if (result.kind === 'permitted') {
      if (!result.resourceVersion || target.resourceVersion !== undefined && result.resourceVersion !== target.resourceVersion) return waiting('development-removal-version-changed');
      return result;
    }
    if (['unselected', 'waiting', 'absent'].includes(result.kind)) return result;
    return waiting('development-removal-invalid-response');
  } catch {
    return waiting('development-removal-inspection-unavailable');
  }
}

/** Injected writers use the same gate. A downstream writer's own refusal is never bypassed. */
export function guardedClusterWriter(base: ClusterWriter, k8s: K8sClient, query?: DevelopmentRemovalQuery): ClusterWriter {
  return { ...base,
    remove: async (target) => {
      const result = await inspectClusterDevelopmentRemoval(k8s, query, target, 'delete');
      if (result.kind === 'waiting') return result;
      if (result.kind === 'absent') return;
      const approved = { ...target, ...(result.kind === 'permitted' ? { resourceVersion: result.resourceVersion } : {}) };
      try { return await (result.kind === 'permitted' ? delegateWithOwnerQuery(query, approved, 'delete', () => base.remove(approved)) : base.remove(approved)); }
      catch (error) { if (result.kind === 'permitted' && isPlatformError(error) && error.kind === 'conflict') return { kind: 'waiting', reason: 'development-removal-version-changed' }; throw error; }
    },
    ...(base.releaseWorkloadStop ? { releaseWorkloadStop: async (proof, version) => {
      const target = { kind: 'Pod' as const, namespace: proof.consumer.namespace, name: proof.consumer.podName, uid: proof.podUid, ...(version !== undefined ? { resourceVersion: version } : {}) };
      const result = await inspectClusterDevelopmentRemoval(k8s, query, target, 'stop-finalizer');
      if (result.kind === 'waiting') return result;
      if (result.kind === 'absent') return;
      const approvedVersion = result.kind === 'permitted' ? result.resourceVersion : version;
      const approved = { ...target, ...(approvedVersion !== undefined ? { resourceVersion: approvedVersion } : {}) };
      try { return await (result.kind === 'permitted' ? delegateWithOwnerQuery(query, approved, 'stop-finalizer', () => base.releaseWorkloadStop!(proof, approvedVersion)) : base.releaseWorkloadStop!(proof, approvedVersion)); }
      catch (error) { if (result.kind === 'permitted' && isPlatformError(error) && error.kind === 'conflict') return { kind: 'waiting', reason: 'development-removal-version-changed' }; throw error; }
    } } : {}),
  };
}
