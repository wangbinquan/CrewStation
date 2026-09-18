import type { ClaimMapping, UserinfoRequestStyle } from '@crewstation/contracts';
import type { EffectiveEndpoints } from '../../domain/endpointResolution';
import type { ClaimSelectors, IdpClaims } from '../../domain/idpClaims';
import { OidcLoginError, assertUserinfoSubjectBinding, claimsFromIdToken, extractUserinfoClaims, subjectFromVerifiedIdToken } from '../../domain/idpClaims';
import type { IdpClient, TokenResponse } from '../../ports/idpClient';

export interface AcquireClaimsInput {
  readonly tokens: TokenResponse;
  readonly effective: EffectiveEndpoints;
  readonly clientId: string;
  readonly scopes: string;
  readonly nonce: string;
  readonly userinfoRequestStyle: UserinfoRequestStyle;
  readonly selectors: ClaimSelectors & { readonly claimMappings: readonly ClaimMapping[] };
}

/**
 * 身份取值的唯一决策点（RFC-005 §5 的分支矩阵）。三条不变量：
 *   1. **未验证的 id_token 永远不解析**——回落分支只是忽略它；
 *   2. 走不走验签只看**配置状态**（是否解析出 jwks_uri）。运行期取 JWKS 失败仍是硬失败：
 *      若按运行期状态决定，攻击者只要打挂 JWKS 端点就能把验签降级掉；
 *   3. `subjectClaim` 是**模式开关**：一配就只认 userinfo，即使有可验证的 id_token。
 *      两个主体命名空间并存会让某人的自定义字段值撞上另一个人的 `sub`。
 */
export async function acquireIdentityClaims(client: IdpClient, input: AcquireClaimsInput): Promise<IdpClaims> {
  const { selectors, effective, tokens } = input;
  const subjectMode = selectors.subjectClaim !== null;
  const profileSelectorsConfigured = selectors.usernameClaim !== null || selectors.gitNameClaim !== null || selectors.emailClaim !== null || selectors.claimMappings.length > 0;

  if (!subjectMode && tokens.idToken !== null && effective.jwksUri !== null) {
    const payload = await client.verifyIdToken({
      idToken: tokens.idToken,
      jwksUri: effective.jwksUri,
      issuer: effective.issuer,
      audience: input.clientId,
      nonce: input.nonce,
    });
    if (!profileSelectorsConfigured) return claimsFromIdToken(payload, { usernameClaim: selectors.usernameClaim, claimMappings: selectors.claimMappings });
    // 配了档案选择器时，已验证的令牌只提供权威主体，档案字段以 userinfo 为准；
    // 但 userinfo 必须绑定在这个主体上，否则拿到别人 access_token 的人能顶替档案。
    const verifiedSubject = subjectFromVerifiedIdToken(payload);
    if (effective.userinfoEndpoint === null) throw new OidcLoginError('userinfo-unavailable', '配置了档案字段但没有 userinfo 端点');
    const raw = await fetchUserinfo(client, input);
    assertUserinfoSubjectBinding(raw, verifiedSubject);
    return extractUserinfoClaims(raw, { ...selectors, subjectClaim: null });
  }

  if (effective.userinfoEndpoint !== null) {
    return extractUserinfoClaims(await fetchUserinfo(client, input), selectors);
  }

  if (!subjectMode && tokens.idToken !== null) {
    // 有 id_token，但既没有配置出 JWKS 也没有 userinfo：没有任何东西能确立身份。未验证的令牌不解析。
    throw new OidcLoginError('jwks-unavailable', '既没有可用的 JWKS 也没有 userinfo 端点');
  }
  throw new OidcLoginError('userinfo-unavailable', '没有可用的 userinfo 端点');
}

function fetchUserinfo(client: IdpClient, input: AcquireClaimsInput): Promise<unknown> {
  if (input.effective.userinfoEndpoint === null) throw new OidcLoginError('userinfo-unavailable', '没有可用的 userinfo 端点');
  return client.fetchUserinfo({
    userinfoEndpoint: input.effective.userinfoEndpoint,
    accessToken: input.tokens.accessToken,
    requestStyle: input.userinfoRequestStyle,
    clientId: input.clientId,
    scopes: input.scopes,
  });
}
