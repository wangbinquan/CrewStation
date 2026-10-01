import { ReleaseIdSchema, ServiceIdSchema, TaskIdSchema } from '@crewstation/contracts';
import type { ProjectId, ServiceId, WorkloadIdentity } from '@crewstation/contracts';
import type { K8sClient, K8sObject } from '@crewstation/k8s';
import type { OriginalWorkloadProject, OriginalWorkloadRelease, OriginalWorkloadTasks } from '../../ports/workloadOwnership';

interface Pod extends K8sObject { status?: { podIP?: string; phase?: string } }
type Scope = { projectId: ProjectId; serviceId: ServiceId };
type Normalize = (kind: 'release' | 'task', value: string) => Promise<string | undefined>;

/** 原 release/task UUID 取得归属，再核对实际 Pod；当前 slug 目录不能替换原来源。 */
export function nativeWorkloadOwnership(k8s: K8sClient, project: () => OriginalWorkloadProject,
  release: () => OriginalWorkloadRelease | undefined, tasks: () => OriginalWorkloadTasks | undefined, normalize?: Normalize) {
  const originalScope = async (workload: WorkloadIdentity, pod: Pod): Promise<Scope | undefined> => {
    const labels = pod.metadata.labels ?? {};
    if (workload.kind === 'service') {
      const raw = labels['crewstation.io/release'];
      if (!raw) return undefined;
      const original = ReleaseIdSchema.safeParse(ReleaseIdSchema.safeParse(raw).success ? raw : await normalize?.('release', raw));
      if (!original.success || workload.source && (workload.source.podUid !== pod.metadata.uid || workload.source.ip !== pod.status?.podIP || workload.source.releaseId !== original.data || workload.source.physicalSlot !== labels['crewstation.io/slot'])) return undefined;
      return release()?.sourceOwnership(original.data);
    }
    const raw = labels['crewstation.io/task'];
    if (!raw || !workload.taskId) return undefined;
    const original = TaskIdSchema.safeParse(TaskIdSchema.safeParse(raw).success ? raw : await normalize?.('task', raw));
    if (!original.success || original.data !== workload.taskId || workload.developmentSource && (workload.developmentSource.podUid !== pod.metadata.uid || workload.developmentSource.ip !== pod.status?.podIP || workload.developmentSource.taskId !== original.data || workload.developmentSource.podName !== pod.metadata.name)) return undefined;
    const env = await tasks()?.getEnvironment(original.data), serviceId = ServiceIdSchema.safeParse(env?.serviceId);
    const expectedKind = workload.kind === 'business-task' ? 'business' : 'dev-session';
    if (!env || !serviceId.success || env.kind !== expectedKind || env.podName !== pod.metadata.name || !['creating', 'running'].includes(env.state)
      || env.native?.podUid && env.native.podUid !== pod.metadata.uid) return undefined;
    return { projectId: env.projectId, serviceId: serviceId.data };
  };
  return { resolve: async (workload: WorkloadIdentity): Promise<Scope | undefined> => {
    const source = workload.pod;
    if (!source || workload.kind === 'platform') return undefined;
    const pod = await k8s.get<Pod>({ apiVersion: 'v1', kind: 'Pod', plural: 'pods', namespaced: true }, source.name, source.namespace, AbortSignal.timeout(5000));
    if (!pod || pod.metadata.uid !== source.uid || pod.metadata.namespace !== source.namespace || pod.status?.podIP !== source.ip || ['Succeeded', 'Failed'].includes(pod.status?.phase ?? '')
      || pod.metadata.labels?.['app.kubernetes.io/managed-by'] !== 'crewstation' || pod.metadata.labels?.['crewstation.io/workload'] !== workload.kind) return undefined;
    const original = await originalScope(workload, pod);
    if (!original) return undefined;
    const service = await project().resolveServiceById(original.serviceId);
    if (!service || service.serviceId !== original.serviceId || service.projectId !== original.projectId || service.namespace !== source.namespace || service.identity !== workload.identity
      || pod.metadata.labels?.['crewstation.io/project'] !== workload.project || pod.metadata.labels?.['crewstation.io/service'] !== workload.service) return undefined;
    try { await project().assertProjectAvailable(original.projectId); }
    catch (error) { if (error instanceof Error && 'kind' in error && ['precondition', 'not_found'].includes(String(error.kind))) return undefined; throw error; }
    return original;
  } };
}
