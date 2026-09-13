import type { Actor, NativeTerminalDto, NativeTerminalList, StartNativeTerminalRequest, TaskId } from '@crewstation/contracts';

export interface NativeTerminalApi {
  startNativeTerminal(actor: Actor, taskId: TaskId, input: StartNativeTerminalRequest): Promise<NativeTerminalDto>;
  listNativeTerminals(actor: Actor, taskId: TaskId): Promise<NativeTerminalList>;
  stopNativeTerminal(actor: Actor, taskId: TaskId, agentId: string): Promise<void>;
}
