#!/usr/bin/env bun
/**
 * 本机验收用的最小 IdP（RFC-005 §10）。**不是生产件**：没有真实用户、没有同意页、没有速率限制。
 * 它要能覆盖三种真实形态，因为公司内部系统常常只是其中一种：
 *   1. 标准 OIDC：有 discovery、有 id_token（RS256）、有 JWKS；
 *   2. 纯 OAuth 2.0：`--no-discovery --no-id-token`，身份只能来自 userinfo；
 *   3. 非标 userinfo：`--userinfo-style post_json --subject-field id`，体为 { client_id, access_token, scope }。
 *
 * 跑法：bun run tools/mock-idp/main.ts [--port 9001] [--issuer http://...]
 * 授权页给出几个固定身份的按钮，点一下就带 code 回跳。
 */
import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';

const args = process.argv.slice(2);
const flag = (name: string, fallback?: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const has = (name: string): boolean => args.includes(`--${name}`);

const PORT = Number(flag('port', '9001'));
const ISSUER = flag('issuer', `http://localhost:${PORT}`) as string;
/**
 * 浏览器要走的授权地址可以与服务端到服务端的地址不同——真实 IdP 也常是这样（公网入口 vs 内网入口）。
 * 本机验收就靠它：cs-auth 用 host.docker.internal 取 discovery／换码／取 JWKS，浏览器用 127.0.0.1 打授权页。
 */
const BROWSER_ORIGIN = flag('browser-origin', ISSUER) as string;
const CLIENT_ID = flag('client-id', 'mock-client') as string;
const CLIENT_SECRET = flag('client-secret', 'mock-secret') as string;
const WITH_DISCOVERY = !has('no-discovery');
const WITH_ID_TOKEN = !has('no-id-token');
const USERINFO_STYLE = flag('userinfo-style', 'get_bearer');
const SUBJECT_FIELD = flag('subject-field', 'sub') as string;

const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
const kid = randomBytes(8).toString('hex');
const publicJwk = { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' };

interface MockUser { readonly sub: string; readonly email: string; readonly name: string; readonly empNo: string; readonly dept: string }
const USERS: readonly MockUser[] = [
  { sub: 'mock-alice', email: 'alice@corp.example', name: 'Alice（mock）', empNo: 'E-1001', dept: '平台组' },
  { sub: 'mock-bob', email: 'bob@corp.example', name: 'Bob（mock）', empNo: 'E-1002', dept: '业务组' },
  { sub: 'mock-outsider', email: 'outsider@other.example', name: 'Outsider（mock）', empNo: 'E-2001', dept: '外部' },
];

interface PendingCode { readonly user: MockUser; readonly redirectUri: string; readonly codeChallenge: string; readonly nonce: string; readonly expiresAt: number }
const codes = new Map<string, PendingCode>();
const tokens = new Map<string, MockUser>();

function base64url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function html(body: string): Response {
  return new Response(`<!doctype html><meta charset="utf-8"><title>mock IdP</title><body style="font-family:system-ui;padding:24px">${body}</body>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function userinfoBody(user: MockUser): Record<string, unknown> {
  const base: Record<string, unknown> = { email: user.email, email_verified: true, name: user.name, preferred_username: user.sub, empNo: user.empNo, deptName: user.dept };
  base[SUBJECT_FIELD] = SUBJECT_FIELD === 'id' ? Number(user.empNo.replace(/\D/g, '')) : user.sub;
  return base;
}

const server = Bun.serve({
  port: PORT,
  fetch: async (request) => {
    const url = new URL(request.url);
    if (url.pathname === '/.well-known/openid-configuration') {
      if (!WITH_DISCOVERY) return json({ error: 'not_found' }, 404);
      return json({
        issuer: ISSUER,
        authorization_endpoint: `${BROWSER_ORIGIN}/authorize`,
        token_endpoint: `${ISSUER}/token`,
        userinfo_endpoint: `${ISSUER}/userinfo`,
        jwks_uri: `${ISSUER}/jwks.json`,
        scopes_supported: ['openid', 'profile', 'email'],
        response_types_supported: ['code'],
        id_token_signing_alg_values_supported: ['RS256'],
      });
    }
    if (url.pathname === '/jwks.json') return json({ keys: [publicJwk] });

    if (url.pathname === '/authorize') {
      const redirectUri = url.searchParams.get('redirect_uri') ?? '';
      const state = url.searchParams.get('state') ?? '';
      const challenge = url.searchParams.get('code_challenge') ?? '';
      const nonce = url.searchParams.get('nonce') ?? '';
      if (url.searchParams.get('client_id') !== CLIENT_ID) return html(`<p>client_id 不对：${url.searchParams.get('client_id')}</p>`);
      const chosen = url.searchParams.get('as');
      if (chosen) {
        const user = USERS.find((u) => u.sub === chosen);
        if (!user) return html('<p>没有这个身份</p>');
        const code = base64url(randomBytes(24));
        codes.set(code, { user, redirectUri, codeChallenge: challenge, nonce, expiresAt: Date.now() + 5 * 60 * 1000 });
        const target = new URL(redirectUri);
        target.searchParams.set('code', code);
        target.searchParams.set('state', state);
        return new Response(null, { status: 302, headers: { location: target.toString() } });
      }
      const buttons = USERS.map((u) => `<p><a href="${url.pathname}${url.search}&as=${u.sub}">以 ${u.name} 登录（${u.email}）</a></p>`).join('');
      return html(`<h1>mock IdP</h1><p>回跳地址：<code>${redirectUri}</code></p>${buttons}`);
    }

    if (url.pathname === '/token' && request.method === 'POST') {
      const form = new URLSearchParams(await request.text());
      const pending = codes.get(form.get('code') ?? '');
      codes.delete(form.get('code') ?? '');
      if (!pending || pending.expiresAt < Date.now()) return json({ error: 'invalid_grant' }, 400);
      if (form.get('client_id') !== CLIENT_ID || form.get('client_secret') !== CLIENT_SECRET) return json({ error: 'invalid_client' }, 401);
      if (form.get('redirect_uri') !== pending.redirectUri) return json({ error: 'invalid_grant', error_description: 'redirect_uri 与授权时不一致' }, 400);
      // PKCE 必须真的校验：平台那侧的 verifier 若没带回来，这里就应该失败。
      const verifier = form.get('code_verifier') ?? '';
      if (base64url(createHash('sha256').update(verifier).digest()) !== pending.codeChallenge) return json({ error: 'invalid_grant', error_description: 'code_verifier 与 challenge 不符' }, 400);
      const accessToken = base64url(randomBytes(24));
      tokens.set(accessToken, pending.user);
      const body: Record<string, unknown> = { access_token: accessToken, token_type: 'Bearer', expires_in: 600 };
      if (WITH_ID_TOKEN) {
        body.id_token = await new SignJWT({ ...userinfoBody(pending.user), nonce: pending.nonce })
          .setProtectedHeader({ alg: 'RS256', kid })
          .setIssuer(ISSUER)
          .setAudience(CLIENT_ID)
          .setSubject(pending.user.sub)
          .setIssuedAt()
          .setExpirationTime('10m')
          .sign(privateKey);
      }
      return json(body);
    }

    if (url.pathname === '/userinfo') {
      let accessToken: string | null = null;
      if (USERINFO_STYLE === 'post_json' && request.method === 'POST') {
        const body = (await request.json()) as { access_token?: string; client_id?: string; scope?: string };
        if (body.client_id !== CLIENT_ID) return json({ error: 'invalid_client' }, 401);
        accessToken = body.access_token ?? null;
      } else {
        accessToken = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '') || null;
      }
      const user = accessToken ? tokens.get(accessToken) : undefined;
      if (!user) return json({ error: 'invalid_token' }, 401);
      return json(userinfoBody(user));
    }

    return json({ error: 'not_found', path: url.pathname }, 404);
  },
});

console.log(`[mock-idp] issuer=${ISSUER} port=${server.port} kid=${kid}`);
console.log(`[mock-idp] discovery=${WITH_DISCOVERY} idToken=${WITH_ID_TOKEN} userinfoStyle=${USERINFO_STYLE} subjectField=${SUBJECT_FIELD}`);
console.log(`[mock-idp] client_id=${CLIENT_ID} client_secret=${CLIENT_SECRET}`);
