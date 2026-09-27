import { ServiceSourceBindingSchema, TOKEN_CLAIMS, TraceIdSchema } from '@crewstation/contracts';
import type { WorkloadIdentity } from '@crewstation/contracts';
import { newTraceId } from '@crewstation/kernel';
import type { ServiceAuthDecision, ServiceAuthRequest } from '../api/moduleApi';
import { firstForwardedIp, firstHost, pathOf } from '../domain/forwardedRequest';
import { PLATFORM_API_AUDIENCE, SOURCE_TOKEN_TTL_SECONDS, serviceAudience, serviceSubject } from '../domain/session';
import type { TokenClaimValue } from '../ports/tokenService';
import type { IdentityUseCaseDeps } from './dependencies';

type Deps = Pick<IdentityUseCaseDeps, 'tokens' | 'workloads' | 'allowlist'>;

/**
 * 服务域 ForwardAuth（Design §7.2、§8.3）：源 Pod IP → 调用方身份 → 放行表 → 绑定目标 aud 的来源令牌与 trace_id。
 * 已发布的签名 webhook 精确入口交给生产者验签，不授予平台身份；其余未登记／未放行调用都是 403。
 */
export function forwardAuthServiceUseCase(deps: Deps) {
  return async (request: ServiceAuthRequest): Promise<ServiceAuthDecision> => {
    const target = { host: firstHost(request.host), method: request.method.toUpperCase(), path: pathOf(request.uri) };
    const webhook = await deps.allowlist.externalWebhook?.(target);
    if (webhook?.kind === 'webhook') return { kind: 'webhook', traceId: newTraceId() };
    if (webhook) return webhook;
    const ip = firstForwardedIp(request.forwardedFor);
    if (!ip) return deny('缺少来源地址：网关未传 X-Forwarded-For', 'missing-source-ip');
    const caller = await deps.workloads.byIp(ip);
    if (!caller) return deny(`来源 ${ip} 不是已登记的平台工作负载`, 'unknown-workload');
    const verdict = await deps.allowlist.evaluate(caller, target);
    // 目标正式版本维护中（RFC-021）：503 而不是 403，调用方可以按 Retry-After 稍后重试。
    if (!verdict.allowed && verdict.unavailable) return { kind: 'unavailable', message: verdict.unavailable.message, ...(verdict.unavailable.retryAfterSeconds ? { retryAfterSeconds: verdict.unavailable.retryAfterSeconds } : {}) };
    if (!verdict.allowed) return deny(verdict.reason ?? `放行表未允许 ${caller.identity} 调用 ${target.method} ${target.host}${target.path}`, verdict.reason);
    const parsedTrace = TraceIdSchema.safeParse(request.traceId);
    const traceId: string = parsedTrace.success ? parsedTrace.data : newTraceId();
    const audience = verdict.targetIdentity === PLATFORM_API_AUDIENCE ? PLATFORM_API_AUDIENCE : serviceAudience(verdict.targetIdentity);
    const claims: Record<string, TokenClaimValue> = {
      [TOKEN_CLAIMS.kind]: caller.kind,
      [TOKEN_CLAIMS.project]: caller.project,
      ...(caller.slot ? { [TOKEN_CLAIMS.slot]: caller.slot } : {}),
      [TOKEN_CLAIMS.traceId]: traceId,
      ...(caller.kind === 'service' && caller.source ? {
        [TOKEN_CLAIMS.sourceIp]: caller.source.ip, [TOKEN_CLAIMS.sourcePodUid]: caller.source.podUid,
        [TOKEN_CLAIMS.sourceReleaseId]: caller.source.releaseId, [TOKEN_CLAIMS.sourcePhysicalSlot]: caller.source.physicalSlot,
      } : {}),
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

/** v3 执行只信平台受众的签名来源令牌，并重查源 Pod 当前实例，旧 Pod 的令牌不能随 IP 复用继承。 */
export function resolveServiceSourceUseCase(deps: Pick<Deps, 'tokens' | 'workloads'>) {
  return async (token: string): Promise<(WorkloadIdentity & { source: NonNullable<WorkloadIdentity['source']> }) | undefined> => {
    const verified = await deps.tokens.verify(token, { audience: PLATFORM_API_AUDIENCE });
    if (!verified || verified.claims[TOKEN_CLAIMS.kind] !== 'service') return undefined;
    const claim = ServiceSourceBindingSchema.safeParse({
      ip: verified.claims[TOKEN_CLAIMS.sourceIp], podUid: verified.claims[TOKEN_CLAIMS.sourcePodUid],
      releaseId: verified.claims[TOKEN_CLAIMS.sourceReleaseId], physicalSlot: verified.claims[TOKEN_CLAIMS.sourcePhysicalSlot], ready: false,
    });
    if (!claim.success) return undefined;
    const current = await deps.workloads.byIp(claim.data.ip);
    if (!current?.source || current.kind !== 'service' || verified.subject !== serviceSubject(current.identity) || verified.claims[TOKEN_CLAIMS.project] !== current.project) return undefined;
    if (current.source.podUid !== claim.data.podUid || current.source.releaseId !== claim.data.releaseId || current.source.physicalSlot !== claim.data.physicalSlot || current.source.ip !== claim.data.ip) return undefined;
    return { ...current, source: current.source };
  };
}

function deny(message: string, reason?: string): ServiceAuthDecision {
  return { kind: 'forbidden', message, ...(reason ? { reason } : {}) };
}
