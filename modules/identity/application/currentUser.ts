import type { CurrentUserDto, UserId } from '@crewstation/contracts';
import { unauthenticated } from '@crewstation/kernel';
import { isDemoIdentity } from '../domain/user';
import type { IdentityUseCaseDeps } from './dependencies';

type Deps = Pick<IdentityUseCaseDeps, 'users' | 'memberships' | 'provider'>;

/** `/v1/me`：用户、成员关系与“演示身份”标记；标记看用户档案的外部标识，不依赖本进程是否配置了登录适配器。 */
export function currentUserUseCase(deps: Deps) {
  return async (userId: UserId): Promise<CurrentUserDto> => {
    const user = await deps.users.getById(userId);
    if (!user) throw unauthenticated('会话对应的用户不存在');
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      isAdmin: user.isAdmin,
      memberships: await deps.memberships.membershipsOf(userId),
      demoIdentity: isDemoIdentity(user.externalId) || deps.provider?.kind === 'demo',
    };
  };
}
