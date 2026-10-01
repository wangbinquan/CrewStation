import { ProjectIdSchema, ServiceIdSchema, TOKEN_CLAIMS } from '@crewstation/contracts';
import type { ProjectServiceActor } from '@crewstation/contracts';
import { serviceAudience, serviceSubject } from '../../domain/session';
import type { IdentityUseCaseDeps } from '../dependencies';

/** 固定事件受众、签名原 UUID 与当前原 Pod 均匹配后才交给入口；不按同名目录重新授权。 */
export function resolveEventSource(deps: Pick<IdentityUseCaseDeps, 'tokens' | 'workloads' | 'workloadOwnership' | 'projectAdmission'>) {
  return async (token: string): Promise<ProjectServiceActor | undefined> => {
    if (!deps.workloadOwnership || !deps.projectAdmission) return undefined;
    const verified = await deps.tokens.verify(token, { audience: serviceAudience('platform:events') });
    if (!verified) return undefined;
    const project = ProjectIdSchema.safeParse(verified.claims[TOKEN_CLAIMS.sourceProjectId]);
    const service = ServiceIdSchema.safeParse(verified.claims[TOKEN_CLAIMS.sourceServiceId]);
    const ip = verified.claims[TOKEN_CLAIMS.sourceIp], podUid = verified.claims[TOKEN_CLAIMS.sourcePodUid];
    if (!project.success || !service.success || typeof ip !== 'string' || typeof podUid !== 'string' || !podUid) return undefined;
    const current = await deps.workloads.byIp(ip);
    if (!current || current.kind === 'platform' || current.kind !== verified.claims[TOKEN_CLAIMS.kind]
      || verified.subject !== serviceSubject(current.identity) || current.project !== verified.claims[TOKEN_CLAIMS.project]) return undefined;
    const currentUid = current.pod?.uid ?? current.source?.podUid ?? current.developmentSource?.podUid;
    if (currentUid !== podUid) return undefined;
    const original = await deps.workloadOwnership.resolve(current);
    if (!original || original.projectId !== project.data || original.serviceId !== service.data || !await deps.projectAdmission.byId(original.projectId)) return undefined;
    return { identity: current.identity, project: current.project, service: current.service, ...original, ...(current.slot ? { slot: current.slot } : {}) };
  };
}
