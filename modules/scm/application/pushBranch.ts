import type { ServiceId } from '@crewstation/contracts';
import { PLATFORM_PUSH_USERNAME, withCredential } from '../domain/remoteUrl';
import type { ScmUseCaseDeps } from '../ports/useCaseDependencies';
import { withScmServiceWrite } from './projectAdmission';
import { loadReadyBinding } from './queryRepository';

/** 发布前置：平台把开发容器里的当前分支推到远端（Design §6 发布前检查通过后由平台代推）。 */
export function pushBranchUseCase(deps: ScmUseCaseDeps) {
  const { uow, git, settings } = deps;
  return (serviceId: ServiceId, workdir: string, branch: string): Promise<{ commitSha: string }> => withScmServiceWrite(deps, serviceId, 'push-branch', async () => {
    const binding = await loadReadyBinding(uow, serviceId);
    return git.pushBranch({ workdir, remoteUrlWithCredential: withCredential(binding.httpUrl, PLATFORM_PUSH_USERNAME, settings.platformToken), branch });
  });
}
