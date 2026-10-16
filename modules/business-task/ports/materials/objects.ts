import type { BusinessExecutionFence, BusinessMaterialDownload, BusinessMaterialObjectScope as MaterialObjectScope } from '@crewstation/contracts';
export interface ExecutionMaterialObjects {
  pin(caller: { identity: string; token?: string }, input: MaterialObjectScope & { fence?: BusinessExecutionFence }): Promise<void>;
  check(input: MaterialObjectScope): Promise<void>;
  grants(input: MaterialObjectScope): Promise<BusinessMaterialDownload[]>;
}
