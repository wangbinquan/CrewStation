import type { Actor, ProjectId, ServiceId } from '@crewstation/contracts';
import { newId, notFound, validation } from '@crewstation/kernel';
import { DEFAULT_CREDENTIAL_USERNAME, credentialTemplate } from '../domain/remoteUrl';
import { credentialExpiry, hashToken, remoteExpiryDate } from '../domain/sessionCredential';
import type { ScmUseCaseDeps } from '../ports/useCaseDependencies';
import { scmExternalEffect, withScmServiceWrite } from './projectAdmission';
import { loadReadyBinding } from './queryRepository';

/** RFC-028：构建只读凭据与开发会话的读写凭据分别签发，复用现有短期凭据撤销台账。 */
export function buildSourceUseCases(deps: ScmUseCaseDeps) {
  const { uow, gitlab, authorizer, clock, settings } = deps;
  return {
    resolveBuildSource: async (actor: Actor, projectId: ProjectId, bindingId: ServiceId, ref: string) => {
      await authorizer.authorize(actor, projectId, 'develop');
      const binding = await loadReadyBinding(uow, bindingId);
      if (binding.projectId !== projectId) throw notFound('项目源码绑定', bindingId);
      if (!ref || ref.length > 256 || /[\x00-\x20\x7f]/.test(ref)) throw validation('源码引用不合法');
      const commitSha = await gitlab.resolveCommit(binding.remoteProjectId, ref);
      if (!commitSha || !/^[0-9a-f]{40,64}$/.test(commitSha)) throw notFound('源码提交', ref);
      return { commitSha, httpUrl: binding.httpUrl, tree: await gitlab.listTree(binding.remoteProjectId, commitSha) };
    },
    issueBuildCredential: (serviceId: ServiceId, ttlMinutes: number) => withScmServiceWrite(deps, serviceId, 'build-credential', async () => {
      const binding = await loadReadyBinding(uow, serviceId), now = clock.now();
      if (ttlMinutes > 120) throw validation('构建凭据最长保留 120 分钟');
      const expiresAt = credentialExpiry(now, ttlMinutes), id = newId('cred');
      const remote = await scmExternalEffect(deps, { kind: 'credential', remoteProjectId: binding.remoteProjectId, credentialId: id },
        () => gitlab.createAccessToken(binding.remoteProjectId, { name: `cs-build-${id}`, expiresOn: remoteExpiryDate(expiresAt), readOnly: true }),
        (created) => ({ remoteTokenId: created.id, ...(created.createdAt ? { createdAt: created.createdAt } : {}), ...(created.userId ? { userId: created.userId } : {}) }));
      try { await uow.run((s) => s.credentials.insert({ id, serviceId, remoteTokenId: remote.id, tokenHash: hashToken(remote.token), expiresAt, createdAt: now })); }
      catch (error) { await gitlab.revokeAccessToken(binding.remoteProjectId, remote.id); throw error; }
      return { id, token: remote.token, expiresAt: expiresAt.toISOString(), httpUrlWithCredentialTemplate: credentialTemplate(binding.httpUrl, settings.credentialUsername ?? DEFAULT_CREDENTIAL_USERNAME) };
    }),
    revokeBuildCredential: (serviceId: ServiceId, credentialId: string) => withScmServiceWrite(deps, serviceId, 'credential-revoke', async () => {
      const entry = await uow.read.credentials.getById(credentialId);
      if (!entry || entry.serviceId !== serviceId) throw notFound('源码构建凭据', credentialId);
      if (entry.revokedAt) return;
      const binding = await loadReadyBinding(uow, serviceId);
      await gitlab.revokeAccessToken(binding.remoteProjectId, entry.remoteTokenId);
      await uow.run((s) => s.credentials.markRevoked(entry.id, clock.now()));
    }),
  };
}
