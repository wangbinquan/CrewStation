import type { BootstrapAdminRequest, UserDto, UserId } from '@crewstation/contracts';
import { BootstrapAdminRequestSchema } from '@crewstation/contracts';
import { PlatformError, conflict, newId, validation } from '@crewstation/kernel';
import { bootstrapTokenUsable } from '../domain/loginMethods';
import { bootstrapTokenMatches } from '../domain/oidcFlow';
import type { User } from '../domain/user';
import type { IdentityUseCaseDeps } from './dependencies';
import { toDto } from './ensureUser';

type Deps = Pick<IdentityUseCaseDeps, 'uow' | 'passwords' | 'settings' | 'clock'>;

/**
 * 引导交接（RFC-005 §5 ①→②）：引导令牌只能做这一件事，做完即永久退役。
 * 「插入首位管理员」「置完成态」「强制打开密码登录」在同一个事务里；
 * 并发提交至多一个成功，失败方零插入——完成态的条件更新就是那把锁。
 */
export function bootstrapAdminUseCases(deps: Deps) {
  return {
    bootstrapStatus: async (): Promise<{ required: boolean }> => ({ required: bootstrapTokenUsable(await deps.uow.read.policy.read()) }),
    bootstrapAdmin: async (raw: unknown): Promise<UserDto> => {
      const parsed = BootstrapAdminRequestSchema.safeParse(raw);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
        throw validation(`引导参数不正确：${issues.map((i) => `${i.path || '$'}: ${i.message}`).join('；')}`, { issues });
      }
      const request: BootstrapAdminRequest = parsed.data;
      if (!bootstrapTokenUsable(await deps.uow.read.policy.read())) throw conflict('首位管理员已创建，引导令牌已退役', { code: 'bootstrap-already-complete' });
      if (!bootstrapTokenMatches(deps.settings.bootstrapToken, request.token)) {
        throw new PlatformError('forbidden', '引导令牌不正确', { code: 'bootstrap-token-invalid' });
      }
      const passwordHash = await deps.passwords.hash(request.password);
      const now = deps.clock.now();
      return deps.uow.run(async (scope) => {
        if (!(await scope.policy.completeBootstrap(now))) throw conflict('首位管理员已创建，引导令牌已退役', { code: 'bootstrap-already-complete' });
        const username = request.username.toLowerCase();
        const email = request.email.toLowerCase();
        if (await scope.users.getByUsername(username)) throw conflict(`用户名 ${username} 已存在`, { code: 'username-taken' });
        const admin: User = {
          id: newId('usr') as UserId,
          externalId: `local:${username}`,
          username,
          name: request.displayName,
          email,
          gitName: request.displayName,
          passwordHash,
          platformRole: 'admin',
          createdAt: now,
          lastLoginAt: now,
        };
        await scope.users.insert(admin);
        return toDto(admin);
      });
    },
  };
}
