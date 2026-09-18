import type { ClaimMapping, ForwardingCandidate } from '@crewstation/contracts';
import { FIXED_FORWARDING_FIELDS, FORWARDING_FIELD_KEY_REGEX, IDENTITY_HEADERS, TOKEN_CLAIMS } from '@crewstation/contracts';

/** 平台侧保留的身份档案（user_identities.profile 与本地账户的同形投影）。 */
export interface IdentityProfile {
  readonly name: string;
  readonly email: string;
  readonly gitName: string | null;
  readonly attrs: Readonly<Record<string, string>>;
}

export interface ForwardingSets {
  readonly global: readonly string[];
  readonly project: readonly string[] | undefined;
}

/** 候选字段：三个固定字段加所有 Provider 声明的自定义映射 key（同名映射合并，列出声明它的 Provider）。 */
export function forwardingCandidates(providers: readonly { readonly slug: string; readonly claimMappings: readonly ClaimMapping[] }[]): ForwardingCandidate[] {
  const mapped = new Map<string, string[]>();
  for (const provider of providers) {
    for (const mapping of provider.claimMappings) {
      const slugs = mapped.get(mapping.key) ?? [];
      if (!slugs.includes(provider.slug)) slugs.push(provider.slug);
      mapped.set(mapping.key, slugs);
    }
  }
  return [
    ...FIXED_FORWARDING_FIELDS.map((key) => ({ key, kind: 'fixed' as const, providers: [] })),
    ...[...mapped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, providers]) => ({ key, kind: 'mapped' as const, providers })),
  ];
}

/**
 * 生效集：项目有覆盖就用覆盖，否则用全局默认；两侧都只保留仍然存在的候选字段。
 * 映射被删掉后集合里的残留 key 只是忽略，不注入空头——注入空头等于告诉业务「这个人没有工号」。
 */
export function effectiveForwardingFields(sets: ForwardingSets, candidates: readonly ForwardingCandidate[]): { fields: string[]; source: 'global' | 'project' } {
  const known = new Set(candidates.map((c) => c.key));
  const chosen = sets.project ?? sets.global;
  const fields = chosen.filter((key) => known.has(key) && FORWARDING_FIELD_KEY_REGEX.test(key));
  return { fields: [...new Set(fields)].sort(), source: sets.project === undefined ? 'global' : 'project' };
}

/**
 * 按生效集把档案投影成要注入的明文头；用户 ID 与身份令牌恒定注入，不由集合决定。
 * 自定义字段合并进一个 JSON 头，与令牌里的 `cs_attrs` 逐字段一致。
 */
export function forwardedHeaders(fields: readonly string[], profile: IdentityProfile): Record<string, string> {
  const out: Record<string, string> = {};
  if (fields.includes('name')) out[IDENTITY_HEADERS.userName] = profile.name;
  if (fields.includes('email')) out[IDENTITY_HEADERS.userEmail] = profile.email;
  const attrs = forwardedAttrs(fields, profile);
  if (Object.keys(attrs).length > 0) out[IDENTITY_HEADERS.userAttrs] = JSON.stringify(attrs);
  return out;
}

/** 明文头与令牌声明共用这一份取值，两侧因此不可能不一致。 */
export function forwardedAttrs(fields: readonly string[], profile: IdentityProfile): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (fields.includes('git-name') && profile.gitName !== null) attrs['git-name'] = profile.gitName;
  for (const key of fields) {
    if (key === 'name' || key === 'email' || key === 'git-name') continue;
    const value = profile.attrs[key];
    if (value !== undefined) attrs[key] = value;
  }
  return attrs;
}

/** 令牌声明与明文头同步裁剪（A11）：关掉的字段在声明里也不出现，否则业务验签后照样读到。 */
export function forwardedTokenClaims(fields: readonly string[], profile: IdentityProfile): Record<string, unknown> {
  const claims: Record<string, unknown> = {};
  if (fields.includes('name')) claims.name = profile.name;
  if (fields.includes('email')) claims.email = profile.email;
  const attrs = forwardedAttrs(fields, profile);
  if (Object.keys(attrs).length > 0) claims[TOKEN_CLAIMS.attrs] = attrs;
  return claims;
}

/** 生效预览与能力说明读同一份：字段、头名、声明名三者必须由同一个函数算出来。 */
export function forwardingProjection(fields: readonly string[]): { headers: string[]; tokenClaims: string[] } {
  const sample: IdentityProfile = { name: 'x', email: 'x', gitName: 'x', attrs: Object.fromEntries(fields.map((key) => [key, 'x'])) };
  const claims = forwardedTokenClaims(fields, sample);
  const attrs = claims[TOKEN_CLAIMS.attrs];
  return {
    headers: [IDENTITY_HEADERS.userId, IDENTITY_HEADERS.identityToken, ...Object.keys(forwardedHeaders(fields, sample))].sort(),
    tokenClaims: [
      ...Object.keys(claims).filter((key) => key !== TOKEN_CLAIMS.attrs),
      ...(typeof attrs === 'object' && attrs !== null ? Object.keys(attrs).map((key) => `${TOKEN_CLAIMS.attrs}.${key}`) : []),
    ].sort(),
  };
}
