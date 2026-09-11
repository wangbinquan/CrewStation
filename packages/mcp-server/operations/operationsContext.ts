import type { ApiClient, FetchLike } from '@crewstation/api-client';
import type { McpCaller } from '../caller/callerIdentity';
import { callerForwardHeaders, callerFromHeaders, requireCaller } from '../caller/callerIdentity';
import type { CallerProject } from '../caller/callerProject';
import { callerProjectResolver } from '../caller/callerProject';
import type { PlatformAccess } from '../caller/platformClient';
import { platformClientFor } from '../caller/platformClient';

export interface OperationsAccess extends PlatformAccess {
  /** 服务域上的内部 API 前缀，形如 `http://api.svc.cs.internal/api/`。 */
  readonly internalApiBase: string;
}

export interface InternalApiCall {
  readonly method: string;
  readonly url: string;
  readonly body: string | undefined;
}

export interface OperationsContext {
  readonly caller: McpCaller | undefined;
  /** 已绑定调用方身份的平台客户端；工具一律经它调用 cs-api，授权由平台判定。 */
  client(): ApiClient;
  project(): Promise<CallerProject>;
  /** 以调用方身份发出一次内部 API 调用；放行与否由网关按本服务的放行表判定。 */
  callInternalApi(call: InternalApiCall): Promise<Response>;
}

export function operationsContextFor(access: OperationsAccess, request: Request): OperationsContext {
  const caller = callerFromHeaders(request.headers);
  let client: ApiClient | undefined;
  let project: (() => Promise<CallerProject>) | undefined;
  const bound = (): ApiClient => (client ??= platformClientFor(access, requireCaller(caller)));
  const fetchImpl: FetchLike = access.fetch ?? ((input, init) => globalThis.fetch(input, init));
  return {
    caller,
    client: bound,
    project: () => (project ??= callerProjectResolver(bound(), requireCaller(caller)))(),
    callInternalApi: (call) => {
      const headers = new Headers({ accept: 'application/json', ...callerForwardHeaders(requireCaller(caller)) });
      if (call.body !== undefined) headers.set('content-type', 'application/json');
      return fetchImpl(joinBase(access.internalApiBase, call.url), {
        method: call.method,
        headers,
        ...(call.body === undefined ? {} : { body: call.body }),
      });
    },
  };
}

function joinBase(base: string, suffix: string): string {
  return `${base.endsWith('/') ? base : `${base}/`}${suffix.replace(/^\/+/, '')}`;
}
