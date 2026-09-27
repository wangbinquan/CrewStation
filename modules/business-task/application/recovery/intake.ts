import { notFound, precondition } from '@crewstation/kernel';
import type { BusinessExecutionFence } from '@crewstation/contracts';
import type { BusinessExecutionApi, BusinessExecutionCaller } from '../../api/executionApi';
import { assertExecutionFence } from '../../domain/executionControl';
import type { BusinessExecutionDeps } from '../execution/dependencies';
import { executionSource } from '../execution/source';

/** The application uses its own live Pod identity and fence. No administrator impersonation. */
export function recoveryIntakeUseCases(deps: BusinessExecutionDeps): Pick<BusinessExecutionApi, 'readRecovery' | 'claimRecovery' | 'rejectRecovery'> {
  const authorize = async (caller: BusinessExecutionCaller, fence: BusinessExecutionFence) => {
    const context = await executionSource(deps)(caller), authorization = { source: context.authority, fence };
    const snapshot = await deps.controls.read(context.serviceId);
    assertExecutionFence(snapshot.control, authorization, snapshot.now);
    if (!deps.recoveryRequests || !context.registration.tasksSpec?.recovery?.actions.length) throw precondition('当前应用版本未声明恢复能力', { code: 'application_recovery_unsupported' });
    return { serviceId: context.serviceId, authorization, requests: deps.recoveryRequests };
  };
  return {
    readRecovery: async (caller, id, input) => {
      const { serviceId, requests } = await authorize(caller, input.fence), request = await requests.get(serviceId, id);
      if (!request) throw notFound('恢复请求', id);
      return request;
    },
    claimRecovery: async (caller, input) => {
      const { serviceId, authorization, requests } = await authorize(caller, input.fence);
      return (await requests.claim(serviceId, authorization, input.requestId)) ?? null;
    },
    rejectRecovery: async (caller, id, input) => {
      const { serviceId, authorization, requests } = await authorize(caller, input.fence);
      return requests.reject(serviceId, id, { authorization, claimId: input.claimId }, input.reason);
    },
  };
}
