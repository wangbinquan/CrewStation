import type { Clock } from '@crewstation/kernel';
import type { SessionSettings } from '../domain/session';
import type { AllowlistEvaluator } from '../ports/allowlistEvaluator';
import type { DevSessionState } from '../ports/devSessionState';
import type { HostResolver } from '../ports/hostResolver';
import type { IdentityProvider } from '../ports/identityProvider';
import type { IdentitySettings } from '../ports/identitySettings';
import type { MembershipLookup } from '../ports/membershipLookup';
import type { PreviewAccess } from '../ports/previewAccess';
import type { TokenService } from '../ports/tokenService';
import type { UserRepository } from '../ports/userRepository';
import type { WorkloadLookup } from '../ports/workloadLookup';

export interface IdentityUseCaseDeps {
  users: UserRepository;
  settings: IdentitySettings;
  session: SessionSettings;
  clock: Clock;
  tokens: TokenService;
  /** 未配置时登录相关用例抛 unavailable。 */
  provider: IdentityProvider | undefined;
  hosts: HostResolver;
  previewAccess: PreviewAccess;
  workloads: WorkloadLookup;
  allowlist: AllowlistEvaluator;
  memberships: MembershipLookup;
  devSessions: DevSessionState;
}
