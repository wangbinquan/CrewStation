import type { ServiceId } from '@crewstation/contracts';
import { PLATFORM_PUSH_USERNAME, withCredential } from '../domain/remoteUrl';
import type { ScmUseCaseDeps } from './dependencies';
import { loadReadyBinding } from './loadBinding';

/** 发布前置：平台把开发容器里的当前分支推到远端（Design §6 发布前检查通过后由平台代推）。 */
export function pushBranchUseCase({ uow, git, settings }: ScmUseCaseDeps) {
  return async (serviceId: ServiceId, workdir: string, branch: string): Promise<{ commitSha: string }> => {
    const binding = await loadReadyBinding(uow, serviceId);
    return git.pushBranch({ workdir, remoteUrlWithCredential: withCredential(binding.httpUrl, PLATFORM_PUSH_USERNAME, settings.platformToken), branch });
  };
}
