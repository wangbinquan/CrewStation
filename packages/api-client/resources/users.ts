import type { DeveloperAccessPage, DeveloperAccessQuery, DeveloperAccessRequestDto, RequestDeveloperAccess, ReviewDeveloperAccess } from '@crewstation/contracts';
import type { SetPlatformRoleRequest, SetAdminRequest, UserDto } from '@crewstation/contracts';
import type { Transport } from '../httpTransport';
import type { ItemsPage } from '../itemsPage';
import { segment } from '../requestUrl';

/** 用户目录（仅管理员）。 */
export interface UsersResource {
  myDeveloperAccess(): Promise<{ request: DeveloperAccessRequestDto | null }>;
  requestDeveloperAccess(input: RequestDeveloperAccess): Promise<DeveloperAccessRequestDto>;
  developerAccess(query?: Partial<DeveloperAccessQuery>): Promise<DeveloperAccessPage>;
  reviewDeveloperAccess(id: string, input: ReviewDeveloperAccess): Promise<DeveloperAccessRequestDto>;
  /** GET /v1/users */
  list(): Promise<ItemsPage<UserDto>>;
  /** PUT /v1/users/:userId/admin */
  setPlatformRole(userId: string, input: SetPlatformRoleRequest): Promise<UserDto>;
  setAdmin(userId: string, input: SetAdminRequest): Promise<UserDto>;
}

export function usersResource(transport: Transport): UsersResource {
  return {
    myDeveloperAccess: () => transport.request('GET', '/v1/me/developer-access'),
    requestDeveloperAccess: input => transport.request('POST', '/v1/me/developer-access', { body: input }),
    developerAccess: query => transport.request('GET', '/v1/admin/developer-access', { query }),
    reviewDeveloperAccess: (id, input) => transport.request('POST', `/v1/admin/developer-access/${segment(id)}/review`, { body: input }),
    list: () => transport.request<ItemsPage<UserDto>>('GET', '/v1/users'),
    setPlatformRole: (id, input) => transport.request('PUT', `/v1/users/${segment(id)}/platform-role`, { body: input }),
    setAdmin: (userId, input) => transport.request<UserDto>('PUT', `/v1/users/${segment(userId)}/admin`, { body: input }),
  };
}
