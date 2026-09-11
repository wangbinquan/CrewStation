import type { ServiceId, SessionCredentialDto } from '@crewstation/contracts';
import { newId } from '@crewstation/kernel';
import { DEFAULT_CREDENTIAL_USERNAME, credentialTemplate } from '../domain/remoteUrl';
import { credentialExpiry, credentialName, hashToken, remoteExpiryDate } from '../domain/sessionCredential';
import type { ScmUseCaseDeps } from './dependencies';
import { loadReadyBinding } from './loadBinding';

/** 会话级短期 Git 凭据：远端是开发者级项目访问令牌，平台只存哈希与远端令牌 ID，到期后主动撤销。 */
export function sessionCredentialUseCases({ uow, gitlab, settings, clock }: ScmUseCaseDeps) {
  return {
    issueSessionCredential: async (serviceId: ServiceId, ttlMinutes: number): Promise<SessionCredentialDto> => {
      const binding = await loadReadyBinding(uow, serviceId);
      const now = clock.now();
      const expiresAt = credentialExpiry(now, ttlMinutes);
      const id = newId('cred');
      const remote = await gitlab.createAccessToken(binding.remoteProjectId, { name: credentialName(id), expiresOn: remoteExpiryDate(expiresAt) });
      await uow.run((scope) => scope.credentials.insert({ id, serviceId, remoteTokenId: remote.id, tokenHash: hashToken(remote.token), expiresAt, createdAt: now }));
      return {
        token: remote.token,
        expiresAt: expiresAt.toISOString(),
        httpUrlWithCredentialTemplate: credentialTemplate(binding.httpUrl, settings.credentialUsername ?? DEFAULT_CREDENTIAL_USERNAME),
      };
    },
    /** 供控制面周期调用；远端撤销失败会中断本轮，下一轮重试。 */
    revokeExpiredCredentials: async (): Promise<number> => {
      const now = clock.now();
      let revoked = 0;
      for (const credential of await uow.read.credentials.listExpired(now)) {
        const binding = await uow.read.bindings.getByServiceId(credential.serviceId);
        if (binding) await gitlab.revokeAccessToken(binding.remoteProjectId, credential.remoteTokenId);
        await uow.run((scope) => scope.credentials.markRevoked(credential.id, now));
        revoked += 1;
      }
      return revoked;
    },
  };
}
