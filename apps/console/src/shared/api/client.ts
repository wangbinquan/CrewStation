import { createApiClient } from '@crewstation/api-client';
import type { ApiClient } from '@crewstation/api-client';

/**
 * 工作台的平台 API 客户端：同源、携带 Cookie（用户域由网关 ForwardAuth 注入身份，前端不带凭据）。
 * 所有 feature 只经 shared/api 的 hooks 使用它，不各自 fetch。
 */
export const api: ApiClient = createApiClient();
