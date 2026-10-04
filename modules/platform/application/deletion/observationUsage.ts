import { RunnerUsageMeasurementSchema } from '@crewstation/contracts';
import type { ProjectDeletionContext, ProjectId, RunnerUsageSourceIdentity, TaskId } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { ObservationCleanupBinding } from '../../ports/deletion/observation';
import type { ObservationUsageOwner } from '../../ports/executionObservations';
import type { DevelopmentObservationOwner } from '../../ports/developmentObservations';

interface ProjectContexts {
  projectDeletionParticipantContext(context: ProjectDeletionContext, participant: 'session'): Promise<ProjectDeletionContext>;
}
/** Private Session reads/ACKs use its own actual Root permission; source attribution stays with independent owners. */
export function originalObservationUsage(project: ProjectContexts, bind: ObservationCleanupBinding, business: ObservationUsageOwner, development?: DevelopmentObservationOwner) {
  return {
    tasks: async (context: ProjectDeletionContext, after: TaskId | null) => bind.tasks(await project.projectDeletionParticipantContext(context, 'session'), after),
    task: async (context: ProjectDeletionContext, id: TaskId) => {
      const task = bind(await project.projectDeletionParticipantContext(context, 'session'), id);
      return { ...task, businessMeasurement: async (source: RunnerUsageSourceIdentity, recordId: string, revision: number) => {
        if (source.runtimeTaskId !== id) throw precondition('观测模型证据必须沿用当前原任务');
        return RunnerUsageMeasurementSchema.nullable().parse(await task.data({ type: 'business-measurement', executionId: source.executionId, recordId, revision })) ?? undefined;
      } };
    },
    business: business.resolveUsageSource,
    development: (key: Parameters<DevelopmentObservationOwner['resolve']>[0]) => development?.resolve(key) ?? Promise.resolve(undefined),
  };
}

export async function originalObservationTasks(runtime: { originalProjectTaskIds(projectId: ProjectId, after: string | null): Promise<readonly TaskId[]> }, projectId: ProjectId) {
  const ids: TaskId[] = []; let after: string | null = null;
  while (true) {
    const page = await runtime.originalProjectTaskIds(projectId, after);
    if (!page.length) return { ids, complete: true };
    if (page.length > 200 || page.some((id, index) => id <= (index ? page[index - 1]! : after ?? ''))) throw precondition('观测原任务归属目录不连续或重复');
    ids.push(...page); after = page.at(-1)!;
  }
}
