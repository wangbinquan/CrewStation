import type { SessionSettings } from '../domain/session';

/** 来自安装配置：管理员邮箱与会话参数；会话参数缺省见 domain/session withSessionDefaults。 */
export interface IdentitySettings extends Partial<SessionSettings> {
  /** 哪些邮箱一登录就是管理员。 */
  readonly adminEmails: readonly string[];
}
