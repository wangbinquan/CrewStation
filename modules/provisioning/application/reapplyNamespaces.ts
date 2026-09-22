import type { Logger } from '@crewstation/kernel';
import type { ReapplyOutcome } from '../api/moduleApi';
import type { ProvisioningSteps } from '../api/steps';

/**
 * 启动重下发（RFC-018）：对全部未归档项目重跑 `ensureNamespace`。
 *
 * 命名空间里的 ResourceQuota 与 NetworkPolicy 只在开通链里下发过一次，之后平台改了这些对象的形状，
 * 存量项目也拿不到——RFC-018 把接入容器的服务槽出向放开就是这种改动。`ensureNamespace` 本身幂等，
 * 因此这里只是把它对每个项目再跑一遍。
 *
 * 单个项目失败只记日志并继续：一个坏命名空间不该挡住控制面启动，也不该挡住其余项目拿到新策略。
 * 不改项目状态——这不是开通，失败的项目仍由「重新开通」处理。
 */
export function reapplyNamespacesUseCase(steps: ProvisioningSteps, logger: Logger) {
  return async (): Promise<ReapplyOutcome> => {
    const projects = await steps.listProjects();
    let applied = 0, failed = 0;
    for (const facts of projects) {
      try {
        await steps.ensureNamespace(facts);
        applied += 1;
      } catch (error) {
        failed += 1;
        logger.error('namespace reapply failed', { projectId: facts.projectId, slug: facts.slug, namespace: facts.namespace, error: error instanceof Error ? error.message : String(error) });
      }
    }
    logger.info('namespace reapply done', { total: projects.length, applied, failed });
    return { applied, failed };
  };
}
