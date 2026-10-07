import type { AgentStart } from './agentStarts';
import type { DevelopmentDispatchResult } from './developmentDispatch';

/** Original-key producer participant. It supplies neither numeric values nor a physical cleanup permit. */
export interface DevelopmentObservationParticipant {
  prepare(start: AgentStart): Promise<void>;
  dispatch(start: AgentStart): Promise<DevelopmentDispatchResult>;
  end(start: AgentStart): Promise<void>;
}
