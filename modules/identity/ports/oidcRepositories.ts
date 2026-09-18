import type { ClaimMapping, OidcProviderId, ProjectId, ProvisioningPolicy, UserId, UserinfoRequestStyle } from '@crewstation/contracts';
import type { LoginPolicy } from '../domain/loginMethods';

/** 一条 Provider 配置；密文单独取，读列表时永远不带它。 */
export interface OidcProviderRecord {
  readonly id: OidcProviderId;
  readonly slug: string;
  readonly displayName: string;
  readonly issuerUrl: string;
  readonly clientId: string;
  readonly scopes: string;
  readonly provisioning: ProvisioningPolicy;
  readonly allowedEmailDomains: readonly string[];
  readonly iconUrl: string | null;
  readonly authorizationEndpoint: string | null;
  readonly tokenEndpoint: string | null;
  readonly userinfoEndpoint: string | null;
  readonly jwksUri: string | null;
  readonly userinfoRequestStyle: UserinfoRequestStyle;
  readonly trustEmailVerified: boolean;
  readonly usernameClaim: string | null;
  readonly gitNameClaim: string | null;
  readonly emailClaim: string | null;
  readonly subjectClaim: string | null;
  readonly claimMappings: readonly ClaimMapping[];
  readonly enabled: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type OidcProviderWrite = Omit<OidcProviderRecord, 'createdAt' | 'updatedAt'> & { readonly clientSecretEnc: string };
export type OidcProviderPatch = Partial<Omit<OidcProviderRecord, 'id' | 'createdAt' | 'updatedAt'>> & { readonly clientSecretEnc?: string };

export interface OidcProviderRepository {
  list(): Promise<OidcProviderRecord[]>;
  listEnabled(): Promise<OidcProviderRecord[]>;
  findById(id: OidcProviderId): Promise<OidcProviderRecord | undefined>;
  findBySlug(slug: string): Promise<OidcProviderRecord | undefined>;
  /** 密文；只有换码路径会调它。 */
  clientSecretEncOf(id: OidcProviderId): Promise<string | undefined>;
  countEnabled(): Promise<number>;
  insert(record: OidcProviderWrite, now: Date): Promise<void>;
  update(id: OidcProviderId, patch: OidcProviderPatch, now: Date): Promise<void>;
  remove(id: OidcProviderId): Promise<void>;
}

export interface UserIdentityRecord {
  readonly providerId: OidcProviderId;
  readonly subject: string;
  readonly userId: UserId;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly profile: Readonly<Record<string, string>>;
  readonly preferredSnapshot: string | null;
}

export interface UserIdentityRepository {
  findByProviderSubject(providerId: OidcProviderId, subject: string): Promise<UserIdentityRecord | undefined>;
  listByUser(userId: UserId): Promise<UserIdentityRecord[]>;
  countByProvider(providerId: OidcProviderId): Promise<number>;
  /** 首次登录建立关联；（provider, subject）唯一冲突时抛，由用例转成 `provider-config-changed`。 */
  link(record: UserIdentityRecord, now: Date): Promise<void>;
  /** 每次成功登录刷新档案与最近登录时间。 */
  refresh(record: UserIdentityRecord, now: Date): Promise<void>;
}

export interface OidcFlowRecord {
  readonly state: string;
  readonly providerId: OidcProviderId;
  readonly redirectUri: string;
  readonly codeVerifier: string;
  readonly nonce: string;
  readonly returnTo: string;
  readonly expiresAt: Date;
}

export interface OidcFlowRepository {
  start(record: OidcFlowRecord, now: Date): Promise<void>;
  /** 一次性消费：未消费且未过期才返回，返回即置为已消费。多副本下靠一条 UPDATE 保证只有一个赢。 */
  consume(state: string, now: Date): Promise<OidcFlowRecord | undefined>;
  /** 清扫过期行；在 start 时顺手做，不新增后台 worker。 */
  sweepExpired(now: Date, limit: number): Promise<number>;
}

export interface LoginPolicyRepository {
  read(): Promise<LoginPolicy>;
  setPasswordLoginEnabled(enabled: boolean, now: Date): Promise<LoginPolicy>;
}

export interface ForwardingRecord {
  readonly fields: readonly string[];
  readonly updatedBy: UserId | null;
  readonly updatedAt: Date | null;
}

export interface IdentityForwardingRepository {
  readGlobal(): Promise<ForwardingRecord>;
  readProject(projectId: ProjectId): Promise<ForwardingRecord | undefined>;
  listProjects(): Promise<Array<ForwardingRecord & { readonly projectId: ProjectId }>>;
  writeGlobal(fields: readonly string[], updatedBy: UserId, now: Date): Promise<void>;
  writeProject(projectId: ProjectId, fields: readonly string[], updatedBy: UserId, now: Date): Promise<void>;
  clearProject(projectId: ProjectId): Promise<void>;
}
