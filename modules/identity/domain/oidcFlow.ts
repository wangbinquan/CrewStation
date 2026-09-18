import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 一次登录跳转要记住的东西；落库（identity.oidc_flows）而不是进程内，多副本才成立。 */
export interface OidcFlowSeed {
  readonly state: string;
  readonly codeVerifier: string;
  readonly codeChallenge: string;
  readonly nonce: string;
}

export const OIDC_FLOW_TTL_SECONDS = 300;

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function newOidcFlowSeed(): OidcFlowSeed {
  const codeVerifier = base64url(randomBytes(48));
  return {
    state: base64url(randomBytes(32)),
    codeVerifier,
    codeChallenge: base64url(createHash('sha256').update(codeVerifier).digest()),
    nonce: base64url(randomBytes(16)),
  };
}

/** PKCE 校验（给 mock IdP 与测试用同一份实现，避免两边算法漂移）。 */
export function codeChallengeOf(codeVerifier: string): string {
  return base64url(createHash('sha256').update(codeVerifier).digest());
}

/**
 * 回调地址由安装配置推出并在 start 与 callback 两侧一致，**不读请求的 Host**：
 * 读 Host 等于让伪造的 Host 改写 redirect_uri。
 */
export function oidcRedirectUri(consoleOrigin: string, slug: string): string {
  return `${consoleOrigin}/auth/oidc/${slug}/callback`;
}

export function buildAuthorizeUrl(endpoint: string, args: {
  readonly clientId: string;
  readonly scopes: string;
  readonly state: string;
  readonly codeChallenge: string;
  readonly nonce: string;
  readonly redirectUri: string;
}): string {
  const url = new URL(endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', args.clientId);
  url.searchParams.set('redirect_uri', args.redirectUri);
  url.searchParams.set('scope', args.scopes);
  url.searchParams.set('state', args.state);
  url.searchParams.set('code_challenge', args.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('nonce', args.nonce);
  return url.toString();
}

/** 引导令牌比较：恒定时间，且长度不同也不提前返回出长度信息。 */
export function bootstrapTokenMatches(expected: string | undefined, presented: string): boolean {
  if (!expected) return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(presented, 'utf8');
  const width = Math.max(a.length, b.length, 1);
  const pad = (buf: Buffer): Buffer => Buffer.concat([buf, Buffer.alloc(width - buf.length)]);
  return timingSafeEqual(pad(a), pad(b)) && a.length === b.length;
}
