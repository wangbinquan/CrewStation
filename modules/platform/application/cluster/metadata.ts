interface Project { projectId: string; name: string; slug: string; namespace: string; kind: string; state: string; serviceId?: string; serviceName?: string }
interface Slot { serviceId: string; physical: 'blue' | 'green'; role: 'prod' | 'preview'; releaseId?: string; state: string; manifestReplicas?: number; overrideReplicas?: number; plan?: string; revision: string }
export async function clusterMetadata<T>(sources: { projects(): Promise<Project[]>; tasks(): Promise<T[]>; slots(): Promise<Slot[]>; plans(): Promise<Array<{ id: string; maxReplicas: number }>> }) {
  const [projects, tasks, slots, plans] = await Promise.all([sources.projects(), sources.tasks(), sources.slots(), sources.plans()]);
  const releases = slots.flatMap((slot) => { const project = projects.find((p) => p.serviceId === slot.serviceId); return project ? [{ ...slot, namespace: project.namespace, serviceName: project.serviceName!, ...(slot.plan ? { maxReplicas: plans.find((p) => p.id === slot.plan)?.maxReplicas ?? 0 } : {}) }] : []; });
  const retained = projects.filter((p) => p.serviceName).flatMap((p) => ['blue', 'green'].map((slot) => ({ namespace: p.namespace, kind: 'Service', name: `${p.serviceName}-${slot}`, reason: '发布槽 Service 跨发布保留' })));
  for (const project of projects) {
    retained.push({ namespace: project.namespace, kind: 'ResourceQuota', name: 'crewstation-project', reason: '项目配额' });
    const policies = ['crewstation-default', 'crewstation-task-egress', 'crewstation-build-egress', ...(project.kind === 'DigitalWorker' ? [] : ['crewstation-integration-egress'])];
    for (const name of policies) retained.push({ namespace: project.namespace, kind: 'NetworkPolicy', name, reason: '项目网络配置' });
  }
  return { projects, tasks, releases, retained, complete: true };
}
