import type { ComparisonDeployment } from '@crewstation/contracts';
import type { ComparisonTarget, TaskId } from '@crewstation/contracts';

/** Durable identity; permissions and the current deployment are still checked on every read. */
export interface ComparisonReference {
  readonly id: string;
  readonly taskId: TaskId;
  readonly runnerComparisonId: string;
  readonly target: ComparisonTarget;
  readonly deployment: string;
}

export function deploymentReference(deployment: ComparisonDeployment): string {
  return deployment.status === 'ready' ? `${deployment.releaseId}:${deployment.commitSha}` : deployment.status;
}
