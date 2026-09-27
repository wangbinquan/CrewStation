import type { RuntimeImageHistoryItem, RuntimeImageHistoryRead } from '@crewstation/contracts';
export interface RuntimeImageExecutionHistory {
  list(input: RuntimeImageHistoryRead): Promise<RuntimeImageHistoryItem[]>;
}
