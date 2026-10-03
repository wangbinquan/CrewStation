import { ResourceIdSchema, TaskIdSchema } from '@crewstation/contracts';
import type { SessionOriginalTasks, SessionProcessObservers, SessionProjectAdmission } from '../../ports/sessionDeletion';

export function sessionDeletionSources(tasks: SessionOriginalTasks, project: SessionProjectAdmission, observers?: SessionProcessObservers) {
  return {
    ...(observers ? { processes: { protectCurrent: observers.protectCurrentProcess, sweep: observers.sweep } } : {}),
    resolve: async (key: string) => {
      const original = await tasks.originalInfrastructureOwnership('task', key, ResourceIdSchema.safeParse(key).success ? 'current' : 'legacy');
      return original ? { ...original, id: TaskIdSchema.parse(original.id) } : undefined;
    },
    tasks: tasks.originalProjectTaskIds,
    assertAvailable: project.assertProjectAvailable,
    assertGrant: project.assertProjectDeletionGrant,
  };
}
