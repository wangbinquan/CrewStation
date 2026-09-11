import type { ReleaseId } from '@crewstation/contracts';
import { isPlatformError } from '@crewstation/kernel';
import { isInProgress } from '../domain/release';
import type { ReleaseUseCaseDeps } from './dependencies';
import { buildSteps } from './pipelineBuild';
import type { StepResult } from './pipelineContext';
import { DONE, createPipelineContext } from './pipelineContext';
import { deploySteps } from './pipelineDeploy';

export type { StepResult } from './pipelineContext';

/** 流水线的一步：按当前状态推进或轮询；工作器根据返回值决定是否重新入队。 */
export function pipelineStepUseCase(deps: ReleaseUseCaseDeps) {
  const ctx = createPipelineContext(deps);
  const deploy = deploySteps(deps, ctx);
  const build = buildSteps(deps, ctx, deploy.startDeploy);
  return async (releaseId: ReleaseId): Promise<StepResult> => {
    const release = await deps.uow.read.releases.getById(releaseId);
    if (!release || !isInProgress(release)) return DONE;
    const svc = await deps.services.resolveServiceById(release.serviceId);
    if (!svc) return ctx.fail(release, '服务不存在');
    try {
      switch (release.status) {
        case 'pending': return await build.startBuild(release, svc);
        case 'building': return await build.pollBuild(release, svc);
        case 'migrating': return await deploy.pollMigration(release, svc);
        case 'deploying': return await deploy.pollDeploy(release, svc);
        default: return DONE;
      }
    } catch (error) {
      return ctx.fail(release, isPlatformError(error) ? error.message : String(error));
    }
  };
}
