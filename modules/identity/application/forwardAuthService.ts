import { TOKEN_CLAIMS, TraceIdSchema } from '@crewstation/contracts';
import { newTraceId } from '@crewstation/kernel';
import type { ServiceAuthDecision, ServiceAuthRequest } from '../api/moduleApi';
import { firstForwardedIp, firstHost, pathOf } from '../domain/forwardedRequest';
import { PLATFORM_API_AUDIENCE, SOURCE_TOKEN_TTL_SECONDS, serviceAudience, serviceSubject } from '../domain/session';
import type { TokenClaimValue } from '../ports/tokenService';
import type { IdentityUseCaseDeps } from './dependencies';

type Deps = Pick<IdentityUseCaseDeps, 'tokens' | 'workloads' | 'allowlist'>;

/**
 * 服务域 ForwardAuth（Design §7.2、§8.3）：源 Pod IP → 调用方身份 → 放行表 → 绑定目标 aud 的来源令牌与 trace_id。
 * 业务代码不携带任何凭据；未登记的来源与未放行的调用都是 403。
 */
export function forwardAuthServiceUseCase(deps: Deps) {
  return async (request: ServiceAuthRequest): Promise<ServiceAuthDecision> => {
    const ip = firstForwardedIp(request.forwardedFor);
    if (!ip) return deny('缺少来源地址：网关未传 X-Forwarded-For', 'missing-source-ip');
    const caller = await deps.workloads.byIp(ip);
    if (!caller) return deny(`来源 ${ip} 不是已登记的平台工作负载`, 'unknown-workload');
    const target = { host: firstHost(request.host), method: request.method.toUpperCase(), path: pathOf(request.uri) };
    const verdict = await deps.allowlist.evaluate(caller, target);
    if (!verdict.allowed) return deny(verdict.reason ?? `放行表未允许 ${caller.identity} 调用 ${target.method} ${target.host}${target.path}`, verdict.reason);
    const parsedTrace = TraceIdSchema.safeParse(request.traceId);
    const traceId: string = parsedTrace.success ? parsedTrace.data : newTraceId();
    const audience = verdict.targetIdentity === PLATFORM_API_AUDIENCE ? PLATFORM_API_AUDIENCE : serviceAudience(verdict.targetIdentity);
    const claims: Record<string, TokenClaimValue> = {
      [TOKEN_CLAIMS.kind]: caller.kind,
      [TOKEN_CLAIMS.project]: caller.project,
      ...(caller.slot ? { [TOKEN_CLAIMS.slot]: caller.slot } : {}),
      [TOKEN_CLAIMS.traceId]: traceId,
    };
    const sourceToken = await deps.tokens.sign({ subject: serviceSubject(caller.identity), audience, expiresInSeconds: SOURCE_TOKEN_TTL_SECONDS, claims });
    return {
      kind: 'allow',
      caller,
      audience,
      traceId,
      injected: { sourceService: caller.identity, ...(caller.slot ? { sourceSlot: caller.slot } : {}), sourceToken, traceId },
    };
  };
}

function deny(message: string, reason?: string): ServiceAuthDecision {
  return { kind: 'forbidden', message, ...(reason ? { reason } : {}) };
}
