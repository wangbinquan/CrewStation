import type { ProjectId } from '@crewstation/contracts';
import type { Logger } from '@crewstation/kernel';
import type { ProvisioningSteps } from '../api/steps';

const ORDER = ['ensureNamespace', 'ensureRepository', 'ensureData', 'reconcileRoutes', 'ensureFirstRelease'] as const;

/** 管理员代建项目后的开通链（M1 G1）：命名空间→仓库→数据→路由→首个标签发布→active；失败留 failed 与原因，可重跑。 */
export function provisionProjectUseCase(steps: ProvisioningSteps, logger: Logger) {
  return async (projectId: ProjectId): Promise<'active' | 'failed' | 'skipped'> => {
    const facts = await steps.loadProject(projectId);
    if (!facts) return 'skipped';
    for (const step of ORDER) {
      try {
        await steps[step](facts);
        logger.info('provisioning step done', { projectId, slug: facts.slug, step });
      } catch (error) {
        const message = `${step} 失败：${error instanceof Error ? error.message : String(error)}`;
        logger.error('provisioning step failed', { projectId, slug: facts.slug, step, error: message });
        await steps.setProjectState(projectId, 'failed', message).catch(() => undefined);
        return 'failed';
      }
    }
    await steps.setProjectState(projectId, 'active');
    return 'active';
  };
}
