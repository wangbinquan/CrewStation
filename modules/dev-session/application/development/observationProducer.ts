import type { ServiceId, TaskId, TraceId } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { AgentStart } from '../../ports/agentStarts';
import type { DevelopmentObservationParticipant } from '../../ports/developmentObservation';
import type { DevelopmentDispatchSession } from '../../ports/developmentDispatch';
import type { DevelopmentEndingSession, DevelopmentEndingStore } from '../../ports/developmentEnding';
import type { DevelopmentUsageOwner } from '../../ports/developmentUsage';
import type { DevSessionUseCaseDeps } from '../dependencies';
import { dispatchDevelopmentAgent } from './dispatch';
import { requestDevelopmentEnding } from './ending';
import { developmentObservationMaterial } from './observationMaterial';

type Ports = { owner: DevelopmentUsageOwner; dispatch: DevelopmentDispatchSession; ending: DevelopmentEndingSession; store: DevelopmentEndingStore };
/** Installation selection is frozen on AgentStart. Reconciliation never reselects or recreates an invocation. */
export function developmentObservationProducer(deps: DevSessionUseCaseDeps, ports: Ports): DevelopmentObservationParticipant {
  const prepare = async (start: AgentStart): Promise<void> => {
    const intent = start.execution.observationIntent;
    if (!intent) return;
    const original = await ports.owner.get(start.execution.taskId);
    if (original) { await ports.owner.prepare({ intent, context: original.context }); return; }
    const workspace = await deps.environments.getEnvironment(start.taskId);
    if (!workspace || workspace.native) throw precondition('原生验证执行的项目工作区不存在');
    await ports.owner.prepare({ intent, context: { serviceId: workspace.serviceId as ServiceId,
      traceId: workspace.traceId as TraceId, branch: workspace.branch ?? null } });
  };
  return {
    prepare,
    dispatch: (start) => dispatchDevelopmentAgent({ owner: ports.owner, session: ports.dispatch,
      material: (original) => developmentObservationMaterial(deps, start, original) }, start.execution.taskId),
    end: async (start) => {
      const id = start.execution.taskId as TaskId, original = await ports.owner.get(id);
      if (!original) return; // No journal or original owner is invented for a failed admission.
      const reason = original.closeReason ?? (start.cancelled ? 'cancelled' : start.failure ? 'error' : 'completed');
      await ports.owner.close(id, reason);
      await requestDevelopmentEnding({ owner: ports.owner, store: ports.store, session: ports.ending, clock: deps.clock }, id, reason);
    },
  };
}
