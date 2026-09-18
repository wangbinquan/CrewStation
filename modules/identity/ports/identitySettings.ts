import type { SessionSettings } from '../domain/session';

/** 来自安装配置：管理员邮箱与会话参数；会话参数缺省见 domain/session withSessionDefaults。 */
export interface IdentitySettings extends Partial<SessionSettings> {
  /** 哪些邮箱一登录就是管理员。 */
  readonly adminEmails: readonly string[];
  /** 安装期下发的引导令牌（Secret → 环境变量）；只能用来创建首位管理员，完成态以数据库为准。 */
  readonly bootstrapToken?: string;
  /** `CS_PASSWORD_LOGIN=force-on`：IdP 全不可达时的破窗口，压过库内策略（RFC-005 A7）。 */
  readonly passwordLoginForcedOn?: boolean;
  /** 安装密钥的 base64；用于封存身份提供方的 client_secret。 */
  readonly secretKey?: string;
}
