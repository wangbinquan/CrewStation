/** 来自安装配置：平台如何到达 GitLab、以谁的身份建仓与打标。 */
export interface ScmSettings {
  /** 平台自身访问 GitLab 的地址（集群内可能是 `http://host.docker.internal:8929`）。 */
  readonly baseUrl: string;
  /** 所有业务仓库所在的组路径。 */
  readonly groupPath: string;
  /** 平台机器人的令牌：建仓、代推、打标都用它；业务用户永远拿不到打标权。 */
  readonly platformToken: string;
  readonly platformBotName: string;
  readonly platformBotEmail?: string;
  /** 首版固定 `main`。 */
  readonly defaultBranch: string;
  /** 会话凭据地址模板里的用户名；GitLab 只看密码位。 */
  readonly credentialUsername?: string;
}
