import type { ProfileRevisionRef } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import { credentialStampOf } from '../domain/computeProfile';
import type { ProfileLaunchMaterial } from '../api/moduleApi';
import type { AgentRuntimeUseCaseDeps } from './dependencies';

/** Version retention belongs to the credential owner; consumers only persist opaque references. */
export function launchVersionUseCases(deps: AgentRuntimeUseCaseDeps, launchMaterial: (ref: ProfileRevisionRef) => Promise<ProfileLaunchMaterial>) {
  return {
    pinLaunchVersion: (ref: ProfileRevisionRef): Promise<string> => deps.uow.run(async (scope) => {
      const revision = await scope.revisions.get(ref.profileId, ref.revision);
      if (!revision) throw precondition('档位修订不存在', { code: 'profile_revision_missing' });
      const current = await scope.credentials.listForUpdate(ref.profileId);
      const credentials = revision.content.secrets.map(({ id, name }) => {
        const credential = current.find((entry) => entry.id === id);
        if (!credential?.cipherText) throw precondition('档位凭据尚未设置', { code: 'profile_secret_missing' });
        return { id, name, cipherText: credential.cipherText };
      });
      const stamp = credentialStampOf(revision.content.secrets, credentials);
      await scope.credentialVersions.save({ ...ref, stamp, credentials, revoked: false });
      return stamp;
    }),
    launchMaterialAt: async (ref: ProfileRevisionRef, stamp: string): Promise<ProfileLaunchMaterial> => {
      const saved = await deps.uow.read.credentialVersions.get(ref.profileId, ref.revision, stamp);
      if (!saved || saved.revoked) throw precondition('固定凭据版本已销毁或撤销', { code: 'secret_version_unavailable' });
      const material = await launchMaterial(ref), secrets: Record<string, string> = {};
      for (const entry of saved.credentials) secrets[entry.name] = await deps.cipher.decrypt(entry.cipherText);
      return { ...material, beforeStart: { ...material.beforeStart, secrets } };
    },
  };
}
