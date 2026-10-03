import { jsonHash } from '@crewstation/kernel';
import type { BusinessProjectWork } from '../../../ports/deletion/work';
import type { BusinessTaskUseCaseDeps } from '../../dependencies';
import { guardedBusinessPort } from './projectWork';

/** The caller receives its accepted result while the original guard and private finally drain detached child lifetimes. */
export function originalLegacyResult<T>(work: BusinessProjectWork | undefined, serviceId: string, reference: string, stage: string, callback: () => Promise<T>): Promise<T> {
  if (!work) return callback();
  const ready = Promise.withResolvers<T>();
  const pending = work.runService({ serviceId, kind: 'legacy-api', reference, inputDigest: jsonHash({ stage, reference }) }, async () => {
    const result = await callback(); ready.resolve(result); return result;
  });
  void pending.catch(ready.reject); return ready.promise;
}
export function scopedLegacyPorts(deps: BusinessTaskUseCaseDeps): BusinessTaskUseCaseDeps {
  const work = deps.projectWork; if (!work) return deps;
  return { ...deps, environments: guardedBusinessPort(deps.environments, work, true), runner: guardedBusinessPort(deps.runner, work, true), compute: guardedBusinessPort(deps.compute, work, true) };
}
