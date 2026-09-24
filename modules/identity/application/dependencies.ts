import type { LegacyIdentityLookup } from '../ports/legacyIdentity';
import type { Clock } from '@crewstation/kernel';
import type { SessionSettings } from '../domain/session';
import type { AllowlistEvaluator } from '../ports/allowlistEvaluator';
import type { DevSessionState } from '../ports/devSessionState';
import type { HostResolver } from '../ports/hostResolver';
import type { IdentitySettings } from '../ports/identitySettings';
import type { MembershipLookup } from '../ports/membershipLookup';
import type { EndpointResolver, IdpClient } from '../ports/idpClient';
import type { OidcUnitOfWork } from '../ports/oidcUnitOfWork';
import type { PasswordHasher } from '../ports/passwordHasher';
import type { SecretCipher } from '../ports/secretCipher';
import type { PreviewAccess } from '../ports/previewAccess';
import type { AppAccess } from '../ports/appAccess';
import type { ServiceEntry } from '../ports/serviceEntry';
import type { ProjectDirectory } from '../ports/projectDirectory';
import type { TokenService } from '../ports/tokenService';
import type { UserRepository } from '../ports/userRepository';
import type { WorkloadLookup } from '../ports/workloadLookup';

export interface IdentityUseCaseDeps {
  legacyIds?: LegacyIdentityLookup;
  users: UserRepository;
  settings: IdentitySettings;
  session: SessionSettings;
  clock: Clock;
  tokens: TokenService;
  /** OIDC 与登录策略共用的事务边界；引导与「关闭常规登录」必须与判定同事务。 */
  uow: OidcUnitOfWork;
  passwords: PasswordHasher;
  /** 与企业 IdP 的出向交互与端点解析；缺省是真实 HTTP 实现，测试注入假实现。 */
  idp: IdpClient;
  endpoints: EndpointResolver;
  secrets: SecretCipher;
  hosts: HostResolver;
  previewAccess: PreviewAccess;
  appAccess: AppAccess;
  serviceEntry: ServiceEntry;
  projects: ProjectDirectory;
  workloads: WorkloadLookup;
  allowlist: AllowlistEvaluator;
  memberships: MembershipLookup;
  devSessions: DevSessionState;
}
