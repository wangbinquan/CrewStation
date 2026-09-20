import type { Actor, ServiceId } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { ScmUseCaseDeps } from './dependencies';
import { loadBinding } from './loadBinding';

export function previewManifestUpgradeUseCase(deps: ScmUseCaseDeps) {
  return async (actor: Actor, serviceId: ServiceId, content: string) => {
    const binding = await loadBinding(deps.uow, serviceId);
    await deps.authorizer.authorize(actor, binding.projectId, 'develop');
    if (!deps.manifestUpgrade) throw precondition('Manifest 升级器尚未配置');
    return deps.manifestUpgrade.preview(content, { projectId: binding.projectId, serviceId });
  };
}
