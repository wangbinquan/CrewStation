import { createRemoteJwks, verifyIdToken } from '@crewstation/jwt';
import type { Logger } from '@crewstation/kernel';
import type { DiscoveryDocument } from '../../domain/endpointResolution';
import { OidcLoginError } from '../../domain/idpClaims';
import type { IdpClient } from '../../ports/idpClient';

const DISCOVERY_TIMEOUT_MS = 10_000;
const USERINFO_TIMEOUT_MS = 10_000;
/** 恶意或故障的 IdP 不能用一条无上限的响应体把 cs-auth 的内存吃光。 */
const USERINFO_MAX_BODY_BYTES = 256 * 1024;

export interface HttpIdpClientDeps {
  readonly fetch?: typeof fetch;
  readonly logger?: Logger;
}

/** 与企业 IdP 的全部出向交互；每种失败都落到一个确定的 OidcFailureCode 上。 */
export function httpIdpClient(deps: HttpIdpClientDeps = {}): IdpClient {
  const fetcher = deps.fetch ?? globalThis.fetch;
  return { ...discoveryCalls(fetcher), ...tokenCalls(fetcher), ...profileCalls(fetcher) };
}

function discoveryCalls(fetcher: typeof fetch): Pick<IdpClient, 'discover' | 'jwksReachable'> {
  return {
    discover: async (issuerUrl) => {
      const url = `${issuerUrl.replace(/\/$/, '')}/.well-known/openid-configuration`;
      const response = await fetcher(url, { method: 'GET', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`oidc-discovery-failed status=${response.status}`);
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        throw new Error('oidc-discovery-not-json');
      }
      if (typeof json !== 'object' || json === null || Array.isArray(json)) throw new Error('oidc-discovery-not-object');
      return json as DiscoveryDocument;
    },

    jwksReachable: async (jwksUri) => {
      try {
        const response = await fetcher(jwksUri, { method: 'GET', signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS) });
        if (!response.ok) return false;
        // 200 但正文是 HTML 或空对象，照样验不了任何令牌：「可达」必须意味着「给出一份 JWKS」。
        const body = (await response.json()) as { keys?: unknown };
        return typeof body === 'object' && body !== null && Array.isArray(body.keys);
      } catch {
        return false;
      }
    },
  };
}

function tokenCalls(fetcher: typeof fetch): Pick<IdpClient, 'exchangeCode' | 'verifyIdToken'> {
  return {
    exchangeCode: async (input) => {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code: input.code,
        redirect_uri: input.redirectUri,
        client_id: input.clientId,
        client_secret: input.clientSecret,
        code_verifier: input.codeVerifier,
      });
      let response: Response;
      try {
        response = await fetcher(input.tokenEndpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
          body: body.toString(),
          signal: AbortSignal.timeout(USERINFO_TIMEOUT_MS),
        });
      } catch (error) {
        throw new OidcLoginError('token-exchange-failed', `换码请求失败：${message(error)}`);
      }
      if (!response.ok) throw new OidcLoginError('token-exchange-failed', `换码返回 ${response.status}`);
      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch {
        throw new OidcLoginError('token-exchange-failed', '换码响应不是 JSON');
      }
      const json = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<string, unknown>;
      if (typeof json.access_token !== 'string' || json.access_token.length === 0) throw new OidcLoginError('token-exchange-failed', '换码响应里没有 access_token');
      // 非字符串的 id_token（null、数字）按「没有」处理：纯 OAuth2 服务器常把这个字段填脏。
      const idToken = typeof json.id_token === 'string' && json.id_token.length > 0 ? json.id_token : null;
      return { accessToken: json.access_token, idToken };
    },

    verifyIdToken: async (input) => {
      try {
        return await verifyIdToken({ idToken: input.idToken, jwks: createRemoteJwks(input.jwksUri), issuer: input.issuer, audience: input.audience, nonce: input.nonce });
      } catch (error) {
        throw new OidcLoginError('id-token-verify-failed', `令牌验签失败：${message(error)}`);
      }
    },
  };
}

function profileCalls(fetcher: typeof fetch): Pick<IdpClient, 'fetchUserinfo'> {
  return {
    fetchUserinfo: async (input) => {
      const init: RequestInit = input.requestStyle === 'post_json'
        ? {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ client_id: input.clientId, access_token: input.accessToken, scope: input.scopes }),
            signal: AbortSignal.timeout(USERINFO_TIMEOUT_MS),
          }
        : {
            method: 'GET',
            headers: { authorization: `Bearer ${input.accessToken}`, accept: 'application/json' },
            signal: AbortSignal.timeout(USERINFO_TIMEOUT_MS),
          };
      let response: Response;
      try {
        response = await fetcher(input.userinfoEndpoint, init);
      } catch (error) {
        throw new OidcLoginError('userinfo-fetch-failed', `读取用户信息失败：${message(error)}`);
      }
      if (!response.ok) throw new OidcLoginError('userinfo-fetch-failed', `读取用户信息返回 ${response.status}`);
      const raw = await readCapped(response);
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        throw new OidcLoginError('userinfo-shape-invalid', '用户信息不是 JSON');
      }
      if (typeof json !== 'object' || json === null || Array.isArray(json)) throw new OidcLoginError('userinfo-shape-invalid', '用户信息不是 JSON 对象');
      const idpError = inBandError(json as Record<string, unknown>);
      if (idpError !== null) throw new OidcLoginError('userinfo-fetch-failed', `身份提供方返回错误：${idpError}`);
      return json;
    },
  };
}

/**
 * 200 但正文是错误对象（`{ error: ... }` / `{ errorCode: ... }`）必须在这里失败并带上 IdP 的原话，
 * 否则会一路走到取字段那步，最后表现成一个莫名的「缺少主体字段」。
 * 零值不是错误：很多平台把成功包装成 `{ errorCode: 0 }` 或 `{ error: null }`。
 */
function inBandError(body: Record<string, unknown>): string | null {
  let found: string | null = null;
  for (const key of ['error', 'errorCode'] as const) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    const value = body[key];
    if (typeof value === 'string' && value.length > 0) {
      const numeric = Number(value);
      if (key === 'errorCode' && Number.isFinite(numeric) && numeric === 0) continue;
      found = `${key}=${value}`;
    } else if (typeof value === 'number' && value !== 0) {
      found = `${key}=${value}`;
    }
    if (found !== null) break;
  }
  if (found === null) return null;
  for (const key of ['error_description', 'errorMessage', 'message'] as const) {
    const description = body[key];
    if (typeof description === 'string' && description.length > 0) return `${found}: ${description}`;
  }
  return found;
}

async function readCapped(response: Response): Promise<string> {
  const body = response.body;
  if (!body) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    let step: Awaited<ReturnType<typeof reader.read>>;
    try {
      step = await reader.read();
    } catch (error) {
      // 头已经回来、正文中途断掉，会抛在这里而不是上面的传输 catch 里；不包一层就会退化成通用的验签失败。
      throw new OidcLoginError('userinfo-fetch-failed', `用户信息正文读取失败：${message(error)}`);
    }
    if (step.done) break;
    if (step.value) {
      total += step.value.byteLength;
      if (total > USERINFO_MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new OidcLoginError('userinfo-fetch-failed', '用户信息正文超过 256 KiB');
      }
      chunks.push(step.value);
    }
  }
  return Buffer.concat(chunks).toString('utf8');
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
