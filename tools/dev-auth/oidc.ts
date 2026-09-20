import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { DEV_ROLES, findDevRole } from './roles';
import type { DevRole } from './roles';

export const DEV_OIDC_CLIENT_ID = 'crewstation-dev-auth';

interface PendingCode {
  readonly role: DevRole;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly nonce: string;
  readonly expiresAt: number;
}

export interface DevOidcOptions {
  readonly issuer: () => string;
  readonly authorizationOrigin: () => string;
  readonly clientSecret: string;
  readonly allowedRedirectOrigin?: string;
}

export interface DevOidc {
  fetch(request: Request, routePrefix: string): Promise<Response>;
}

const noStore = { 'cache-control': 'no-store' };
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { ...noStore, 'content-type': 'application/json' } });
const html = (body: string, status = 200): Response => new Response(`<!doctype html><meta charset="utf-8"><title>CrewStation dev IdP</title><body style="font-family:system-ui;background:#0b0d12;color:#f4f7fb;padding:28px">${body}</body>`, { status, headers: { ...noStore, 'content-type': 'text/html; charset=utf-8' } });
const base64url = (value: Buffer): string => value.toString('base64url');
const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] as string);

function userinfo(role: DevRole): Record<string, unknown> {
  return { sub: role.sub, email: role.email, email_verified: true, name: role.name, preferred_username: role.username };
}

function validAuthorize(url: URL, options: DevOidcOptions): string | undefined {
  if (url.searchParams.get('client_id') !== DEV_OIDC_CLIENT_ID) return 'client_id 不正确';
  if (url.searchParams.get('response_type') !== 'code') return '只支持 authorization_code';
  if (url.searchParams.get('code_challenge_method') !== 'S256') return '必须使用 PKCE S256';
  if (!url.searchParams.get('code_challenge') || !url.searchParams.get('state') || !url.searchParams.get('nonce')) return '缺少 state、nonce 或 code_challenge';
  const redirect = url.searchParams.get('redirect_uri') ?? '';
  if (!URL.canParse(redirect) || !/^https?:$/i.test(new URL(redirect).protocol)) return 'redirect_uri 不合法';
  if (options.allowedRedirectOrigin && new URL(redirect).origin !== options.allowedRedirectOrigin) return 'redirect_uri 不属于 CrewStation 控制台';
  return undefined;
}

function chooseRole(url: URL): Response {
  const links = DEV_ROLES.map((role) => {
    const target = new URL(url);
    target.searchParams.set('as', role.sub);
    return `<li><a style="color:#55e6a5" href="${escapeHtml(`${target.pathname}${target.search}`)}">${escapeHtml(role.title)} · ${escapeHtml(role.email)}</a></li>`;
  }).join('');
  return html(`<h1>选择开发角色</h1><p>正常的一键入口不会停在这里；此页用于协议调试。</p><ul>${links}</ul>`);
}

export async function createDevOidc(options: DevOidcOptions): Promise<DevOidc> {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const kid = randomBytes(8).toString('hex');
  const publicJwk = { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' };
  const codes = new Map<string, PendingCode>();
  const tokens = new Map<string, DevRole>();

  const authorize = (url: URL): Response => {
    const issue = validAuthorize(url, options);
    if (issue) return json({ error: 'invalid_request', error_description: issue }, 400);
    const role = findDevRole(url.searchParams.get('as'));
    if (!role) return url.searchParams.has('as') ? json({ error: 'access_denied', error_description: '未知开发角色' }, 400) : chooseRole(url);
    const code = base64url(randomBytes(24));
    codes.set(code, {
      role, redirectUri: url.searchParams.get('redirect_uri') as string, codeChallenge: url.searchParams.get('code_challenge') as string,
      nonce: url.searchParams.get('nonce') as string, expiresAt: Date.now() + 5 * 60 * 1000,
    });
    const callback = new URL(url.searchParams.get('redirect_uri') as string);
    callback.searchParams.set('code', code);
    callback.searchParams.set('state', url.searchParams.get('state') as string);
    return new Response(null, { status: 302, headers: { ...noStore, location: callback.toString() } });
  };

  const token = async (request: Request): Promise<Response> => {
    const form = new URLSearchParams(await request.text());
    const code = form.get('code') ?? '';
    const pending = codes.get(code);
    codes.delete(code);
    if (!pending || pending.expiresAt < Date.now()) return json({ error: 'invalid_grant' }, 400);
    if (form.get('grant_type') !== 'authorization_code') return json({ error: 'unsupported_grant_type' }, 400);
    if (form.get('client_id') !== DEV_OIDC_CLIENT_ID || form.get('client_secret') !== options.clientSecret) return json({ error: 'invalid_client' }, 401);
    if (form.get('redirect_uri') !== pending.redirectUri) return json({ error: 'invalid_grant', error_description: 'redirect_uri 不一致' }, 400);
    const verifier = form.get('code_verifier') ?? '';
    if (base64url(createHash('sha256').update(verifier).digest()) !== pending.codeChallenge) return json({ error: 'invalid_grant', error_description: 'PKCE 校验失败' }, 400);
    const accessToken = base64url(randomBytes(24));
    tokens.set(accessToken, pending.role);
    const idToken = await new SignJWT({ ...userinfo(pending.role), nonce: pending.nonce })
      .setProtectedHeader({ alg: 'RS256', kid }).setIssuer(options.issuer()).setAudience(DEV_OIDC_CLIENT_ID)
      .setSubject(pending.role.sub).setIssuedAt().setExpirationTime('10m').sign(privateKey);
    return json({ access_token: accessToken, token_type: 'Bearer', expires_in: 600, id_token: idToken });
  };

  const fetchRequest = async (request: Request, routePrefix: string): Promise<Response> => {
    const url = new URL(request.url);
    const path = url.pathname.slice(routePrefix.length) || '/';
    const issuer = options.issuer();
    if (path === '/.well-known/openid-configuration') return json({
      issuer, authorization_endpoint: `${options.authorizationOrigin()}${routePrefix}/authorize`, token_endpoint: `${issuer}/token`,
      userinfo_endpoint: `${issuer}/userinfo`, jwks_uri: `${issuer}/jwks.json`, scopes_supported: ['openid', 'profile', 'email'],
      response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'],
      code_challenge_methods_supported: ['S256'],
    });
    if (path === '/jwks.json') return json({ keys: [publicJwk] });
    if (path === '/authorize' && request.method === 'GET') return authorize(url);
    if (path === '/token' && request.method === 'POST') return token(request);
    if (path === '/userinfo') {
      const accessToken = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
      const role = tokens.get(accessToken);
      return role ? json(userinfo(role)) : json({ error: 'invalid_token' }, 401);
    }
    return json({ error: 'not_found' }, 404);
  };
  return { fetch: fetchRequest };
}
