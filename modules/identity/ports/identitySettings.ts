/** 来自安装配置：哪些邮箱一登录就是管理员。 */
export interface IdentitySettings {
  readonly adminEmails: readonly string[];
}
