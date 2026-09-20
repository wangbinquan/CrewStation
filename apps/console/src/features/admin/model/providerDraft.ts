import type { CreateOidcProviderRequest, OidcProviderDto } from '@crewstation/contracts';

export const providerGroups = ['basics', 'connection', 'account', 'mapping'] as const;
export type ProviderGroup = typeof providerGroups[number];
export function providerDraft(initial?: OidcProviderDto) {
  return {
    slug: initial?.slug ?? '', displayName: initial?.displayName ?? '', issuerUrl: initial?.issuerUrl ?? '',
    clientId: initial?.clientId ?? '', clientSecret: '', scopes: initial?.scopes ?? 'openid profile email', enabled: initial?.enabled ?? true,
    provisioning: initial?.provisioning ?? 'allowlist', allowedDomains: (initial?.allowedEmailDomains ?? []).join(', '),
    authorizationEndpoint: initial?.authorizationEndpoint ?? '', tokenEndpoint: initial?.tokenEndpoint ?? '',
    userinfoEndpoint: initial?.userinfoEndpoint ?? '', jwksUri: initial?.jwksUri ?? '',
    userinfoRequestStyle: initial?.userinfoRequestStyle ?? 'get_bearer', trustEmailVerified: initial?.trustEmailVerified ?? false,
    usernameClaim: initial?.usernameClaim ?? '', gitNameClaim: initial?.gitNameClaim ?? '', emailClaim: initial?.emailClaim ?? '', subjectClaim: initial?.subjectClaim ?? '',
    claimMappings: (initial?.claimMappings ?? []).map((mapping) => ({ ...mapping })), iconUrl: initial?.iconUrl ?? null,
  };
}
export type ProviderDraft = ReturnType<typeof providerDraft>;
const optional = (value: string) => value.trim() || null;

/** 新建校验要求密钥；编辑的空密钥不出现在 PATCH 里，所有隐藏组仍参与校验。 */
export function providerRequest(value: ProviderDraft): CreateOidcProviderRequest {
  const { allowedDomains, clientSecret, ...fields } = value;
  return {
    ...fields, ...(clientSecret ? { clientSecret } : {}),
    allowedEmailDomains: allowedDomains.split(',').map((domain) => domain.trim()).filter(Boolean),
    authorizationEndpoint: optional(value.authorizationEndpoint), tokenEndpoint: optional(value.tokenEndpoint),
    userinfoEndpoint: optional(value.userinfoEndpoint), jwksUri: optional(value.jwksUri),
    usernameClaim: optional(value.usernameClaim), gitNameClaim: optional(value.gitNameClaim),
    emailClaim: optional(value.emailClaim), subjectClaim: optional(value.subjectClaim),
  } as CreateOidcProviderRequest;
}

export function providerFieldGroup(key: string): ProviderGroup {
  if (['authorizationEndpoint', 'tokenEndpoint', 'userinfoEndpoint', 'jwksUri', 'userinfoRequestStyle'].includes(key)) return 'connection';
  if (['provisioning', 'allowedDomains', 'trustEmailVerified'].includes(key)) return 'account';
  if (['usernameClaim', 'gitNameClaim', 'emailClaim', 'subjectClaim'].includes(key) || key.startsWith('claimMappings')) return 'mapping';
  return 'basics';
}
