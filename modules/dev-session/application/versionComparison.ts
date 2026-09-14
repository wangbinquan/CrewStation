import type { Actor, ComparisonDetailQuery, ComparisonDetails, ComparisonTarget, ProjectId, RunnerComparison, VersionComparisonDto } from '@crewstation/contracts';
import { RunnerResultPayloads } from '@crewstation/contracts';
import { notFound, precondition } from '@crewstation/kernel';
import { decodeComparisonReference, deploymentReference, encodeComparisonReference } from '../domain/comparisonReference';
import type { DevSessionUseCaseDeps } from './dependencies';
import { readComparisonDeployment } from './comparisonDeployment';
import { inspectWorkspace } from './workspaceStatus';

export function versionComparisonUseCases(deps: DevSessionUseCaseDeps) {
  const context = async (actor: Actor, projectId: ProjectId, action: 'view' | 'develop' = 'view') => {
    await deps.authorizer.authorize(actor, projectId, action);
    const env = await deps.environments.findDevSession(projectId, { includeLatestFailure: action === 'view' });
    if (!env) throw notFound('开发会话', projectId);
    const service = await deps.services.resolveServiceOfProject(projectId);
    if (!service) throw notFound('项目服务', projectId);
    return { env, service };
  };
  const versionComparison = async (actor: Actor, projectId: ProjectId, target: ComparisonTarget = 'prod'): Promise<VersionComparisonDto> => {
    const { env, service } = await context(actor, projectId);
    const deployment = await readComparisonDeployment(deps, actor, service.serviceId, target);
    let result: RunnerComparison;
    try {
      if (!env.connected || deployment.status === 'unavailable') throw new Error('comparison sources unavailable');
      result = RunnerResultPayloads.compareWorkspace.parse(await deps.runner.sendCommand(env.id, { id: `compare-${crypto.randomUUID()}`, type: 'compareWorkspace', ...(deployment.status === 'ready' ? { targetSha: deployment.commitSha } : {}) }));
    } catch {
      const workspace = await inspectWorkspace(deps, env);
      const reason = deployment.status === 'unavailable' ? deployment.reason : '无法完成版本比较，请确认开发容器已连接且支持版本比较';
      return { taskId: env.id, deployment, comparisonId: null, workspace, commits: { status: 'unavailable', reason }, files: { status: 'unavailable', reason }, checkedAt: deps.clock.now().toISOString(), freshness: 'current' };
    }
    const latest = await readComparisonDeployment(deps, actor, service.serviceId, target);
    if (deploymentReference(deployment) !== deploymentReference(latest)) return { ...result, comparisonId: null, freshness: 'stale', taskId: env.id, deployment, latestDeployment: latest };
    const comparisonId = result.comparisonId ? encodeComparisonReference({ taskId: env.id, runnerId: result.comparisonId, target, deployment: deploymentReference(deployment) }) : null;
    return { ...result, comparisonId, taskId: env.id, deployment };
  };
  const versionComparisonDetails = async (actor: Actor, projectId: ProjectId, comparisonId: string, query: ComparisonDetailQuery): Promise<ComparisonDetails> => {
    const { env, service } = await context(actor, projectId);
    const reference = decodeComparisonReference(comparisonId);
    if (env.id !== reference.taskId || !env.connected) throw precondition('比较所属的会话已变化或未连接，请重新计算', { code: 'comparison_stale' });
    const current = async () => readComparisonDeployment(deps, actor, service.serviceId, reference.target);
    if (deploymentReference(await current()) !== reference.deployment) throw precondition('目标部署已变化，旧比较失效，请重新计算', { code: 'comparison_stale' });
    const result = RunnerResultPayloads.workspaceComparisonDetails.parse(await deps.runner.sendCommand(env.id, { ...query, id: `diff-${crypto.randomUUID()}`, type: 'workspaceComparisonDetails', comparisonId: reference.runnerId }));
    if (deploymentReference(await current()) !== reference.deployment) throw precondition('读取期间目标部署已变化，请重新计算', { code: 'comparison_stale' });
    return { ...result, comparisonId };
  };
  const refreshComparisonHistory = async (actor: Actor, projectId: ProjectId, target: ComparisonTarget = 'prod'): Promise<VersionComparisonDto> => {
    const { env, service } = await context(actor, projectId, 'develop');
    if (!env.connected) throw precondition('开发容器未连接，无法补齐历史');
    const deployment = await readComparisonDeployment(deps, actor, service.serviceId, target);
    if (deployment.status === 'unavailable') throw precondition(deployment.reason);
    const { url } = await deps.scm.pushUrl(service.serviceId);
    await deps.runner.sendCommand(env.id, { id: `history-${crypto.randomUUID()}`, type: 'fetchComparisonHistory', url, ...(deployment.status === 'ready' ? { targetSha: deployment.commitSha } : {}) });
    return versionComparison(actor, projectId, target);
  };
  return { versionComparison, versionComparisonDetails, refreshComparisonHistory };
}
