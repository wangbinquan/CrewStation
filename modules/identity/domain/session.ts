import type { UserId } from '@crewstation/contracts';
import { HOST_PATTERNS, TOKEN_CLAIMS, UserIdSchema } from '@crewstation/contracts';

/** 浏览器会话 Cookie；只有 cs-auth 读它，业务只见网关注入的身份头与令牌。 */
export const SESSION_COOKIE_NAME = 'cs_session';
/** 会话 JWT 的 aud：只被 cs-auth 自己验证，不会注入任何业务请求。 */
export const SESSION_AUDIENCE = 'session';
/** 会话 JWT 里记录本次会话是怎么建立的；关闭常规登录要靠它判定（RFC-005 A2）。 */
export const SESSION_AUTH_CLAIM = 'cs_auth';
/** 目标是工作台（cs-api）时身份令牌的 aud。 */
export const CONSOLE_AUDIENCE = 'console';
/** 服务域上目标为平台 API 时来源令牌的 aud。 */
export const PLATFORM_API_AUDIENCE = 'platform-api';
/** 身份令牌与来源令牌绑定单次请求，寿命只需覆盖网关到业务的一跳。 */
export const IDENTITY_TOKEN_TTL_SECONDS = 300;
export const SOURCE_TOKEN_TTL_SECONDS = 300;
export const LOGIN_PATH = '/auth/login';
export const LOGOUT_PATH = '/auth/logout';

export interface SessionSettings {
  /** 用户域后缀，如 `cs.localhost`；returnTo 与 Host 解析都以它为界。 */
  readonly userDomain: string;
  /** 会话 Cookie 的 Domain，如 `.cs.localhost`，让工作台与各业务主机共用一次登录。 */
  readonly cookieDomain: string;
  /** 网关对外是否 https：决定 Cookie 的 Secure 与默认跳转 scheme。 */
  readonly secure: boolean;
  readonly sessionTtlSeconds: number;
}

export const DEFAULT_USER_DOMAIN = 'cs.localhost';
export const DEFAULT_SESSION_TTL_SECONDS = 8 * 3600;

export function withSessionDefaults(partial: Partial<SessionSettings>): SessionSettings {
  const userDomain = (partial.userDomain ?? DEFAULT_USER_DOMAIN).toLowerCase();
  return {
    userDomain,
    cookieDomain: partial.cookieDomain ?? `.${userDomain}`,
    secure: partial.secure ?? false,
    sessionTtlSeconds: partial.sessionTtlSeconds ?? DEFAULT_SESSION_TTL_SECONDS,
  };
}

/** 与 api/SessionCookieSpec 结构相同；HttpOnly、SameSite=Lax、Path=/ 是固定值。 */
export interface SessionCookie {
  readonly name: string;
  readonly domain: string;
  readonly path: '/';
  readonly httpOnly: true;
  readonly sameSite: 'Lax';
  readonly secure: boolean;
  readonly maxAgeSeconds: number;
}

export function sessionCookie(settings: SessionSettings): SessionCookie {
  return { name: SESSION_COOKIE_NAME, domain: settings.cookieDomain, path: '/', httpOnly: true, sameSite: 'Lax', secure: settings.secure, maxAgeSeconds: settings.sessionTtlSeconds };
}

export function userSubject(userId: UserId): string {
  return `${TOKEN_CLAIMS.subjectPrefixUser}${userId}`;
}

export function userIdFromSubject(subject: string): UserId | undefined {
  if (!subject.startsWith(TOKEN_CLAIMS.subjectPrefixUser)) return undefined;
  const parsed = UserIdSchema.safeParse(subject.slice(TOKEN_CLAIMS.subjectPrefixUser.length));
  return parsed.success ? parsed.data : undefined;
}

export function serviceSubject(identity: string): string {
  return `${TOKEN_CLAIMS.subjectPrefixService}${identity}`;
}

export function serviceAudience(identity: string): string {
  return `${TOKEN_CLAIMS.audiencePrefixService}${identity}`;
}

/** 跳转地址的 scheme：优先网关转发的 X-Forwarded-Proto，否则按安装配置。 */
export function schemeOf(settings: SessionSettings, forwarded?: string): 'http' | 'https' {
  const first = forwarded?.split(',')[0]?.trim().toLowerCase();
  if (first === 'http' || first === 'https') return first;
  return settings.secure ? 'https' : 'http';
}

export function consoleOrigin(settings: SessionSettings, scheme?: string): string {
  return `${schemeOf(settings, scheme)}://${HOST_PATTERNS.console.replace('{userDomain}', settings.userDomain)}`;
}

export function consoleUrl(settings: SessionSettings, scheme?: string): string {
  return `${consoleOrigin(settings, scheme)}/`;
}

export function loginUrl(settings: SessionSettings, returnTo: string, scheme?: string): string {
  return `${consoleOrigin(settings, scheme)}${LOGIN_PATH}?returnTo=${encodeURIComponent(returnTo)}`;
}

export function isUserDomainHost(hostname: string, userDomain: string): boolean {
  const host = hostname.toLowerCase();
  const domain = userDomain.toLowerCase();
  return host === domain || host.endsWith(`.${domain}`);
}

/** returnTo 只接受用户域内的 http(s) 地址（相对路径按工作台解析）；其余一律回工作台首页，防止开放跳转。 */
export function resolveReturnTo(raw: string | undefined, settings: SessionSettings, scheme?: string): string {
  const fallback = consoleUrl(settings, scheme);
  if (!raw || raw.trim() === '') return fallback;
  let url: URL;
  try {
    url = new URL(raw, fallback);
  } catch {
    return fallback;
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return fallback;
  return isUserDomainHost(url.hostname, settings.userDomain) ? url.toString() : fallback;
}
