import type { Actor, DevelopmentSummary, ProjectId, ResourcePhase } from '@crewstation/contracts';
import type { ProjectSummarySources } from '../ports/projectSummaries';

const LEGACY_STATE: Record<ResourcePhase, DevelopmentSummary['state']> = {
  pending: 'creating', provisioning: 'creating', starting: 'creating', ready: 'running', degraded: 'running', stopping: 'releasing', stopped: 'released', failed: 'failed',
};

/** 会话只提供身份、分支与活动时间；状态、原因和连接事实来自资源中心。台账缺失时不拿旧状态充当实况。 */
export async function readDevelopmentSummary(sources: ProjectSummarySources, actor: Actor, projectId: ProjectId, serviceId: string | undefined) {
  const env = await sources.session(projectId);
  if (!env) return null;
  if (env.projectId !== projectId || env.serviceId !== serviceId || env.kind !== 'dev-session') return undefined;
  const view = await sources.resources(actor, projectId);
  const record = view.items.find((item) => item.id === env.id && item.projectId === projectId && item.kind === 'dev-workspace');
  if (!record) return undefined;
  const condition = (type: string) => record.conditions.some((item) => item.type === type && item.status === 'true');
  return {
    ...env, taskId: env.id, phase: record.phase,
    state: record.phase === 'stopped' && condition('Paused') ? 'paused' : LEGACY_STATE[record.phase],
    connected: (record.phase === 'starting' || record.phase === 'ready' || record.phase === 'degraded') && condition('RunnerConnected'), message: record.reason?.message,
  };
}
