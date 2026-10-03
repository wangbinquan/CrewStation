import { jsonHash } from '@crewstation/kernel';
import type { TaskRuntimeUseCaseDeps } from '../dependencies';
import type { RuntimeProjectWork } from '../../ports/deletion/work';
import type { RepositoryScope } from '../../ports/unitOfWork';

/** These narrow ports contain asynchronous methods. Preserve their real receivers and retain every already-issued effect. */
export function guardedRuntimePort<T extends object>(port: T, work: RuntimeProjectWork): T {
  const copy = Object.assign({}, port);
  for (const name of Object.keys(port)) Object.defineProperty(copy, name, { enumerable: true,
    get: () => typeof Reflect.get(port, name) !== 'function' ? Reflect.get(port, name) : (...args: unknown[]) =>
      work.whenActive(jsonHash({ method: name, args }), () => Reflect.apply(Reflect.get(port, name) as (...input: unknown[]) => Promise<unknown>, port, args)),
  });
  return copy;
}
function repositories(scope: RepositoryScope, work: RuntimeProjectWork): RepositoryScope {
  return { ...scope, environments: guardedRuntimePort(scope.environments, work), admissions: guardedRuntimePort(scope.admissions, work),
    quota: guardedRuntimePort(scope.quota, work), events: guardedRuntimePort(scope.events, work), rebuilds: guardedRuntimePort(scope.rebuilds, work),
    rebuildQueue: guardedRuntimePort(scope.rebuildQueue, work), nativeQueue: guardedRuntimePort(scope.nativeQueue, work) };
}
export function scopedRuntimePorts(deps: TaskRuntimeUseCaseDeps, work: RuntimeProjectWork): TaskRuntimeUseCaseDeps {
  return { ...deps, projectWork: work,
    uow: { read: repositories(deps.uow.read, work), run: (callback) => work.whenActive(jsonHash('runtime-transaction'), () => deps.uow.run(callback)) },
    cluster: guardedRuntimePort(deps.cluster, work), authorizer: guardedRuntimePort(deps.authorizer, work), quotas: guardedRuntimePort(deps.quotas, work),
    profiles: guardedRuntimePort(deps.profiles, work), services: guardedRuntimePort(deps.services, work), sources: guardedRuntimePort(deps.sources, work),
    ...(deps.developmentCleanup ? { developmentCleanup: guardedRuntimePort(deps.developmentCleanup, work) } : {}),
    ...(deps.developmentParentPhysical ? { developmentParentPhysical: guardedRuntimePort(deps.developmentParentPhysical, work) } : {}),
    ...(deps.unprovisionedStorage ? { unprovisionedStorage: guardedRuntimePort(deps.unprovisionedStorage, work) } : {}),
    ...(deps.workloadSafety ? { workloadSafety: guardedRuntimePort(deps.workloadSafety, work) } : {}),
    ...(deps.taskVolumes ? { taskVolumes: guardedRuntimePort(deps.taskVolumes, work) } : {}),
    ...(deps.businessStorageInspector ? { businessStorageInspector: guardedRuntimePort(deps.businessStorageInspector, work) } : {}),
    ...(deps.developmentParentInspector ? { developmentParentInspector: guardedRuntimePort(deps.developmentParentInspector, work) } : {}),
    ...(deps.initializationRunner ? { initializationRunner: guardedRuntimePort(deps.initializationRunner, work) } : {}),
    ...(deps.checkout ? { checkout: guardedRuntimePort(deps.checkout, work) } : {}),
  };
}
