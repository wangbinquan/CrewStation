import { expect, test } from 'bun:test';
import { BootstrapAdminRequestSchema, LoginDiscoveryDtoSchema, PasswordLoginRequestSchema } from '../api/auth/session';
import { ClaimMappingSchema, CreateOidcProviderRequestSchema, LoginPolicyDtoSchema, OidcProviderDtoSchema, PatchOidcProviderRequestSchema, UpdateIdentityForwardingRequestSchema } from '../api/auth/oidc';
import { OidcProviderIdSchema } from '../ids';

const create = {
  slug: 'corp-sso', displayName: '公司统一身份', issuerUrl: 'https://idp.corp.com', clientId: 'cs-platform', clientSecret: 'super-secret',
  scopes: 'openid profile email', provisioning: 'allowlist' as const, allowedEmailDomains: ['@corp.com'], iconUrl: null, enabled: true,
};

test('新建 Provider：必填项齐全即可，其余按缺省；密文只进不出', () => {
  const parsed = CreateOidcProviderRequestSchema.parse(create);
  expect(parsed.clientSecret).toBe('super-secret');
  // 响应形状里没有 clientSecret，只有「是否已设置」——密文不能有任何回读路径。
  expect(Object.keys(OidcProviderDtoSchema.shape)).not.toContain('clientSecret');
  expect(Object.keys(OidcProviderDtoSchema.shape)).toContain('clientSecretSet');
  for (const key of ['slug', 'displayName', 'issuerUrl', 'clientId', 'clientSecret', 'scopes', 'provisioning'] as const) {
    const invalid: Record<string, unknown> = { ...create }; Reflect.deleteProperty(invalid, key);
    expect(CreateOidcProviderRequestSchema.safeParse(invalid).success).toBe(false);
  }
  expect(CreateOidcProviderRequestSchema.safeParse({ ...create, unknownField: 1 }).success).toBe(false);
});

test('开通策略只有 auto 与 allowlist：invite 是 agent-workflow 的第三档，本仓按 A3 不做', () => {
  expect(CreateOidcProviderRequestSchema.safeParse({ ...create, provisioning: 'auto' }).success).toBe(true);
  expect(CreateOidcProviderRequestSchema.safeParse({ ...create, provisioning: 'invite' }).success).toBe(false);
});

test('手工端点必须是 http(s) 且可解析：javascript: 会在登录页上被浏览器执行', () => {
  expect(CreateOidcProviderRequestSchema.safeParse({ ...create, authorizationEndpoint: 'https://idp.corp.com/oauth/authorize' }).success).toBe(true);
  for (const bad of ['javascript:alert(1)', 'ftp://idp.corp.com/a', 'not a url', '']) {
    expect(CreateOidcProviderRequestSchema.safeParse({ ...create, authorizationEndpoint: bad }).success).toBe(false);
  }
  expect(CreateOidcProviderRequestSchema.parse({ ...create, authorizationEndpoint: null }).authorizationEndpoint).toBeNull();
});

test('字段选择器：单字段与 1–8 个字段的空格列表；保留对象键名一律拒绝', () => {
  expect(CreateOidcProviderRequestSchema.safeParse({ ...create, subjectClaim: 'id' }).success).toBe(true);
  expect(CreateOidcProviderRequestSchema.safeParse({ ...create, usernameClaim: 'firstName lastName' }).success).toBe(true);
  // 单字段选择器不接受空格：否则会被误当成列表，取到的字段与配置的不是一个。
  expect(CreateOidcProviderRequestSchema.safeParse({ ...create, subjectClaim: 'a b' }).success).toBe(false);
  for (const banned of ['__proto__', 'constructor', 'prototype']) {
    expect(CreateOidcProviderRequestSchema.safeParse({ ...create, subjectClaim: banned }).success).toBe(false);
    expect(CreateOidcProviderRequestSchema.safeParse({ ...create, usernameClaim: `name ${banned}` }).success).toBe(false);
  }
  expect(CreateOidcProviderRequestSchema.safeParse({ ...create, usernameClaim: Array.from({ length: 9 }, (_, i) => `f${i}`).join(' ') }).success).toBe(false);
});

