import type { AutoOfflinePolicyDto, SetAutoOfflinePolicyRequest } from '@crewstation/contracts';
import type { Transport } from '../httpTransport';

/** RFC-021：管理空间「平台设置」（仅管理员）。 */
export interface PlatformSettingsResource {
  /** GET /v1/admin/settings/auto-offline：待验证版本自动下线的三个时长。 */
  autoOffline(): Promise<AutoOfflinePolicyDto>;
  /** PUT /v1/admin/settings/auto-offline：带 expectedRevision，他人先改过时 409。 */
  setAutoOffline(input: SetAutoOfflinePolicyRequest): Promise<AutoOfflinePolicyDto>;
}

export function platformSettingsResource(transport: Transport): PlatformSettingsResource {
  const path = '/v1/admin/settings/auto-offline';
  return {
    autoOffline: () => transport.request<AutoOfflinePolicyDto>('GET', path),
    setAutoOffline: (input) => transport.request<AutoOfflinePolicyDto>('PUT', path, { body: input }),
  };
}
