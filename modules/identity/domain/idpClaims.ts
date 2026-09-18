import type { ClaimMapping } from '@crewstation/contracts';

/** 回调途中每一种可呈现的失败；http 层按它渲染确定的原因页，不落到 JSON 500。 */
export type OidcFailureCode =
  | 'invalid-callback' | 'state-expired' | 'provider-disabled' | 'client-secret-missing' | 'endpoints-unresolved'
  | 'token-exchange-failed' | 'id-token-verify-failed' | 'userinfo-fetch-failed' | 'userinfo-shape-invalid'
  | 'userinfo-unavailable' | 'jwks-unavailable' | 'userinfo-subject-mismatch'
  | 'email-claim-invalid' | 'display-name-claim-invalid' | 'git-name-claim-invalid'
  | 'email-not-verified' | 'email-domain-not-allowed' | 'bootstrap-admin-required' | 'provider-config-changed';

export class OidcLoginError extends Error {
  constructor(readonly code: OidcFailureCode, message: string) {
    super(message);
    this.name = 'OidcLoginError';
  }
}

export function isOidcLoginError(error: unknown): error is OidcLoginError {
  return error instanceof OidcLoginError;
}

/** 一次登录解析出的身份。attrs 是自定义映射字段的值，平台侧全量保存（A8）。 */
export interface IdpClaims {
  readonly subject: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly name: string | null;
  readonly preferredUsername: string | null;
  readonly gitName: string | null;
  readonly attrs: Readonly<Record<string, string>>;
}

export interface ClaimSelectors {
  readonly subjectClaim: string | null;
  readonly usernameClaim: string | null;
  readonly gitNameClaim: string | null;
  readonly emailClaim: string | null;
  readonly claimMappings: readonly ClaimMapping[];
}

const BANNED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * 单字段读取：只认自有属性、非空字符串或安全整数。
 * 不认大数：JSON.parse 已经把它round 过了，在身份键上做有损归一会把两个相邻的 IdP 用户折成同一个本地主体。
 */
export function readClaimField(source: Readonly<Record<string, unknown>>, key: string): string | null {
  if (BANNED_KEYS.has(key)) return null;
  if (!Object.prototype.hasOwnProperty.call(source, key)) return null;
  const value = source[key];
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  return null;
}

/** 空格分隔的字段名列表按序拼接，缺的跳过（签名式字段来来去去），全缺为 null。 */
export function composeClaimList(source: Readonly<Record<string, unknown>>, claimList: string): string | null {
  const parts = claimList.split(' ').map((key) => readClaimField(source, key)).filter((v): v is string => v !== null);
  return parts.length > 0 ? parts.join(' ') : null;
}

function requireComposed(source: Readonly<Record<string, unknown>>, claimList: string, code: OidcFailureCode): string {
  const composed = composeClaimList(source, claimList)?.trim() ?? '';
  if (composed.length === 0 || composed.length > 128) throw new OidcLoginError(code, `配置的字段 ${claimList} 在 userinfo 里取不到可用值`);
  return composed;
}

function normalizeEmail(value: string | null, strict: boolean): string | null {
  if (value === null) {
    if (strict) throw new OidcLoginError('email-claim-invalid', '配置的邮箱字段在 userinfo 里不存在');
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0 || normalized.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(normalized)) {
    throw new OidcLoginError('email-claim-invalid', '邮箱字段的值不是邮箱');
  }
  return normalized;
}

function readEmail(source: Readonly<Record<string, unknown>>, emailClaim: string | null): string | null {
  const raw = emailClaim === null ? (typeof source.email === 'string' ? source.email : null) : readClaimField(source, emailClaim);
  return normalizeEmail(raw, emailClaim !== null);
}

/**
 * 配了显示名选择器就以它为准，取不到直接失败；没配才回落标准 `preferred_username`。
 * 不在配了选择器时偷偷回落标准字段——那会把「字段名填错」掩盖成「这个 IdP 没给名字」。
 */
function readPreferred(source: Readonly<Record<string, unknown>>, usernameClaim: string | null): string | null {
  if (usernameClaim !== null) return requireComposed(source, usernameClaim, 'display-name-claim-invalid');
  const value = source['preferred_username'];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readAttrs(source: Readonly<Record<string, unknown>>, mappings: readonly ClaimMapping[]): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const mapping of mappings) {
    const value = readClaimField(source, mapping.claim);
    if (value !== null) attrs[mapping.key] = value.slice(0, 256);
  }
  return attrs;
}