test('自定义映射的 key 同时是头名的一段，因此比字段名更严', () => {
  expect(ClaimMappingSchema.parse({ key: 'employee-no', claim: 'empNo' })).toEqual({ key: 'employee-no', claim: 'empNo' });
  for (const bad of ['Employee', 'employee_no', '-employee', '1employee', 'a'.repeat(32)]) {
    expect(ClaimMappingSchema.safeParse({ key: bad, claim: 'empNo' }).success).toBe(false);
  }
});

test('改 Provider：全部字段可缺省，缺省的 clientSecret 表示保持原值', () => {
  expect(PatchOidcProviderRequestSchema.parse({}).clientSecret).toBeUndefined();
  expect(PatchOidcProviderRequestSchema.parse({ enabled: false }).enabled).toBe(false);
  expect(PatchOidcProviderRequestSchema.safeParse({ clientSecret: '' }).success).toBe(false);
});

test('登录策略回执带调用者的认证方式：关闭常规登录要靠它判定', () => {
  const dto = { passwordLoginEnabled: true, bootstrapCompletedAt: '2026-09-18T01:00:00.000Z', forcedOn: false, enabledProviderCount: 1, callerAuthMethod: 'oidc' as const };
  expect(LoginPolicyDtoSchema.parse(dto)).toEqual(dto);
  expect(LoginPolicyDtoSchema.parse({ ...dto, bootstrapCompletedAt: null }).bootstrapCompletedAt).toBeNull();
  expect(LoginPolicyDtoSchema.safeParse({ ...dto, callerAuthMethod: 'token' }).success).toBe(false);
});

test('引导请求：两次密码必须一致，口令有下限，角色与状态不可指定', () => {
  const body = { token: 'boot-token', username: 'admin', displayName: '平台管理员', email: 'admin@corp.com', password: 'correct-horse-battery', confirmPassword: 'correct-horse-battery' };
  expect(BootstrapAdminRequestSchema.parse(body).username).toBe('admin');
  expect(BootstrapAdminRequestSchema.safeParse({ ...body, confirmPassword: 'other-horse-battery' }).success).toBe(false);
  expect(BootstrapAdminRequestSchema.safeParse({ ...body, password: 'short', confirmPassword: 'short' }).success).toBe(false);
  expect(BootstrapAdminRequestSchema.safeParse({ ...body, username: 'Admin' }).success).toBe(false);
  expect(BootstrapAdminRequestSchema.safeParse({ ...body, isAdmin: true }).success).toBe(false);
  expect(BootstrapAdminRequestSchema.safeParse({ ...body, email: undefined }).success).toBe(false);
});

test('登录发现区分引导态与就绪态；常规登录提交不接受多余字段', () => {
  const discovery = { mode: 'bootstrap' as const, passwordLoginEnabled: false, bootstrapTokenEnabled: true, providers: [], loginPath: '/auth/login', logoutPath: '/auth/logout', jwksPath: '/.well-known/jwks.json' };
  expect(LoginDiscoveryDtoSchema.parse(discovery).providers).toEqual([]);
  expect(LoginDiscoveryDtoSchema.parse({ ...discovery, mode: 'ready', passwordLoginEnabled: true, bootstrapTokenEnabled: false, providers: [{ slug: 'corp-sso', displayName: '公司统一身份' }] }).providers).toHaveLength(1);
  expect(PasswordLoginRequestSchema.safeParse({ username: 'admin', password: 'x', totp: '000000' }).success).toBe(false);
});

test('转发集只收合法字段名，且 Provider ID 有自己的前缀', () => {
  expect(UpdateIdentityForwardingRequestSchema.parse({ fields: ['name', 'email', 'employee-no'] }).fields).toHaveLength(3);
  expect(UpdateIdentityForwardingRequestSchema.safeParse({ fields: ['Name'] }).success).toBe(false);
  expect(OidcProviderIdSchema.safeParse(`idp_${'a'.repeat(32)}`).success).toBe(true);
  expect(OidcProviderIdSchema.safeParse(`prj_${'a'.repeat(32)}`).success).toBe(false);
});
