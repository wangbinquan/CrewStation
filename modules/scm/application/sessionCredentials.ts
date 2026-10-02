import type { ServiceId, SessionCredentialDto } from '@crewstation/contracts';
import { isPlatformError, newId } from '@crewstation/kernel';
import { DEFAULT_CREDENTIAL_USERNAME, credentialTemplate } from '../domain/remoteUrl';
import { credentialExpiry, credentialName, hashToken, remoteExpiryDate } from '../domain/sessionCredential';
import type { ScmUseCaseDeps } from '../ports/useCaseDependencies';
import { scmExternalEffect, withScmServiceWrite } from './projectAdmission';
import { loadReadyBinding } from './queryRepository';

/** 会话级短期 Git 凭据：远端是开发者级项目访问令牌，平台只存哈希与远端令牌 ID，到期后主动撤销。 */
export function sessionCredentialUseCases(deps: ScmUseCaseDeps) {
  const { uow, gitlab, settings, clock } = deps;
  return {
    issueSessionCredential: (serviceId: ServiceId, ttlMinutes: number): Promise<SessionCredentialDto> => withScmServiceWrite(deps, serviceId, 'session-credential', async () => {
      const binding = await loadReadyBinding(uow, serviceId);
      const now = clock.now();
      const expiresAt = credentialExpiry(now, ttlMinutes);
      const id = newId('cred');
      const remote = await scmExternalEffect(deps, { kind: 'credential', remoteProjectId: binding.remoteProjectId, credentialId: id },
        () => gitlab.createAccessToken(binding.remoteProjectId, { name: credentialName(id), expiresOn: remoteExpiryDate(expiresAt) }),
        (created) => ({ remoteTokenId: created.id, ...(created.createdAt ? { createdAt: created.createdAt } : {}), ...(created.userId ? { userId: created.userId } : {}) }));
      await uow.run((scope) => scope.credentials.insert({ id, serviceId, remoteTokenId: remote.id, tokenHash: hashToken(remote.token), expiresAt, createdAt: now }));
      return {
        token: remote.token,
        expiresAt: expiresAt.toISOString(),
        httpUrlWithCredentialTemplate: credentialTemplate(binding.httpUrl, settings.credentialUsername ?? DEFAULT_CREDENTIAL_USERNAME),
      };
    }),
    /** 供控制面周期调用；远端撤销失败会中断本轮，下一轮重试。 */
    revokeExpiredCredentials: async (): Promise<number> => {
      await uow.writes?.observe();
      const now = clock.now();
      let revoked = 0;
      for (const credential of await uow.read.credentials.listExpired(now)) {
        try { await withScmServiceWrite(deps, credential.serviceId, 'credential-revoke', async () => {
          const binding = await uow.read.bindings.getByServiceId(credential.serviceId);
          if (binding) await gitlab.revokeAccessToken(binding.remoteProjectId, credential.remoteTokenId);
          await uow.run((scope) => scope.credentials.markRevoked(credential.id, now));
        }); } catch (error) { if (isPlatformError(error) && error.details['code'] === 'scm_project_sealed') continue; throw error; }
        revoked += 1;
      }
      return revoked;
    },
  };
}
