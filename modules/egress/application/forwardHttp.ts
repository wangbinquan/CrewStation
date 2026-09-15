import type { ForwardEgressHttpRequest } from '@crewstation/contracts';
import { ForwardEgressHttpRequestSchema } from '@crewstation/contracts';
import { forbidden, PlatformError } from '@crewstation/kernel';
import { mergePolicy } from '../domain/egressEntry';
import { hostAllowed, normalizeHost } from '../domain/fqdnMatch';
import type { HttpEgressDirectory, HttpEgressTransport } from '../ports/httpEgress';
import { blockedUseCases } from './blockedRecords';
import type { EgressUseCaseDeps } from './dependencies';

export function forwardHttpUseCase(deps: EgressUseCaseDeps, directory: HttpEgressDirectory, transport: HttpEgressTransport) {
  return async (source: string, input: ForwardEgressHttpRequest): Promise<Response> => {
    const request = ForwardEgressHttpRequestSchema.parse(input);
    const service = await directory.resolve(source);
    if (!service || service.kind !== 'APIProxy' || service.state !== 'active') throw forbidden('只有运行中的 API 代理服务可使用此出站通道');
    const host = normalizeHost(new URL(request.url).hostname);
    const allow = mergePolicy(await deps.uow.read.entries.listEffective(service.projectId));
    if (!hostAllowed(allow, host)) {
      await blockedUseCases(deps).recordBlocked(service.projectId, host, 'slot');
      throw new PlatformError('forbidden', `出站目标 ${host} 未获管理员批准`, { fqdn: host, code: 'egress_blocked' });
    }
    try { return await transport.send(request); }
    catch { throw new PlatformError('unavailable', '代理出站未取得完整响应或超过限制；请求可能已执行，请核对结果后再决定是否重试'); }
  };
}
