import type { OidcProviderId, ProjectId, ProvisioningPolicy, UserId, UserinfoRequestStyle } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { and, count, eq, gt, isNull, sql } from 'drizzle-orm';
import type { LoginPolicy } from '../../domain/loginMethods';
import type {
  ForwardingRecord, IdentityForwardingRepository, LoginPolicyRepository, OidcFlowRecord, OidcFlowRepository,
  OidcProviderRecord, OidcProviderRepository, UserIdentityRecord, UserIdentityRepository,
} from '../../ports/oidcRepositories';
import { authLoginPolicy, identityForwarding, oidcFlows, oidcProviders, userIdentities } from './tables';

const POLICY_ID = 'global';

export function drizzleOidcProviderRepository(db: Executor): OidcProviderRepository {
  const all = async (rows: Array<typeof oidcProviders.$inferSelect>): Promise<OidcProviderRecord[]> => rows.map(toProvider);
  return {
    list: () => db.select().from(oidcProviders).orderBy(oidcProviders.slug).then(all),
    listEnabled: () => db.select().from(oidcProviders).where(eq(oidcProviders.enabled, true)).orderBy(oidcProviders.slug).then(all),
    findById: (id) => db.select().from(oidcProviders).where(eq(oidcProviders.id, id)).then((rows) => (rows[0] ? toProvider(rows[0]) : undefined)),
    findBySlug: (slug) => db.select().from(oidcProviders).where(eq(oidcProviders.slug, slug)).then((rows) => (rows[0] ? toProvider(rows[0]) : undefined)),
    clientSecretEncOf: (id) => db.select({ enc: oidcProviders.clientSecretEnc }).from(oidcProviders).where(eq(oidcProviders.id, id)).then((rows) => rows[0]?.enc),
    countEnabled: async () => Number((await db.select({ n: count() }).from(oidcProviders).where(eq(oidcProviders.enabled, true)))[0]?.n ?? 0),
    insert: async (record, now) => {
      await db.insert(oidcProviders).values({
        id: record.id, slug: record.slug, displayName: record.displayName, issuerUrl: record.issuerUrl, clientId: record.clientId,
        clientSecretEnc: record.clientSecretEnc, scopes: record.scopes, provisioning: record.provisioning,
        allowedEmailDomains: [...record.allowedEmailDomains], iconUrl: record.iconUrl,
        authorizationEndpoint: record.authorizationEndpoint, tokenEndpoint: record.tokenEndpoint, userinfoEndpoint: record.userinfoEndpoint,
        jwksUri: record.jwksUri, userinfoRequestStyle: record.userinfoRequestStyle, trustEmailVerified: record.trustEmailVerified,
        usernameClaim: record.usernameClaim, gitNameClaim: record.gitNameClaim, emailClaim: record.emailClaim, subjectClaim: record.subjectClaim,
        claimMappings: [...record.claimMappings], enabled: record.enabled, createdAt: now, updatedAt: now,
      });
    },
    update: async (id, patch, now) => {
      await db.update(oidcProviders).set({ ...toProviderRow(patch), ...(patch.clientSecretEnc ? { clientSecretEnc: patch.clientSecretEnc } : {}), updatedAt: now }).where(eq(oidcProviders.id, id));
    },
    remove: async (id) => { await db.delete(oidcProviders).where(eq(oidcProviders.id, id)); },
  };
}

export function drizzleUserIdentityRepository(db: Executor): UserIdentityRepository {
  return {
    findByProviderSubject: (providerId, subject) => db.select().from(userIdentities)
      .where(and(eq(userIdentities.providerId, providerId), eq(userIdentities.subject, subject)))
      .then((rows) => (rows[0] ? toIdentity(rows[0]) : undefined)),
    listByUser: async (userId) => (await db.select().from(userIdentities).where(eq(userIdentities.userId, userId))).map(toIdentity),
    countByProvider: async (providerId) => Number((await db.select({ n: count() }).from(userIdentities).where(eq(userIdentities.providerId, providerId)))[0]?.n ?? 0),
    link: async (record, now) => {
      await db.insert(userIdentities).values({ id: Bun.randomUUIDv7(), ...toIdentityRow(record), linkedAt: now, lastLoginAt: now });
    },
    refresh: async (record, now) => {
      await db.update(userIdentities)
        .set({ email: record.email, emailVerified: record.emailVerified, profile: record.profile, preferredSnapshot: record.preferredSnapshot, lastLoginAt: now })
        .where(and(eq(userIdentities.providerId, record.providerId), eq(userIdentities.subject, record.subject)));
    },
  };
}

