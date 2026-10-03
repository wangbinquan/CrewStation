import { jsonHash } from '@crewstation/kernel';
import type { ServiceId } from '@crewstation/contracts';
import type { BusinessReleaseHandoff } from '../../../api/releaseHandoff';
import type { BusinessProjectWork } from '../../../ports/deletion/work';

/** Release's internal mutations share the same original project admission as HTTP and workers. */
export function scopedBusinessHandoff(api: BusinessReleaseHandoff, work?: BusinessProjectWork): BusinessReleaseHandoff {
  if (!work) return api;
  const mutations = ['migrationBarrier', 'freeze', 'routeObserved'] as const;
  const guarded = Object.fromEntries(mutations.map((name) => [name, (serviceId: ServiceId, ...args: unknown[]) =>
    work.runService({ serviceId, kind: 'service-api', reference: serviceId, inputDigest: jsonHash({ name, args }) },
      () => Reflect.apply(api[name], api, [serviceId, ...args]) as Promise<unknown>)]));
  return { ...api, ...guarded };
}
