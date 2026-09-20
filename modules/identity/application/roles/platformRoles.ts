import type { PlatformRole, SetPlatformRoleRequest, UserDto, UserId } from '@crewstation/contracts';
import { conflict, notFound, precondition } from '@crewstation/kernel';
import type { MembershipLookup } from '../../ports/membershipLookup';
import type { UserRepository } from '../../ports/userRepository';
import type { RoleMutationLock } from '../../ports/roleMutationLock';
import { toDto } from '../ensureUser';

interface Deps { users: UserRepository; memberships: MembershipLookup; roleLock: RoleMutationLock }

export function platformRoleUseCases({ users, memberships, roleLock }: Deps) {
  const change = async (userId: UserId, platformRole: PlatformRole, expectedRole?: PlatformRole): Promise<UserDto> => roleLock.run(userId, async () => {
    const user = await users.getById(userId);
    if (!user) throw notFound('用户', userId);
    if (expectedRole !== undefined && user.platformRole !== expectedRole) throw conflict('用户角色已变化，请刷新后重试', { currentRole: user.platformRole });
    if (user.platformRole === 'admin' && platformRole !== 'admin' && await users.countAdmins() <= 1) throw precondition('不能撤销最后一位管理员');
    if (platformRole === 'user') {
      const owned = (await memberships.membershipsOf(userId)).filter((m) => m.role === 'owner');
      if (owned.length) throw precondition('请先转交负责的项目，再改为用户', { projectIds: owned.map((m) => m.projectId) });
    }
    await users.setPlatformRole(userId, platformRole);
    return toDto({ ...user, platformRole });
  });
  return {
    setPlatformRole: (id: UserId, input: SetPlatformRoleRequest) => change(id, input.platformRole, input.expectedRole),
    setAdmin: (id: UserId, isAdmin: boolean) => change(id, isAdmin ? 'admin' : 'user'),
    initializePlatformRoles: async (): Promise<{ initialized: number }> => {
      let initialized = 0;
      for (;;) {
        const batch = await users.uninitializedRoles(100);
        if (!batch.length) return { initialized };
        for (const user of batch) {
          await roleLock.run(user.id, async () => {
            const links = await memberships.membershipsOf(user.id);
            const role = links.some((m) => m.role === 'owner' || m.role === 'developer') ? 'developer' : 'user';
            if (await users.initializeRole(user.id, role)) initialized += 1;
          });
        }
      }
    },
  };
}
