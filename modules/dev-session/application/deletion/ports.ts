import { jsonHash } from '@crewstation/kernel';
import type { DevSessionUseCaseDeps } from '../dependencies';
import type { DevelopmentProjectWork } from '../../ports/deletion/work';

/** Copy the narrow port; leave shared instances and their receivers intact. A closed original continuation always rejects. */
export function guardedDevelopmentPort<T extends object>(port: T, work: DevelopmentProjectWork): T {
  const copy = Object.assign({}, port);
  for (const name of Object.keys(port)) Object.defineProperty(copy, name, { enumerable: true,
    get: () => typeof Reflect.get(port, name) !== 'function' ? Reflect.get(port, name) : (...args: unknown[]) =>
      work.whenActive(jsonHash({ method: name, args }), () => Reflect.apply(Reflect.get(port, name) as (...input: unknown[]) => Promise<unknown>, port, args)),
  });
  return copy;
}
export function scopedDevelopmentPorts(deps: DevSessionUseCaseDeps, work: DevelopmentProjectWork): DevSessionUseCaseDeps {
  return { ...deps, projectWork: work, environments: guardedDevelopmentPort(deps.environments, work), runner: guardedDevelopmentPort(deps.runner, work),
    scm: guardedDevelopmentPort(deps.scm, work), releases: guardedDevelopmentPort(deps.releases, work), authorizer: guardedDevelopmentPort(deps.authorizer, work),
    services: guardedDevelopmentPort(deps.services, work), notifier: guardedDevelopmentPort(deps.notifier, work), credentials: guardedDevelopmentPort(deps.credentials, work),
    compute: guardedDevelopmentPort(deps.compute, work), reminders: guardedDevelopmentPort(deps.reminders, work), comparisons: guardedDevelopmentPort(deps.comparisons, work),
    apiCatalog: guardedDevelopmentPort(deps.apiCatalog, work), ...(deps.executions ? { executions: guardedDevelopmentPort(deps.executions, work) } : {}),
    ...(deps.runtimeImages ? { runtimeImages: guardedDevelopmentPort(deps.runtimeImages, work) } : {}) };
}
