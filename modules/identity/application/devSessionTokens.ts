import { normalizeVerifiedIdentity } from './verifiedIdentity';
import type { DevSessionBinding, IssuedDevSessionToken, ResolvedDevSession } from '../api/moduleApi';
import {
  DEV_SESSION_AUDIENCE, DEV_SESSION_TOKEN_TTL_SECONDS, devSessionClaims, devSessionGrantFrom, devSessionSubject,
} from '../domain/devSessionToken';
import type { IdentityUseCaseDeps } from './dependencies';
import { toDto } from './ensureUser';

type Deps = Pick<IdentityUseCaseDeps, 'tokens' | 'users' | 'devSessions' | 'clock' | 'legacyIds'>;

/**
 * 开发会话令牌：Agent 连远程 MCP 用的唯一凭据（Design §5.9）。它不是通用的用户令牌——
 * 代表的是“某人在某个项目的某个开发会话里”，会话一释放就作废。
 */
export function devSessionTokenUseCases({ tokens, users, devSessions, clock, legacyIds }: Deps) {
  return {
    issueDevSessionToken: async (binding: DevSessionBinding): Promise<IssuedDevSessionToken> => {
      const token = await tokens.sign({
        subject: devSessionSubject(binding.userId),
        audience: DEV_SESSION_AUDIENCE,
        expiresInSeconds: DEV_SESSION_TOKEN_TTL_SECONDS,
        claims: devSessionClaims(binding),
      });
      const expiresAt = new Date(clock.now().getTime() + DEV_SESSION_TOKEN_TTL_SECONDS * 1000);
      return { token, expiresAt: expiresAt.toISOString() };
    },
    resolveDevSessionToken: async (token: string): Promise<ResolvedDevSession | undefined> => {
      const verified = await normalizeVerifiedIdentity(await tokens.verify(token, { audience: DEV_SESSION_AUDIENCE }), legacyIds);
      if (!verified) return undefined;
      const binding = devSessionGrantFrom(verified.subject, verified.claims);
      if (!binding) return undefined;
      // 现查而不是信令牌：会话释放后立即失效；项目对不上（换过会话、令牌被改）同样拒绝。
      const active = await devSessions.activeSession(binding.taskId);
      if (!active || active.projectId !== binding.projectId) return undefined;
      const user = await users.getById(binding.userId);
      return user && user.platformRole !== 'user' ? { ...binding, user: toDto(user) } : undefined;
    },
  };
}
