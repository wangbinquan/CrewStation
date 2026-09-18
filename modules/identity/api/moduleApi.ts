import type {
  AuthMethod, CurrentUserDto, EffectiveForwardingDto, IdentityForwardingDto, JwksDocument, LoginDiscoveryDto, LoginPolicyDto,
  OidcLoginFailureCode, OidcProbeResult, OidcProviderDto, OidcProviderId, ProjectId, ServiceId, TaskId, UserDto, UserId, WorkloadIdentity,
} from '@crewstation/contracts';

/** 登录提交的原始字段（表单或 JSON），由用例按契约 Schema 校验。 */
export type LoginInput = Record<string, unknown>;

/**
 * 外部标识形态的用户：`local:<username>`（引导管理员）或 `oidc:<providerId>:<subject>`。
 * 外部身份的权威索引是 identity.user_identities（provider＋subject 唯一）；这里的标识是人可读的自然键。
 */
export interface ExternalUser {
  externalId: string;
  name: string;
  email: string;
}

/** 网关转发的 scheme（X-Forwarded-Proto）；决定跳转地址是 http 还是 https，缺省按安装配置。 */
export interface LoginContext {
  scheme?: string;
}

export interface IssuedSession {
  token: string;
  expiresAt: Date;
}

export interface LoginResult {
  user: UserDto;
  session: IssuedSession;
  /** 已校验：只会是用户域内地址或工作台首页。 */
  returnTo: string;
}

/** 会话 Cookie 属性；http 层照此写入与清除。 */
export interface SessionCookieSpec {
  readonly name: string;
  readonly domain: string;
  readonly path: '/';
  readonly httpOnly: true;
  readonly sameSite: 'Lax';
  readonly secure: boolean;
  readonly maxAgeSeconds: number;
}

/** 用户域 ForwardAuth 的输入：网关转发的原始请求要素。 */
export interface UserAuthRequest {
  scheme?: string;
  host: string;
  uri: string;
  method: string;
  /** cs_session Cookie 的值。 */
  sessionToken?: string;
  accept?: string;
}

/**
 * 放行时要注入的头，值已做 HTTP 头安全编码。用户 ID 与身份令牌恒定注入；
 * `attributes` 的键是完整头名，内容由「身份转发」配置决定（RFC-005 §7.2）——
 * 不在生效集里的字段**不出现**，而不是给一个空串。
 */
export interface InjectedUserIdentity {
  userId: string;
  identityToken: string;
  attributes: Record<string, string>;
}

export type UserAuthDecision =
  | { kind: 'allow'; user: UserDto; audience: string; authMethod: AuthMethod; injected: InjectedUserIdentity }
  | { kind: 'login-redirect'; location: string }
  | { kind: 'unauthenticated'; message: string }
  | { kind: 'forbidden'; message: string };

export interface ServiceAuthRequest {
  /** X-Forwarded-For；第一跳即源 Pod IP。 */
  forwardedFor?: string;
  host: string;
  method: string;
  uri: string;
  /** 调用方带来的 x-cs-trace-id；合法则沿用，否则新生成。 */
  traceId?: string;
}

export interface InjectedServiceIdentity {
  sourceService: string;
  sourceSlot?: string;
  sourceToken: string;
  traceId: string;
}

export type ServiceAuthDecision =
  | { kind: 'allow'; caller: WorkloadIdentity; audience: string; traceId: string; injected: InjectedServiceIdentity }
  | { kind: 'forbidden'; message: string; reason?: string };

/** 一枚开发会话令牌绑定的会话、项目、服务与用户；签发与校验两侧共用这一份形状。 */
export interface DevSessionBinding {
  readonly taskId: TaskId;
  readonly projectId: ProjectId;
  readonly serviceId: ServiceId;
  readonly userId: UserId;
}

/** 令牌值只在此处返回一次，交给注入方写进容器；任何日志、响应与错误都不得再出现它。 */
export interface IssuedDevSessionToken {
  readonly token: string;
  readonly expiresAt: string;
}

export interface ResolvedDevSession extends DevSessionBinding {
  readonly user: UserDto;
}

/** 管理面调用者：网关注入的身份加 identity 自己回答的管理员标记，以及 ForwardAuth 注入的认证方式。 */
export interface AuthAdminActor {
  readonly userId: UserId;
  readonly isAdmin: boolean;
  readonly authMethod: AuthMethod;
}

/** OIDC 回调的结果：要么拿到会话，要么是一个可呈现的失败码（http 据此渲染原因页）。 */
export type OidcCallbackOutcome =
  | { readonly kind: 'session'; readonly user: UserDto; readonly session: IssuedSession; readonly returnTo: string }
  | { readonly kind: 'failed'; readonly code: OidcLoginFailureCode };

/**
 * identity 模块对外能力。管理面（用户目录、登录策略、身份提供方、身份转发）供 cs-api；
 * 运行面（登录、引导、OIDC、会话、ForwardAuth、JWKS）供 cs-auth。其他模块经 ports 注入其中的子集。
 */
