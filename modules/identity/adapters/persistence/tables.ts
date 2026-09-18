import { boolean, index, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { jsonDocument } from '@crewstation/persistence';
import { identitySchema } from './schema';

export const users = identitySchema.table('users', {
  id: text('id').primaryKey(),
  externalId: text('external_id').notNull().unique(),
  /** 本地密码账户的登录名；OIDC 建档的行由 subject 派生，见 domain/user.ts。 */
  username: text('username'),
  name: text('name').notNull(),
  email: text('email').notNull(),
  /** Git 提交名；缺省跟随显示名（RFC-005 §7 资料刷新）。 */
  gitName: text('git_name'),
  /** argon2id（Bun.password）；为空即没有本地口令。 */
  passwordHash: text('password_hash'),
  isAdmin: boolean('is_admin').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }).notNull(),
});

/** 签名密钥环：整库一行，material 是 @crewstation/jwt 的序列化形态（含私钥，只在此表出现）。 */
export const signingKeys = identitySchema.table('signing_keys', {
  name: text('name').primaryKey(),
  material: text('material').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** OIDC 身份提供方（RFC-005 §6.3）；client_secret 只以密文出现，接口不回读。 */
export const oidcProviders = identitySchema.table('oidc_providers', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  displayName: text('display_name').notNull(),
  issuerUrl: text('issuer_url').notNull(),
  clientId: text('client_id').notNull(),
  clientSecretEnc: text('client_secret_enc').notNull(),
  scopes: text('scopes').notNull().default('openid profile email'),
  provisioning: text('provisioning').notNull().default('allowlist'),
  allowedEmailDomains: jsonDocument('allowed_email_domains').notNull().default([]),
  iconUrl: text('icon_url'),
  authorizationEndpoint: text('authorization_endpoint'),
  tokenEndpoint: text('token_endpoint'),
  userinfoEndpoint: text('userinfo_endpoint'),
  jwksUri: text('jwks_uri'),
  userinfoRequestStyle: text('userinfo_request_style').notNull().default('get_bearer'),
  trustEmailVerified: boolean('trust_email_verified').notNull().default(false),
  usernameClaim: text('username_claim'),
  gitNameClaim: text('git_name_claim'),
  emailClaim: text('email_claim'),
  subjectClaim: text('subject_claim'),
  claimMappings: jsonDocument('claim_mappings').notNull().default([]),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (t) => [index('oidc_providers_enabled_idx').on(t.enabled)]);

/** 一人多条外部身份；（provider, subject）唯一即 A12 的「账户不合并」。profile 是平台侧保留的档案。 */
export const userIdentities = identitySchema.table('user_identities', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  providerId: text('provider_id').notNull(),
  subject: text('subject').notNull(),
  email: text('email'),
  emailVerified: boolean('email_verified').notNull().default(false),
  profile: jsonDocument('profile').notNull().default({}),
  preferredSnapshot: text('preferred_snapshot'),
  linkedAt: timestamp('linked_at', { withTimezone: true }).notNull(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }).notNull(),
}, (t) => [uniqueIndex('user_identities_provider_subject_uq').on(t.providerId, t.subject), index('user_identities_user_idx').on(t.userId)]);

/** 登录策略单行（id 固定 'global'）。 */
export const authLoginPolicy = identitySchema.table('auth_login_policy', {
  id: text('id').primaryKey(),
  passwordLoginEnabled: boolean('password_login_enabled').notNull().default(true),
  bootstrapCompletedAt: timestamp('bootstrap_completed_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** 一次 OIDC 登录的待处理流程：一次性消费，过期即废。 */
export const oidcFlows = identitySchema.table('oidc_flows', {
  state: text('state').primaryKey(),
  providerId: text('provider_id').notNull(),
  redirectUri: text('redirect_uri').notNull(),
  codeVerifier: text('code_verifier').notNull(),
  nonce: text('nonce').notNull(),
  returnTo: text('return_to').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
}, (t) => [index('oidc_flows_expires_idx').on(t.expiresAt)]);

/** 身份转发集：scope='global' 一行，每个项目至多一行覆盖。 */
export const identityForwarding = identitySchema.table('identity_forwarding', {
  id: text('id').primaryKey(),
  scope: text('scope').notNull(),
  projectId: text('project_id'),
  fields: jsonDocument('fields').notNull().default([]),
  updatedBy: text('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
