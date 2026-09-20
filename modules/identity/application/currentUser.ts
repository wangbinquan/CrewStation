import type { AuthMethod, CurrentUserDto, UserId } from '@crewstation/contracts';
import { unauthenticated } from '@crewstation/kernel';
import type { IdentityUseCaseDeps } from './dependencies';

type Deps = Pick<IdentityUseCaseDeps, 'users' | 'memberships'>;

/**
 * `/v1/me`：用户、成员关系与本次会话的认证方式。
 * 认证方式来自 ForwardAuth 注入的平台内部头，工作台据它判断能不能关闭常规登录（RFC-005 §6.1）。
 */
export function currentUserUseCase(deps: Deps) {
  return async (userId: UserId, authMethod: AuthMethod = 'password'): Promise<CurrentUserDto> => {
    const user = await deps.users.getById(userId);
    if (!user) throw unauthenticated('会话对应的用户不存在');
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      platformRole: user.platformRole,
      isAdmin: user.platformRole === 'admin',
      memberships: await deps.memberships.membershipsOf(userId),
      authMethod,
    };
  };
}
