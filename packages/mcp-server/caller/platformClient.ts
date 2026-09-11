import type { ApiClient, FetchLike } from '@crewstation/api-client';
import { createApiClient } from '@crewstation/api-client';
import type { McpCaller } from './callerIdentity';
import { platformCallHeaders } from './callerIdentity';

/** 平台侧地址与可注入的 fetch（单测用）；地址取自 PLATFORM_ENV，不写死在包里。 */
export interface PlatformAccess {
  readonly platformApiUrl: string;
  readonly fetch?: FetchLike;
}

/** 每个请求按调用方身份新建客户端：身份是请求级的，客户端不可跨请求复用。 */
export function platformClientFor(access: PlatformAccess, caller: McpCaller): ApiClient {
  return createApiClient({
    baseUrl: access.platformApiUrl,
    headers: platformCallHeaders(caller),
    ...(access.fetch ? { fetch: access.fetch } : {}),
  });
}
