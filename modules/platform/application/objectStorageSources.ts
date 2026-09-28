import type { DevelopmentSourceBinding, ProjectId, ReleaseId, ServiceId, WorkloadIdentity } from '@crewstation/contracts';

interface ObjectIdentity {
  resolveServiceSource(token: string): Promise<(WorkloadIdentity & { source: NonNullable<WorkloadIdentity['source']> }) | undefined>;
  resolveDevelopmentSource(token: string): Promise<(WorkloadIdentity & { developmentSource: DevelopmentSourceBinding }) | undefined>;
}
interface ObjectDirectory { resolveServiceIdentity(identity: string): Promise<{ serviceId: ServiceId; projectId: ProjectId; state: string } | undefined> }
interface ObjectRelease { objectStorageContract(serviceId: ServiceId, releaseId: ReleaseId): Promise<{ planId: string; fenced: boolean } | undefined> }
interface ObjectDevelopment { resolveDevelopmentObjectSource(source: DevelopmentSourceBinding): Promise<{ projectId: ProjectId; serviceId: ServiceId; planId: string } | undefined> }

export function objectStorageSources(identity: ObjectIdentity, project: ObjectDirectory, release: () => ObjectRelease | undefined, development: () => ObjectDevelopment | undefined) {
  return { resolve: async (caller: { identity: string; token?: string }) => {
    if (!caller.token) return undefined;
    const workload = caller.token ? await identity.resolveServiceSource(caller.token) : undefined;
    if (workload) {
      if (workload.kind !== 'service' || workload.identity !== caller.identity || !workload.source.ready) return undefined;
      const service = await project.resolveServiceIdentity(workload.identity);
      if (!service) return undefined;
      const contract = await release()?.objectStorageContract(service.serviceId, workload.source.releaseId);
      if (!contract) return undefined;
      return { projectId: service.projectId, serviceId: service.serviceId, env: 'production' as const, podUid: workload.source.podUid, writeAllowed: service.state !== 'archived', ...contract };
    }
    const dev = await identity.resolveDevelopmentSource(caller.token);
    if (!dev || dev.kind !== 'dev-session' || dev.identity !== caller.identity || !dev.developmentSource.ready) return undefined;
    const service = await project.resolveServiceIdentity(dev.identity);
    if (!service) return undefined;
    const contract = await development()?.resolveDevelopmentObjectSource(dev.developmentSource);
    if (!contract || contract.projectId !== service.projectId || contract.serviceId !== service.serviceId) return undefined;
    return { ...contract, env: 'development' as const, podUid: dev.developmentSource.podUid, writeAllowed: service.state !== 'archived', fenced: false };
  } };
}
