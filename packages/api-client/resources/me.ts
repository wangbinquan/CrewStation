import type { CurrentUserDto } from '@crewstation/contracts';
import type { Transport } from '../httpTransport';

export interface MeResource {
  /** GET /v1/me：网关注入的当前用户、管理员标记、项目成员关系与是否演示身份。 */
  get(): Promise<CurrentUserDto>;
}

export function meResource(transport: Transport): MeResource {
  return {
    get: () => transport.request<CurrentUserDto>('GET', '/v1/me'),
  };
}
