import type {
  CreateOidcProviderRequest, EffectiveForwardingDto, IdentityForwardingDto, LoginPolicyDto, OidcProbeResult, OidcProviderDto,
  PatchOidcProviderRequest, UpdateIdentityForwardingRequest, UpdateLoginPolicyRequest,
} from '@crewstation/contracts';
import type { Transport } from '../httpTransport';
import type { ItemsPage } from '../itemsPage';
import { segment } from '../requestUrl';

/** 认证管理面（RFC-005 §6）：登录策略、身份提供方与身份转发，全部仅管理员可用。 */
export interface AuthResource {
  /** GET /v1/admin/auth/login-policy */
  loginPolicy(): Promise<LoginPolicyDto>;
  /** PUT /v1/admin/auth/login-policy：关闭常规登录要求当前会话来自 OIDC。 */
  setLoginPolicy(body: UpdateLoginPolicyRequest): Promise<LoginPolicyDto>;
  /** GET /v1/admin/auth/providers */
  listProviders(): Promise<ItemsPage<OidcProviderDto>>;
  /** POST /v1/admin/auth/providers（201） */
  createProvider(body: CreateOidcProviderRequest): Promise<OidcProviderDto>;
  /** PATCH /v1/admin/auth/providers/:id：留空的 clientSecret 表示保持原值。 */
  patchProvider(id: string, body: PatchOidcProviderRequest): Promise<OidcProviderDto>;
  /** DELETE /v1/admin/auth/providers/:id */
  removeProvider(id: string): Promise<void>;
  /** POST /v1/admin/auth/providers/:id/test：始终 200，带逐端点诊断。 */
  testProvider(id: string): Promise<OidcProbeResult>;
  /** GET /v1/admin/auth/forwarding */
  forwarding(): Promise<IdentityForwardingDto>;
  /** PUT /v1/admin/auth/forwarding */
  setGlobalForwarding(body: UpdateIdentityForwardingRequest): Promise<IdentityForwardingDto>;
  /** PUT /v1/admin/auth/forwarding/projects/:projectId */
  setProjectForwarding(projectId: string, body: UpdateIdentityForwardingRequest): Promise<EffectiveForwardingDto>;
  /** DELETE /v1/admin/auth/forwarding/projects/:projectId：回到全局默认。 */
  clearProjectForwarding(projectId: string): Promise<EffectiveForwardingDto>;
  /** GET /v1/projects/:projectId/identity-forwarding：项目负责人只读的生效集。 */
  projectForwarding(projectId: string): Promise<EffectiveForwardingDto>;
}

export function authResource(transport: Transport): AuthResource {
  const base = '/v1/admin/auth';
  return {
    loginPolicy: () => transport.request('GET', `${base}/login-policy`),
    setLoginPolicy: (body) => transport.request('PUT', `${base}/login-policy`, { body }),
    listProviders: () => transport.request('GET', `${base}/providers`),
    createProvider: (body) => transport.request('POST', `${base}/providers`, { body }),
    patchProvider: (id, body) => transport.request('PATCH', `${base}/providers/${segment(id)}`, { body }),
    removeProvider: (id) => transport.request('DELETE', `${base}/providers/${segment(id)}`),
    testProvider: (id) => transport.request('POST', `${base}/providers/${segment(id)}/test`),
    forwarding: () => transport.request('GET', `${base}/forwarding`),
    setGlobalForwarding: (body) => transport.request('PUT', `${base}/forwarding`, { body }),
    setProjectForwarding: (projectId, body) => transport.request('PUT', `${base}/forwarding/projects/${segment(projectId)}`, { body }),
    clearProjectForwarding: (projectId) => transport.request('DELETE', `${base}/forwarding/projects/${segment(projectId)}`),
    projectForwarding: (projectId) => transport.request('GET', `/v1/projects/${segment(projectId)}/identity-forwarding`),
  };
}
