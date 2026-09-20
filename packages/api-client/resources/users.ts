import type { SetPlatformRoleRequest, SetAdminRequest, UserDto } from '@crewstation/contracts';
import type { Transport } from '../httpTransport';
import type { ItemsPage } from '../itemsPage';
import { segment } from '../requestUrl';

/** 用户目录（仅管理员）。 */
export interface UsersResource {
  /** GET /v1/users */
  list(): Promise<ItemsPage<UserDto>>;
  /** PUT /v1/users/:userId/admin */
  setPlatformRole(userId: string, input: SetPlatformRoleRequest): Promise<UserDto>;
  setAdmin(userId: string, input: SetAdminRequest): Promise<UserDto>;
}

export function usersResource(transport: Transport): UsersResource {
  return {
    list: () => transport.request<ItemsPage<UserDto>>('GET', '/v1/users'),
    setPlatformRole: (id, input) => transport.request('PUT', `/v1/users/${segment(id)}/platform-role`, { body: input }),
    setAdmin: (userId, input) => transport.request<UserDto>('PUT', `/v1/users/${segment(userId)}/admin`, { body: input }),
  };
}
