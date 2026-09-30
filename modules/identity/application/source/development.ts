import { TOKEN_CLAIMS } from '@crewstation/contracts';
import type { WorkloadIdentity } from '@crewstation/contracts';
import { PLATFORM_API_AUDIENCE, serviceSubject } from '../../domain/session';
import type { IdentityUseCaseDeps } from '../dependencies';

/** Recheck the live index after JWT verification; IP reuse or session replacement cannot inherit authority. */
export function resolveDevelopmentSource(deps: Pick<IdentityUseCaseDeps, 'tokens' | 'workloads' | 'projectAdmission'>) {
  return async (token: string): Promise<(WorkloadIdentity & { developmentSource: NonNullable<WorkloadIdentity['developmentSource']> }) | undefined> => {
    const verified = await deps.tokens.verify(token, { audience: PLATFORM_API_AUDIENCE });
    if (!verified || verified.claims[TOKEN_CLAIMS.kind] !== 'dev-session') return undefined;
    const ip = verified.claims[TOKEN_CLAIMS.sourceIp];
    if (typeof ip !== 'string') return undefined;
    const current = await deps.workloads.byIp(ip), source = current?.developmentSource;
    if (!current || current.kind !== 'dev-session' || !source || current.taskId !== source.taskId || source.ip !== ip) return undefined;
    if (verified.subject !== serviceSubject(current.identity) || verified.claims[TOKEN_CLAIMS.project] !== current.project
      || verified.claims[TOKEN_CLAIMS.sourcePodUid] !== source.podUid || verified.claims[TOKEN_CLAIMS.sourceTaskId] !== source.taskId) return undefined;
    if (deps.projectAdmission && !await deps.projectAdmission.bySlug(current.project)) return undefined;
    return { ...current, developmentSource: source };
  };
}
