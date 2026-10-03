import { jsonHash } from '@crewstation/kernel';
import type { BusinessExecutionApi, BusinessExecutionCaller } from '../../../api/executionApi';
import type { BusinessExecutionDeps } from '../dependencies';
import { executionSource } from '../source';

const mutations = ['finalize', 'reviseArchive', 'restartTask', 'claimRecovery', 'rejectRecovery', 'sendMessage', 'createMaterial', 'mutateTask', 'retrySubtask',
  'cancelSubtask', 'submitSubtask', 'createTask', 'migrationReady', 'claim', 'renew', 'release', 'activate', 'handoffReady'] as const satisfies readonly (keyof BusinessExecutionApi)[];

/** Validates the real workload source before birth; preparation and nested dispatch belong to the same original request. */
export function scopedBusinessServiceApi(api: BusinessExecutionApi, deps: BusinessExecutionDeps): BusinessExecutionApi {
  const work = deps.projectWork; if (!work) return api;
  const source = executionSource(deps);
  const guarded = Object.fromEntries(mutations.map((name) => [name, async (caller: BusinessExecutionCaller, ...args: unknown[]) => {
    const context = await source(caller);
    return work.run({ projectId: context.projectId, serviceId: context.serviceId, kind: 'service-api', reference: context.serviceId,
      inputDigest: jsonHash({ name, args }) }, () => Reflect.apply(api[name], api, [caller, ...args]) as Promise<unknown>);
  }]));
  return { ...api, ...guarded };
}