export function drizzleOidcFlowRepository(db: Executor): OidcFlowRepository {
  return {
    start: async (record, now) => {
      await db.insert(oidcFlows).values({
        state: record.state, providerId: record.providerId, redirectUri: record.redirectUri, codeVerifier: record.codeVerifier,
        nonce: record.nonce, returnTo: record.returnTo, createdAt: now, expiresAt: record.expiresAt,
      });
    },
    // 一次性消费只靠这一条语句：未消费且未过期的行才会被置为已消费并返回，多副本同时回放同一个 state 只有一个赢。
    consume: async (state, now) => {
      const rows = await db.update(oidcFlows).set({ consumedAt: now })
        .where(and(eq(oidcFlows.state, state), isNull(oidcFlows.consumedAt), gt(oidcFlows.expiresAt, now)))
        .returning();
      return rows[0] ? toFlow(rows[0]) : undefined;
    },
    sweepExpired: async (now, limit) => {
      const rows = await db.delete(oidcFlows)
        .where(sql`${oidcFlows.state} IN (SELECT state FROM identity.oidc_flows WHERE expires_at < ${now} LIMIT ${limit})`)
        .returning({ state: oidcFlows.state });
      return rows.length;
    },
  };
}

export function drizzleLoginPolicyRepository(db: Executor): LoginPolicyRepository {
  const read = async (): Promise<LoginPolicy> => {
    const row = (await db.select().from(authLoginPolicy).where(eq(authLoginPolicy.id, POLICY_ID)))[0];
    // 行缺失只可能出现在迁移没跑全的库上；按「引导未完成」处理，宁可什么都登不进去也不放行。
    return { passwordLoginEnabled: row?.passwordLoginEnabled ?? true, bootstrapCompletedAt: row?.bootstrapCompletedAt ?? null };
  };
  return {
    read,
    setPasswordLoginEnabled: async (enabled, now) => {
      await db.update(authLoginPolicy).set({ passwordLoginEnabled: enabled, updatedAt: now }).where(eq(authLoginPolicy.id, POLICY_ID));
      return read();
    },
    completeBootstrap: async (now) => {
      const rows = await db.update(authLoginPolicy)
        .set({ bootstrapCompletedAt: now, passwordLoginEnabled: true, updatedAt: now })
        .where(and(eq(authLoginPolicy.id, POLICY_ID), isNull(authLoginPolicy.bootstrapCompletedAt)))
        .returning({ id: authLoginPolicy.id });
      return rows.length === 1;
    },
  };
}

export function drizzleIdentityForwardingRepository(db: Executor): IdentityForwardingRepository {
  const toRecord = (row: typeof identityForwarding.$inferSelect): ForwardingRecord => ({
    fields: (row.fields as string[] | null) ?? [],
    updatedBy: (row.updatedBy as UserId | null) ?? null,
    updatedAt: row.updatedAt,
  });
  const write = async (id: string, scope: 'global' | 'project', projectId: ProjectId | null, fields: readonly string[], updatedBy: UserId, now: Date): Promise<void> => {
    await db.insert(identityForwarding).values({ id, scope, projectId, fields: [...fields], updatedBy, updatedAt: now })
      .onConflictDoUpdate({ target: identityForwarding.id, set: { fields: [...fields], updatedBy, updatedAt: now } });
  };
  return {
    readGlobal: async () => {
      const row = (await db.select().from(identityForwarding).where(eq(identityForwarding.scope, 'global')))[0];
      return row ? toRecord(row) : { fields: [], updatedBy: null, updatedAt: null };
    },
    readProject: async (projectId) => {
      const row = (await db.select().from(identityForwarding).where(and(eq(identityForwarding.scope, 'project'), eq(identityForwarding.projectId, projectId))))[0];
      return row ? toRecord(row) : undefined;
    },
    listProjects: async () => (await db.select().from(identityForwarding).where(eq(identityForwarding.scope, 'project')).orderBy(identityForwarding.projectId))
      .map((row) => ({ ...toRecord(row), projectId: row.projectId as ProjectId })),
    writeGlobal: (fields, updatedBy, now) => write(POLICY_ID, 'global', null, fields, updatedBy, now),
    writeProject: (projectId, fields, updatedBy, now) => write(`prj:${projectId}`, 'project', projectId, fields, updatedBy, now),
    clearProject: async (projectId) => { await db.delete(identityForwarding).where(and(eq(identityForwarding.scope, 'project'), eq(identityForwarding.projectId, projectId))); },
  };
}

