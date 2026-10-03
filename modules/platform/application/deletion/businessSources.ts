import { jsonHash, precondition } from '@crewstation/kernel';
import type { InfrastructureSourceModules } from '../../ports/infrastructureOrigins';
import type { SessionProcessObservers, SessionProjectAdmission } from '../../ports/sessionDeletion';

/** The same runtime owns finalization and original task witnesses; physical observers are supplied by wiring. */
export function businessRuntimePorts<Archive, Administration, Preflight, Runtime extends InfrastructureSourceModules['taskRuntime']>(
  data: { archiveFinalization?: Archive; archiveAdministration?: Administration; archiveService?: { preflight: Preflight } }, runtime: Runtime,
  project: Parameters<typeof businessDeletionSources>[0], business: Parameters<typeof businessDeletionSources>[2], observers?: SessionProcessObservers) {
  return { finalizationPreparation: data.archiveFinalization ? { operatorArchive: data.archiveAdministration, preflight: data.archiveService?.preflight, archive: data.archiveFinalization, runtime } : undefined,
    ...(observers ? { deletionWorkSources: businessDeletionSources(project, runtime, business, observers) } : {}) };
}

/** Public original owner witnesses are joined only after their project and canonical identity agree. */
export function businessDeletionSources(project: InfrastructureSourceModules['project'] & SessionProjectAdmission, tasks: InfrastructureSourceModules['taskRuntime'],
  business: () => InfrastructureSourceModules['businessTask'] | undefined, observers: SessionProcessObservers) {
  return {
    processes: { protectCurrent: observers.protectCurrentProcess, sweep: observers.sweep },
    assertAvailable: project.assertProjectAvailable, assertGrant: project.assertProjectDeletionGrant,
    resolve: async (kind: 'service' | 'task', key: string, representation: 'current' | 'legacy') => {
      if (kind === 'service') return project.originalInfrastructureOwnership(kind, key, representation);
      const original = business(); if (!original) throw precondition('业务原任务来源尚未装配');
      const [runtime, accepted] = await Promise.all([tasks.originalInfrastructureOwnership(kind, key, representation), original.originalInfrastructureOwnership(kind, key, representation)]);
      if (!runtime) return accepted;
      if (!accepted) return runtime;
      if (runtime.id !== accepted.id || runtime.scope !== accepted.scope || jsonHash([...runtime.projectIds].sort()) !== jsonHash([...accepted.projectIds].sort()))
        throw precondition('业务原任务与运行环境的项目归属冲突');
      return { ...runtime, revision: jsonHash({ runtime: runtime.revision, accepted: accepted.revision }) };
    },
  };
}
