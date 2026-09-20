import { CreateOidcProviderRequestSchema } from '@crewstation/contracts';

const editable = CreateOidcProviderRequestSchema.partial({ clientSecret: true });
const fields: Readonly<Record<string, string>> = { allowedEmailDomains: 'allowedDomains' };
const messages: Readonly<Record<string, string>> = {
  slug: 'slug', displayName: 'displayName', clientId: 'clientId', clientSecret: 'clientSecret', scopes: 'scopes',
  issuerUrl: 'url', authorizationEndpoint: 'url', tokenEndpoint: 'url', userinfoEndpoint: 'url', jwksUri: 'url',
  allowedEmailDomains: 'domains', usernameClaim: 'claimList', gitNameClaim: 'claimList',
  emailClaim: 'claim', subjectClaim: 'claim', claimMappings: 'mappings',
};

/** 与 API 使用同一套约束，把每个错误落回用户填写的字段。编辑时空密钥保持原值。 */
export function providerErrors(body: unknown, editing: boolean): Record<string, string> {
  const result = (editing ? editable : CreateOidcProviderRequestSchema).safeParse(body);
  if (result.success) return {};
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const field = String(issue.path[0]);
    errors[fields[field] ?? field] = `admin.auth.invalid.${messages[field] ?? 'field'}`;
  }
  return errors;
}
