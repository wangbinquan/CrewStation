import type { OidcEndpointSource } from '@crewstation/contracts';

/** discovery 文档：任何字段都可能缺失或是脏值，判定完整性是本文件的事，不是取文档那一侧的事。 */
export type DiscoveryDocument = Readonly<Record<string, unknown>>;

type EndpointKey = 'authorizationEndpoint' | 'tokenEndpoint' | 'userinfoEndpoint' | 'jwksUri';

/** 参与端点解析与可登录判定的 Provider 字段。 */
export interface EndpointConfig {
  readonly issuerUrl: string;
  readonly authorizationEndpoint: string | null;
  readonly tokenEndpoint: string | null;
  readonly userinfoEndpoint: string | null;
  readonly jwksUri: string | null;
  readonly subjectClaim: string | null;
  readonly usernameClaim: string | null;
  readonly emailClaim: string | null;
  readonly gitNameClaim: string | null;
}

export interface EffectiveEndpoints {
  readonly authorizationEndpoint: string | null;
  readonly tokenEndpoint: string | null;
  readonly userinfoEndpoint: string | null;
  readonly jwksUri: string | null;
  /**
   * 验 `id_token` 时期望的 iss：discovery 文档给出的 issuer，否则用配置的 issuerUrl **原样**。
   * 不去尾斜杠——OIDC 的 issuer 比较是精确相等，去了会把配置成 `https://x/` 的提供方的每个令牌都判为不符。
   */
  readonly issuer: string;
  readonly sources: Readonly<Record<EndpointKey, OidcEndpointSource | 'none'>>;
  readonly scopesSupported: readonly string[];
  readonly discoveryOk: boolean;
  readonly discoveryError?: string;
}

/**
 * discovery 提供的端点字段只有「非空 http(s) 且可解析」才算提供了。
 * 其余（空串、数字、别的 scheme、垃圾串）一律当缺失，否则一份坏文档会盖掉管理员填对的手工值，
 * 而且脏值会一路走到登录路径上的 `new URL`。
 */
export function sanitizeEndpointUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (!/^https?:\/\//i.test(value)) return null;
  return URL.canParse(value) ? value : null;
}

/**
 * 逐字段合并：discovery 覆盖手工值，缺一项就用手工值补一项（RFC-005 §5）。
 * 合并是纯函数，取文档与缓存都在 adapters 那一侧。
 */
export function mergeEndpoints(
  doc: DiscoveryDocument | null,
  provider: EndpointConfig,
  discovery: { readonly ok: boolean; readonly error?: string },
): EffectiveEndpoints {
  const pick = (docValue: unknown, manual: string | null): { url: string | null; source: OidcEndpointSource | 'none' } => {
    const fromDoc = sanitizeEndpointUrl(docValue);
    if (fromDoc !== null) return { url: fromDoc, source: 'discovery' };
    if (manual !== null) return { url: manual, source: 'manual' };
    return { url: null, source: 'none' };
  };
  const authorization = pick(doc?.authorization_endpoint, provider.authorizationEndpoint);
  const token = pick(doc?.token_endpoint, provider.tokenEndpoint);
  const userinfo = pick(doc?.userinfo_endpoint, provider.userinfoEndpoint);
  const jwks = pick(doc?.jwks_uri, provider.jwksUri);
  const issuerFromDoc = typeof doc?.issuer === 'string' && doc.issuer !== '' ? doc.issuer : undefined;
  return {
    authorizationEndpoint: authorization.url,
    tokenEndpoint: token.url,
    userinfoEndpoint: userinfo.url,
    jwksUri: jwks.url,
    issuer: issuerFromDoc ?? provider.issuerUrl,
    sources: { authorizationEndpoint: authorization.source, tokenEndpoint: token.source, userinfoEndpoint: userinfo.source, jwksUri: jwks.source },
    scopesSupported: Array.isArray(doc?.scopes_supported) ? doc.scopes_supported.filter((s): s is string => typeof s === 'string') : [],
    discoveryOk: discovery.ok,
    ...(discovery.error === undefined ? {} : { discoveryError: discovery.error }),
  };
}

/**
 * 合并结果能不能跑完一整次登录：跳转、换码、取身份三段都要有着落。
 * 「半可用」的组合（能跳转但回调永远取不到身份）不允许从缓存返回，否则一次瞬时故障会被放大成一小时的不可登录。
 * 配了主体或档案字段选择器时，身份只能来自 userinfo，JWKS 不算身份通道。
 */
export function loginViable(
  effective: Pick<EffectiveEndpoints, 'authorizationEndpoint' | 'tokenEndpoint' | 'userinfoEndpoint' | 'jwksUri'>,
  provider: Pick<EndpointConfig, 'subjectClaim' | 'usernameClaim' | 'emailClaim' | 'gitNameClaim'>,
): boolean {
  if (!effective.authorizationEndpoint || !effective.tokenEndpoint) return false;
  if (provider.subjectClaim || provider.usernameClaim || provider.emailClaim || provider.gitNameClaim) {
    return effective.userinfoEndpoint !== null;
  }
  return effective.userinfoEndpoint !== null || effective.jwksUri !== null;
}
