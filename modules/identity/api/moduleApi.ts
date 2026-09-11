import type { UserDto, UserId } from '@crewstation/contracts';

export interface ExternalUser {
  /** 登录适配器给出的稳定外部标识（OIDC sub 或演示身份名）。 */
  externalId: string;
  name: string;
  email: string;
}

/** identity 模块对外能力：用户目录与管理员标记；登录、令牌与服务身份解析随 cs-auth 运行面加入。 */
export interface IdentityModuleApi {
  readonly name: 'identity';
  /** 登录成功后按外部标识幂等建档；首个用户或安装配置指定的邮箱成为管理员。 */
  ensureUser(external: ExternalUser): Promise<UserDto>;
  getUser(userId: UserId): Promise<UserDto | undefined>;
  findByEmail(email: string): Promise<UserDto | undefined>;
  isAdmin(userId: UserId): Promise<boolean>;
  listUsers(): Promise<UserDto[]>;
  setAdmin(userId: UserId, isAdmin: boolean): Promise<UserDto>;
}
