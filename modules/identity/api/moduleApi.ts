import type { AuthStatusDto, CurrentUserDto, IdentityProviderKind, JwksDocument, UserDto, UserId, WorkloadIdentity } from '@crewstation/contracts';

export interface ExternalUser {
  /** 登录适配器给出的稳定外部标识（OIDC sub 或 `demo:<username>`）。 */
  externalId: string;
  name: string;
  email: string;
}

/** 登录页：演示适配器返回 HTML 表单，OIDC 适配器返回跳转地址。 */
export type LoginPage = { kind: 'html'; html: string } | { kind: 'redirect'; location: string };

/** 登录提交的原始字段（表单或 JSON），由登录适配器按自身 Schema 校验。 */
export type LoginInput = Record<string, unknown>;

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

/** 放行时要注入的头值，已做 HTTP 头安全编码；键名与 contracts IDENTITY_HEADERS 对应。 */
export interface InjectedUserIdentity {
  userId: string;
  userName: string;
  userEmail: string;
  identityToken: string;
}

export type UserAuthDecision =
  | { kind: 'allow'; user: UserDto; audience: string; injected: InjectedUserIdentity }
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

/**
 * identity 模块对外能力。管理面（用户目录与管理员标记）供所有进程；运行面（登录、会话、ForwardAuth、JWKS）供 cs-auth。
 * 其他模块经 ports 注入其中的子集。
 */
export interface IdentityModuleApi {
  readonly name: 'identity';
  /** 登录成功后按外部标识幂等建档；首个用户或安装配置指定的邮箱成为管理员。 */
  ensureUser(external: ExternalUser): Promise<UserDto>;
  getUser(userId: UserId): Promise<UserDto | undefined>;
  findByEmail(email: string): Promise<UserDto | undefined>;
  isAdmin(userId: UserId): Promise<boolean>;
  listUsers(): Promise<UserDto[]>;
  setAdmin(userId: UserId, isAdmin: boolean): Promise<UserDto>;
  /** 未配置登录适配器时为 undefined；此时 /auth/* 回 503。 */
  readonly providerKind: IdentityProviderKind | undefined;
  readonly sessionCookie: SessionCookieSpec;
  authStatus(): AuthStatusDto;
  loginPage(returnTo: string | undefined, context?: LoginContext): Promise<LoginPage>;
  login(input: LoginInput, context?: LoginContext): Promise<LoginResult>;
  /** 登出后的跳转地址：登录页并保留校验过的 returnTo。 */
  logoutRedirect(returnTo: string | undefined, context?: LoginContext): string;
  /** 会话令牌 → 用户；无效、过期或用户不存在返回 undefined。 */
  resolveSession(token: string): Promise<UserDto | undefined>;
  authorizeUserRequest(request: UserAuthRequest): Promise<UserAuthDecision>;
  authorizeServiceRequest(request: ServiceAuthRequest): Promise<ServiceAuthDecision>;
  currentUser(userId: UserId): Promise<CurrentUserDto>;
  jwks(): Promise<JwksDocument>;
  /** 生成新签名钥，旧钥进入重叠期继续验签。 */
  rotateSigningKey(): Promise<{ kid: string }>;
}
