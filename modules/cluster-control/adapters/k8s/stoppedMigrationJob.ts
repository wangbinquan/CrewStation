import type { K8sClient, K8sObject } from '@crewstation/k8s';
import { LABELS, Resources } from '@crewstation/k8s';
import { isPlatformError, precondition } from '@crewstation/kernel';
import type { JobRender } from '../../domain/jobRender';
import { releaseJobObject } from './jobObjects';

/** Retain a suspended Job as a name tombstone: a stale ensureJob can never create another writer. */
export async function stopMigrationJob(k8s: K8sClient, job: JobRender): Promise<boolean> {
  if (job.purpose !== 'migration') throw precondition('迁移停止屏障不能用于其他 Job');
  let current = await k8s.get(Resources.Job!, job.name, job.namespace);
  if (!current) {
    const object = releaseJobObject(job), spec = object.spec as Record<string, unknown>;
    spec.suspend = true; delete spec.ttlSecondsAfterFinished;
    try { current = await k8s.create(object); }
    catch (error) { if (!isPlatformError(error) || error.kind !== 'conflict') throw error; return false; }
  }
  if (current.metadata.deletionTimestamp) return false;
  if (!current.metadata.uid || current.metadata.labels?.[LABELS.release] !== job.releaseId || current.metadata.labels?.[LABELS.component] !== 'migration') throw precondition('迁移 Job 身份已变化');
  const spec = current.spec as Record<string, unknown>;
  if (spec.suspend !== true || spec.ttlSecondsAfterFinished !== undefined) {
    await k8s.mergePatch(Resources.Job!, job.name, job.namespace, { metadata: { uid: current.metadata.uid, resourceVersion: current.metadata.resourceVersion }, spec: { suspend: true, ttlSecondsAfterFinished: null } });
    return false;
  }
  const status = current.status as { conditions?: Array<{ type: string; status: string }> } | undefined;
  if (!status?.conditions?.some((condition) => condition.type === 'Suspended' && condition.status === 'True')) return false;
  const pods = await k8s.list<K8sObject>(Resources.Pod!, job.namespace);
  return !pods.some((pod) => pod.metadata.ownerReferences?.some((owner) => owner.uid === current!.metadata.uid)
    || pod.metadata.labels?.['batch.kubernetes.io/job-name'] === job.name || pod.metadata.labels?.['job-name'] === job.name);
}