function asObject(json: unknown): Readonly<Record<string, unknown>> {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new OidcLoginError('userinfo-shape-invalid', 'userinfo 不是一个 JSON 对象');
  }
  return json as Record<string, unknown>;
}

/** userinfo → 身份。`subjectClaim` 配了就以它为身份键，没配只认标准 `sub`，不做隐式回落（回落等于混命名空间）。 */
export function extractUserinfoClaims(json: unknown, selectors: ClaimSelectors): IdpClaims {
  const source = asObject(json);
  const subject = selectors.subjectClaim !== null
    ? readClaimField(source, selectors.subjectClaim)
    : (typeof source['sub'] === 'string' && source['sub'].length > 0 ? source['sub'] : null);
  if (subject === null) throw new OidcLoginError('userinfo-shape-invalid', 'userinfo 里没有可用的主体字段');
  return {
    subject,
    email: readEmail(source, selectors.emailClaim),
    emailVerified: source['email_verified'] === true,
    name: typeof source['name'] === 'string' ? source['name'] : null,
    preferredUsername: readPreferred(source, selectors.usernameClaim),
    gitName: selectors.gitNameClaim === null ? null : requireComposed(source, selectors.gitNameClaim, 'git-name-claim-invalid'),
    attrs: readAttrs(source, selectors.claimMappings),
  };
}

/** 已验证的 `id_token` → 身份。空 sub 直接拒绝，不把缺失的主体拼成空串建出一条无主体的身份。 */
export function claimsFromIdToken(payload: Readonly<Record<string, unknown>>, selectors: Pick<ClaimSelectors, 'usernameClaim' | 'claimMappings'>): IdpClaims {
  return {
    subject: subjectFromVerifiedIdToken(payload),
    email: normalizeEmail(typeof payload['email'] === 'string' ? payload['email'] : null, false),
    emailVerified: payload['email_verified'] === true,
    name: typeof payload['name'] === 'string' ? payload['name'] : null,
    preferredUsername: readPreferred(payload, selectors.usernameClaim),
    gitName: null,
    attrs: readAttrs(payload, selectors.claimMappings),
  };
}

export function subjectFromVerifiedIdToken(payload: Readonly<Record<string, unknown>>): string {
  const sub = payload['sub'];
  if (typeof sub !== 'string' || sub.length === 0) throw new OidcLoginError('id-token-verify-failed', 'id_token 里没有 sub');
  return sub;
}

/**
 * 配了档案字段选择器时，userinfo 的档案必须绑定在**已验证**的 id_token 主体上：
 * 否则一个能拿到别人 access_token 的调用方可以用自己的 userinfo 顶替对方档案。
 */
export function assertUserinfoSubjectBinding(json: unknown, verifiedSubject: string): void {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return;
  const sub = (json as Record<string, unknown>)['sub'];
  if (typeof sub !== 'string' || sub.length === 0 || sub !== verifiedSubject) {
    throw new OidcLoginError('userinfo-subject-mismatch', 'userinfo 的 sub 与已验证的 id_token 不一致');
  }
}

/** 管理员声明该 IdP 的邮箱可信时，有邮箱即视为已验证（纯 OAuth 2.0 极少给 email_verified）。 */
export function applyEmailTrust(claims: IdpClaims, trustEmailVerified: boolean): IdpClaims {
  return trustEmailVerified && claims.email !== null ? { ...claims, emailVerified: true } : claims;
}

/** 落库的两个名字：显示名与 Git 名。配了选择器就必须取到，没配才走标准字段的回落链。 */
export function resolveProfileNames(selectors: Pick<ClaimSelectors, 'usernameClaim' | 'gitNameClaim'>, claims: IdpClaims): { displayName: string; gitName: string } {
  const displayName = selectors.usernameClaim !== null
    ? required(claims.preferredUsername, 'display-name-claim-invalid')
    : firstUsable([claims.preferredUsername, claims.name, claims.email]) ?? 'OIDC 用户';
  const gitName = selectors.gitNameClaim !== null ? required(claims.gitName, 'git-name-claim-invalid') : displayName;
  return { displayName, gitName };
}

function firstUsable(values: ReadonlyArray<string | null>): string | null {
  for (const value of values) {
    const normalized = value?.trim() ?? '';
    if (normalized.length > 0 && normalized.length <= 128) return normalized;
  }
  return null;
}

function required(value: string | null, code: OidcFailureCode): string {
  const normalized = value?.trim() ?? '';
  if (normalized.length === 0 || normalized.length > 128) throw new OidcLoginError(code, '配置的字段没有取到可用的名字');
  return normalized;
}
