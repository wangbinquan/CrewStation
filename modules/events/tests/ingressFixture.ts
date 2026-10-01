import { IDENTITY_HEADERS } from '@crewstation/contracts';
import type { ProjectId, ServiceId, WorkloadIdentity } from '@crewstation/contracts';
import type { Database } from '@crewstation/persistence';
import { createIdentityModule } from '@crewstation/module-identity';
import type { ProjectModuleApi } from '@crewstation/module-project';

/** 真实 key-ring / ForwardAuth 的签名夹具；原 Pod → UUID 端口是固定归属替身，另有平台实际来源回归。 */
export function eventIngressFixture(db: Database, projects: Pick<ProjectModuleApi, 'assertProjectAvailable'>) {
  const workloads = new Map<string, WorkloadIdentity>(), originals = new Map<string, { projectId: ProjectId; serviceId: ServiceId }>(), callers = new Map<string, string>();
  const identity = createIdentityModule({ db, settings: { adminEmails: [] },
    workloadLookup: { byIp: async (ip) => workloads.get(ip) },
    workloadOwnership: { resolve: async (workload) => workload.pod ? originals.get(workload.pod.uid) : undefined },
    projectLifecycle: { available: async (id) => {
      try { await projects.assertProjectAvailable(id); return true; }
      catch (error) { if (error instanceof Error && 'kind' in error && ['precondition', 'not_found'].includes(String(error.kind))) return false; throw error; }
    } },
    allowlistEvaluator: { evaluate: async () => ({ allowed: true, targetIdentity: 'platform:events' }) },
  });
  const add = (target: { projectId: ProjectId; serviceId: ServiceId; slug: string }, kind: WorkloadIdentity['kind'] = 'service') => {
    const ip = `10.244.100.${workloads.size + 1}`, uid = Bun.randomUUIDv7(), name = `${target.slug}-source`, namespace = `cs-${target.slug}`;
    const workload: WorkloadIdentity = { identity: `${target.slug}/${target.slug}`, project: target.slug, service: target.slug, kind, pod: { uid, name, namespace, ip } };
    workloads.set(ip, workload); originals.set(uid, { projectId: target.projectId, serviceId: target.serviceId }); callers.set(workload.identity, ip);
    return workload;
  };
  const headers = async (caller: string) => {
    const forwardedFor = callers.get(caller);
    if (!forwardedFor) throw new Error('Fixture original caller absent');
    const decision = await identity.api.authorizeServiceRequest({ host: 'events.svc.test', method: 'POST', uri: '/v1/events/produce', forwardedFor });
    if (decision.kind !== 'allow') throw new Error(`Fixture ForwardAuth refused: ${decision.kind}`);
    return { [IDENTITY_HEADERS.sourceService]: decision.injected.sourceService, [IDENTITY_HEADERS.sourceToken]: decision.injected.sourceToken };
  };
  const ingress = { resolve: async ({ identity: claimed, token }: { identity: string; token?: string }) => {
    const actor = token ? await identity.api.resolveEventSource(token) : undefined;
    return actor?.identity === claimed ? actor : undefined;
  } };
  return { identity, add, headers, ingress, workloads, originals };
}