function toProvider(row: typeof oidcProviders.$inferSelect): OidcProviderRecord {
  return {
    id: row.id as OidcProviderId,
    slug: row.slug,
    displayName: row.displayName,
    issuerUrl: row.issuerUrl,
    clientId: row.clientId,
    scopes: row.scopes,
    provisioning: row.provisioning as ProvisioningPolicy,
    allowedEmailDomains: (row.allowedEmailDomains as string[] | null) ?? [],
    iconUrl: row.iconUrl,
    authorizationEndpoint: row.authorizationEndpoint,
    tokenEndpoint: row.tokenEndpoint,
    userinfoEndpoint: row.userinfoEndpoint,
    jwksUri: row.jwksUri,
    userinfoRequestStyle: row.userinfoRequestStyle as UserinfoRequestStyle,
    trustEmailVerified: row.trustEmailVerified,
    usernameClaim: row.usernameClaim,
    gitNameClaim: row.gitNameClaim,
    emailClaim: row.emailClaim,
    subjectClaim: row.subjectClaim,
    claimMappings: (row.claimMappings as OidcProviderRecord['claimMappings'] | null) ?? [],
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** 只映射给出的字段，缺省项保持库内原值（PATCH 语义）。 */
function toProviderRow(patch: Partial<OidcProviderRecord>): Partial<typeof oidcProviders.$inferInsert> {
  const entries: Array<[string, unknown]> = [];
  const put = (key: string, value: unknown): void => { if (value !== undefined) entries.push([key, value]); };
  put('slug', patch.slug); put('displayName', patch.displayName); put('issuerUrl', patch.issuerUrl); put('clientId', patch.clientId);
  put('scopes', patch.scopes); put('provisioning', patch.provisioning); put('iconUrl', patch.iconUrl);
  put('allowedEmailDomains', patch.allowedEmailDomains === undefined ? undefined : [...patch.allowedEmailDomains]);
  put('authorizationEndpoint', patch.authorizationEndpoint); put('tokenEndpoint', patch.tokenEndpoint);
  put('userinfoEndpoint', patch.userinfoEndpoint); put('jwksUri', patch.jwksUri); put('userinfoRequestStyle', patch.userinfoRequestStyle);
  put('trustEmailVerified', patch.trustEmailVerified); put('usernameClaim', patch.usernameClaim); put('gitNameClaim', patch.gitNameClaim);
  put('emailClaim', patch.emailClaim); put('subjectClaim', patch.subjectClaim);
  put('claimMappings', patch.claimMappings === undefined ? undefined : [...patch.claimMappings]);
  put('enabled', patch.enabled);
  return Object.fromEntries(entries) as Partial<typeof oidcProviders.$inferInsert>;
}

function toIdentity(row: typeof userIdentities.$inferSelect): UserIdentityRecord {
  return {
    providerId: row.providerId as OidcProviderId,
    subject: row.subject,
    userId: row.userId as UserId,
    email: row.email,
    emailVerified: row.emailVerified,
    profile: ((row.profile as Record<string, string> | null) ?? {}),
    preferredSnapshot: row.preferredSnapshot,
  };
}

function toIdentityRow(record: UserIdentityRecord): Omit<typeof userIdentities.$inferInsert, 'id' | 'linkedAt' | 'lastLoginAt'> {
  return {
    userId: record.userId, providerId: record.providerId, subject: record.subject, email: record.email,
    emailVerified: record.emailVerified, profile: record.profile, preferredSnapshot: record.preferredSnapshot,
  };
}

function toFlow(row: typeof oidcFlows.$inferSelect): OidcFlowRecord {
  return {
    state: row.state, providerId: row.providerId as OidcProviderId, redirectUri: row.redirectUri,
    codeVerifier: row.codeVerifier, nonce: row.nonce, returnTo: row.returnTo, expiresAt: row.expiresAt,
  };
}
