import type { AutoOfflinePolicyDto, ProjectRateLimitsDto, RateLimitSettingsDto, SetAutoOfflinePolicyRequest, SetProjectRateLimitsRequest, SetRateLimitSettingsRequest } from '@crewstation/contracts';
import type { Transport } from '../httpTransport';
import { segment } from '../requestUrl';

/** RFC-021：管理空间「平台设置」（仅管理员）；RFC-025 T10：网关限流的平台默认与项目覆盖。 */
export interface PlatformSettingsResource {
  /** GET /v1/admin/settings/auto-offline：待验证版本自动下线的三个时长。 */
  autoOffline(): Promise<AutoOfflinePolicyDto>;
  /** PUT /v1/admin/settings/auto-offline：带 expectedRevision，他人先改过时 409。 */
  setAutoOffline(input: SetAutoOfflinePolicyRequest): Promise<AutoOfflinePolicyDto>;
  /** GET /v1/admin/settings/rate-limits：网关限流的平台默认（平台接口、用户域、服务域）。 */
  rateLimits(): Promise<RateLimitSettingsDto>;
  /** PUT /v1/admin/settings/rate-limits：带 expectedRevision，他人先改过时 409。 */
  setRateLimits(input: SetRateLimitSettingsRequest): Promise<RateLimitSettingsDto>;
  /** GET /v1/admin/projects/:projectId/rate-limits：项目覆盖与生效值。 */
  projectRateLimits(projectId: string): Promise<ProjectRateLimitsDto>;
  /** PUT /v1/admin/projects/:projectId/rate-limits：设或撤（override 为 null）项目覆盖。 */
  setProjectRateLimits(projectId: string, input: SetProjectRateLimitsRequest): Promise<ProjectRateLimitsDto>;
}

export function platformSettingsResource(transport: Transport): PlatformSettingsResource {
  const path = '/v1/admin/settings/auto-offline', limits = '/v1/admin/settings/rate-limits';
  const project = (projectId: string) => `/v1/admin/projects/${segment(projectId)}/rate-limits`;
  return {
    autoOffline: () => transport.request<AutoOfflinePolicyDto>('GET', path),
    setAutoOffline: (input) => transport.request<AutoOfflinePolicyDto>('PUT', path, { body: input }),
    rateLimits: () => transport.request<RateLimitSettingsDto>('GET', limits),
    setRateLimits: (input) => transport.request<RateLimitSettingsDto>('PUT', limits, { body: input }),
    projectRateLimits: (projectId) => transport.request<ProjectRateLimitsDto>('GET', project(projectId)),
    setProjectRateLimits: (projectId, input) => transport.request<ProjectRateLimitsDto>('PUT', project(projectId), { body: input }),
  };
}
