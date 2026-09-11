import type { K8sClient, K8sObject } from '@crewstation/k8s';
import { Resources } from '@crewstation/k8s';
import type { JobState } from '../../ports/delivery';

interface JobStatus { succeeded?: number; failed?: number; conditions?: Array<{ type: string; status: string; message?: string }> }

/** 构建与迁移 Job 共用的状态判定：Complete 即成功，Failed 即失败，其余仍在运行。 */
export async function readJobState(k8s: K8sClient, namespace: string, name: string): Promise<JobState> {
  const job = await k8s.get<K8sObject & { status?: JobStatus }>(Resources.Job!, name, namespace);
  if (!job) return { state: 'failed', message: `Job ${name} 不存在` };
  const status = job.status ?? {};
  const failed = status.conditions?.find((c) => c.type === 'Failed' && c.status === 'True');
  if (failed) return { state: 'failed', message: failed.message ?? 'Job 失败' };
  if ((status.succeeded ?? 0) > 0 || status.conditions?.some((c) => c.type === 'Complete' && c.status === 'True')) return { state: 'succeeded' };
  return { state: 'running' };
}