export interface IdentityModuleApi {
  readonly name: 'identity';
  /** 按外部标识幂等建档；供测试与其他模块播种用户，OIDC 建档走自己的事务路径。 */
  ensureUser(external: ExternalUser): Promise<UserDto>;
  getUser(userId: UserId): Promise<UserDto | undefined>;
  findByEmail(email: string): Promise<UserDto | undefined>;
  isAdmin(userId: UserId): Promise<boolean>;
  listUsers(): Promise<UserDto[]>;
  setAdmin(userId: UserId, isAdmin: boolean): Promise<UserDto>;
  readonly sessionCookie: SessionCookieSpec;

  /** 登录方法发现：引导未完成时只有引导令牌一条路。 */
  loginMethods(): Promise<LoginDiscoveryDto>;
  /** 服务端渲染的登录页，方法完全由 loginMethods 决定。 */
  loginPageHtml(returnTo: string | undefined, context?: LoginContext, error?: string, justBootstrapped?: boolean): Promise<string>;
  /** 常规登录（本地用户名＋密码）。 */
  passwordLogin(input: LoginInput, context?: LoginContext): Promise<LoginResult>;
  /** 引导页与创建首位管理员；成功后引导令牌永久退役，且不返回会话。 */
  bootstrapPageHtml(error?: string): string;
  bootstrapStatus(): Promise<{ required: boolean }>;
  bootstrapAdmin(raw: unknown): Promise<UserDto>;
  /** 发起 OIDC 登录：落库 PKCE／state／nonce 并给出跳转地址。 */
  startOidcLogin(slug: string, returnTo: string | undefined, context?: LoginContext): Promise<{ location: string }>;
  completeOidcLogin(query: { code?: string; state?: string }): Promise<OidcCallbackOutcome>;
  loginErrorPageHtml(code: OidcLoginFailureCode): string;
  /** 登出后的跳转地址：登录页并保留校验过的 returnTo。 */
  logoutRedirect(returnTo: string | undefined, context?: LoginContext): string;
  /** 用户域上被拒绝的浏览器导航要显示的页面：原因原话＋返回工作台。 */
  forbiddenPage(message: string, context?: LoginContext): string;

  /** 会话令牌 → 用户；无效、过期或用户不存在返回 undefined。 */
  resolveSession(token: string): Promise<UserDto | undefined>;
  authorizeUserRequest(request: UserAuthRequest): Promise<UserAuthDecision>;
  authorizeServiceRequest(request: ServiceAuthRequest): Promise<ServiceAuthDecision>;

  /** 登录策略：读与改；关闭常规登录要求调用者是管理员且当前会话来自 OIDC。 */
  readLoginPolicy(actor: AuthAdminActor): Promise<LoginPolicyDto>;
  setPasswordLoginEnabled(actor: AuthAdminActor, enabled: boolean): Promise<LoginPolicyDto>;

  /** 身份提供方：CRUD 与测试连接。响应永不含 client_secret。 */
  listProviders(actor: AuthAdminActor): Promise<OidcProviderDto[]>;
  getProvider(actor: AuthAdminActor, id: OidcProviderId): Promise<OidcProviderDto>;
  createProvider(actor: AuthAdminActor, raw: unknown): Promise<OidcProviderDto>;
  patchProvider(actor: AuthAdminActor, id: OidcProviderId, raw: unknown): Promise<OidcProviderDto>;
  removeProvider(actor: AuthAdminActor, id: OidcProviderId): Promise<void>;
  probeProvider(actor: AuthAdminActor, id: OidcProviderId): Promise<OidcProbeResult>;

  /** 身份转发：全局默认与按项目覆盖，加上某项目的生效预览（能力说明读同一份）。 */
  readForwarding(actor: AuthAdminActor): Promise<IdentityForwardingDto>;
  setGlobalForwarding(actor: AuthAdminActor, raw: unknown): Promise<void>;
  setProjectForwarding(actor: AuthAdminActor, projectId: ProjectId, raw: unknown): Promise<void>;
  clearProjectForwarding(actor: AuthAdminActor, projectId: ProjectId): Promise<void>;
  effectiveForwarding(projectId: ProjectId): Promise<EffectiveForwardingDto>;

  /** 签发绑定单个开发会话的短期令牌，供平台写进容器里两个 CLI 的远程 MCP 连接头（Design §5.9）。 */
  issueDevSessionToken(binding: DevSessionBinding): Promise<IssuedDevSessionToken>;
  /** 校验开发会话令牌：签名、aud、exp 之外还现查会话是否仍在运行；任一不符返回 undefined，不解释原因。 */
  resolveDevSessionToken(token: string): Promise<ResolvedDevSession | undefined>;
  currentUser(userId: UserId, authMethod?: AuthMethod): Promise<CurrentUserDto>;
  jwks(): Promise<JwksDocument>;
  /** 生成新签名钥，旧钥进入重叠期继续验签。 */
  rotateSigningKey(): Promise<{ kid: string }>;
}
