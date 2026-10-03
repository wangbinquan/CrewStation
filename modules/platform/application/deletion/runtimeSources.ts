import { precondition } from '@crewstation/kernel';
import type { InfrastructureSourceModules } from '../../ports/infrastructureOrigins';
import type { SessionProcessObservers, SessionProjectAdmission } from '../../ports/sessionDeletion';

/** Original accepted business work is queried only when no TaskRuntime environment exists. */
export function runtimeDeletionSources(project: InfrastructureSourceModules['project'] & SessionProjectAdmission,
  business: () => InfrastructureSourceModules['businessTask'] | undefined, observers: SessionProcessObservers) {
  return { processes: { protectCurrent: observers.protectCurrentProcess, sweep: observers.sweep },
    assertAvailable: project.assertProjectAvailable, assertGrant: project.assertProjectDeletionGrant,
    resolve: async (kind: 'project' | 'service' | 'business-task', key: string, representation: 'current' | 'legacy') => {
      if (kind !== 'business-task') return project.originalInfrastructureOwnership(kind, key, representation);
      const original = business(); if (!original) throw precondition('原受理业务任务来源尚未装配');
      return original.originalInfrastructureOwnership('task', key, representation);
    },
  };
}
